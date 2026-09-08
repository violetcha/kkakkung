// D-07 / ME-01. 흑백 얼굴 가공 스트림.
// 원본 camera video는 읽기만 하고 게시 가능한 유일한 source는 이 Canvas의 captureStream이다.
// OffscreenCanvas에서 captureStream을 호출하지 않는다.
import type { FaceSensor } from '../vision/sensor-types';
import {
  buildFaceMask,
  PROCESSED_FACE_FPS,
  PROCESSED_FACE_SIZE,
  type FaceMask,
} from './face-mask';

/**
 * 가공 얼굴 트랙만 게시할 수 있게 하는 표식.
 * 원본 track을 실수로 넘기면 타입과 런타임 검사에서 모두 거절한다.
 */
declare const processedFaceBrand: unique symbol;

export type ProcessedFaceHandle = Readonly<{
  [processedFaceBrand]: true;
  stream: MediaStream;
  track: MediaStreamTrack;
  width: number;
  height: number;
  frameRate: number;
}>;

const PROCESSED_HANDLES = new WeakSet<MediaStreamTrack>();

export function isProcessedFaceHandle(value: unknown): value is ProcessedFaceHandle {
  if (typeof value !== 'object' || value === null) return false;
  const handle = value as { track?: unknown };
  return (
    typeof handle.track === 'object' &&
    handle.track !== null &&
    PROCESSED_HANDLES.has(handle.track as MediaStreamTrack)
  );
}

/** 게시 경로가 원본을 받지 못하게 하는 관문. */
export function assertProcessedFace(value: unknown): ProcessedFaceHandle {
  if (!isProcessedFaceHandle(value))
    throw new Error('RAW_TRACK_REJECTED: only a processed face handle can be published');
  return value;
}

export type CompositorCanvas = Readonly<{
  width: number;
  height: number;
  getContext(id: '2d'): CompositorContext | null;
  captureStream(frameRate: number): MediaStream;
}>;

/** draw에 실제로 쓰는 2D 문맥의 최소 인터페이스. */
export interface CompositorContext {
  fillStyle: string;
  filter: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  clip(): void;
  drawImage(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export type CompositorEnvironment = Readonly<{
  createCanvas(width: number, height: number): CompositorCanvas;
  now(): number;
}>;

export type FaceCompositorDeps = Readonly<{
  environment: CompositorEnvironment;
  /** 원본 프레임 source. 크기를 읽을 수 없으면 안전 프레임만 그린다. */
  getSource(): { source: CanvasImageSource; width: number; height: number } | null;
  onFirstSafeFrame?(): void;
}>;

export interface FaceCompositor {
  /** 얼굴이 유효하면 마스크를 그리고, 아니면 전체 검정 안전 프레임을 그린다. */
  draw(face: FaceSensor | null): 'masked' | 'safe';
  getHandle(): ProcessedFaceHandle | null;
  readonly hasFirstSafeFrame: boolean;
  readonly isTrackLive: boolean;
  dispose(): void;
}

export function createFaceCompositor(deps: FaceCompositorDeps): FaceCompositor {
  const canvas = deps.environment.createCanvas(PROCESSED_FACE_SIZE, PROCESSED_FACE_SIZE);
  const context = canvas.getContext('2d');
  let handle: ProcessedFaceHandle | null = null;
  let firstSafeFrame = false;
  let disposed = false;

  if (context) {
    const stream = canvas.captureStream(PROCESSED_FACE_FPS);
    const track = stream.getVideoTracks()[0] ?? null;
    if (track) {
      PROCESSED_HANDLES.add(track);
      handle = {
        stream,
        track,
        width: PROCESSED_FACE_SIZE,
        height: PROCESSED_FACE_SIZE,
        frameRate: PROCESSED_FACE_FPS,
      } as ProcessedFaceHandle;
    }
  }

  const fillBlack = (target: CompositorContext) => {
    target.fillStyle = '#000000';
    target.fillRect(0, 0, PROCESSED_FACE_SIZE, PROCESSED_FACE_SIZE);
  };

  const drawMasked = (target: CompositorContext, mask: FaceMask): boolean => {
    const source = deps.getSource();
    if (!source || source.width <= 0 || source.height <= 0) return false;
    target.save();
    target.beginPath();
    const first = mask.polygon[0]!;
    target.moveTo(first.x, first.y);
    for (const point of mask.polygon.slice(1)) target.lineTo(point.x, point.y);
    target.closePath();
    target.clip();
    target.filter = 'grayscale(100%)';
    target.drawImage(
      source.source,
      mask.crop.x * source.width,
      mask.crop.y * source.height,
      mask.crop.size * source.width,
      mask.crop.size * source.height,
      0,
      0,
      PROCESSED_FACE_SIZE,
      PROCESSED_FACE_SIZE,
    );
    target.restore();
    target.filter = 'none';
    return true;
  };

  return {
    draw(face) {
      if (disposed || !context) return 'safe';
      // 매 프레임 전체를 검정으로 덮어 이전 픽셀이 남지 않게 한다.
      fillBlack(context);
      firstSafeFrame = true;
      deps.onFirstSafeFrame?.();
      if (!face || face.quality !== 'valid') return 'safe';
      const mask = buildFaceMask(face.landmarks);
      if (!mask) return 'safe';
      return drawMasked(context, mask) ? 'masked' : 'safe';
    },

    getHandle: () => handle,

    get hasFirstSafeFrame() {
      return firstSafeFrame;
    },

    get isTrackLive() {
      return handle !== null && handle.track.readyState === 'live';
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      const track = handle?.track;
      handle = null;
      firstSafeFrame = false;
      try {
        track?.stop();
      } catch {
        // 이미 종료된 트랙은 무시한다.
      }
    },
  };
}

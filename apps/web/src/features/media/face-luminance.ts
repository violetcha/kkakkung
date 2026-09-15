// S15P21C204-244. 얼굴 조건 판정에 쓰는 휘도 표본.
// 가공 Canvas 는 마스크 밖이 전부 검정이라 배경 휘도를 읽을 수 없다. 그래서 여기서는 전용
// 스크래치 Canvas 에 원본을 축소해 그린 뒤 통계만 뽑는다. 원본 픽셀은 저장하지도 게시하지도
// 않으며 이 모듈은 게시 경로와 닿지 않는다.
import { isInsidePolygon, PROCESSED_FACE_SIZE, toGrayscale, type FaceMask } from './face-mask';
import { GLARE_SATURATION_LUMA, type LuminanceProfile } from './face-condition';
import { FACE_KEY_POINTS } from '../vision/face-sensor';
import type { NormalizedLandmark } from '../vision/sensor-types';

/** 배경 표본용 축소 크기. 배경 밝기는 저해상도로 충분하다. */
export const FRAME_SAMPLE_SIZE = 32;
/** 얼굴·눈 표본용 축소 크기. 눈 영역을 가릴 정도로 작으면 안 된다. */
export const FACE_SAMPLE_SIZE = 64;
/** 표본 주기. 추론 주기와 별개이며 성능 예산(S15P21C204-245)을 위해 낮게 잡는다. */
export const LUMINANCE_SAMPLE_INTERVAL_MS = 500;
/** 눈 중심에서 이 비율만큼을 눈 영역으로 본다. 표본 크기 대비 값이다. */
export const EYE_BOX_RATIO = 0.16;

export type LuminanceContext = Readonly<{
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
  getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> };
}>;

export type LuminanceCanvas = Readonly<{
  getContext(id: '2d'): LuminanceContext | null;
}>;

export type LuminanceSamplerDeps = Readonly<{
  createCanvas(width: number, height: number): LuminanceCanvas;
  /** 원본 프레임 source. 없으면 표본을 만들지 않는다. */
  getSource(): { source: CanvasImageSource; width: number; height: number } | null;
}>;

export interface LuminanceSampler {
  /** 주기가 되지 않았거나 표본을 못 뽑으면 null 이다. */
  sample(
    mask: FaceMask,
    landmarks: readonly NormalizedLandmark[],
    nowMs: number,
  ): LuminanceProfile | null;
  reset(): void;
}

function meanOf(total: number, count: number): number {
  return count > 0 ? total / count : 0;
}

/** 정규화 좌표를 crop 안의 표본 픽셀 좌표로 옮긴다. crop 밖이면 null 이다. */
function toFaceSample(
  point: NormalizedLandmark | undefined,
  crop: FaceMask['crop'],
): { x: number; y: number } | null {
  if (!point || crop.size <= 0) return null;
  const x = ((point.x - crop.x) / crop.size) * FACE_SAMPLE_SIZE;
  const y = ((point.y - crop.y) / crop.size) * FACE_SAMPLE_SIZE;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x >= FACE_SAMPLE_SIZE || y >= FACE_SAMPLE_SIZE) return null;
  return { x, y };
}

export function createLuminanceSampler(deps: LuminanceSamplerDeps): LuminanceSampler {
  const frameCanvas = deps.createCanvas(FRAME_SAMPLE_SIZE, FRAME_SAMPLE_SIZE);
  const faceCanvas = deps.createCanvas(FACE_SAMPLE_SIZE, FACE_SAMPLE_SIZE);
  const frameContext = frameCanvas.getContext('2d');
  const faceContext = faceCanvas.getContext('2d');
  let lastSampledAtMs: number | null = null;

  /** crop 바깥 픽셀의 평균 휘도. 얼굴이 차지한 자리는 배경 표본에서 뺀다. */
  const readSurround = (
    source: NonNullable<ReturnType<LuminanceSamplerDeps['getSource']>>,
    crop: FaceMask['crop'],
  ) => {
    if (!frameContext) return null;
    frameContext.drawImage(
      source.source,
      0,
      0,
      source.width,
      source.height,
      0,
      0,
      FRAME_SAMPLE_SIZE,
      FRAME_SAMPLE_SIZE,
    );
    const { data } = frameContext.getImageData(0, 0, FRAME_SAMPLE_SIZE, FRAME_SAMPLE_SIZE);
    const left = crop.x * FRAME_SAMPLE_SIZE;
    const top = crop.y * FRAME_SAMPLE_SIZE;
    const span = crop.size * FRAME_SAMPLE_SIZE;
    let total = 0;
    let count = 0;
    for (let y = 0; y < FRAME_SAMPLE_SIZE; y += 1) {
      for (let x = 0; x < FRAME_SAMPLE_SIZE; x += 1) {
        if (x >= left && x < left + span && y >= top && y < top + span) continue;
        const offset = (y * FRAME_SAMPLE_SIZE + x) * 4;
        total += toGrayscale(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0);
        count += 1;
      }
    }
    return count > 0 ? meanOf(total, count) : null;
  };

  return {
    sample(mask, landmarks, nowMs) {
      if (!frameContext || !faceContext) return null;
      if (lastSampledAtMs !== null && nowMs - lastSampledAtMs < LUMINANCE_SAMPLE_INTERVAL_MS)
        return null;
      const source = deps.getSource();
      if (!source || source.width <= 0 || source.height <= 0) return null;
      lastSampledAtMs = nowMs;

      const surroundMean = readSurround(source, mask.crop);
      if (surroundMean === null) return null;

      // 마스크 폴리곤은 PROCESSED_FACE_SIZE 좌표다. 표본 크기로 옮겨 안팎을 가른다.
      const scale = FACE_SAMPLE_SIZE / PROCESSED_FACE_SIZE;
      const polygon = mask.polygon.map((point) => ({ x: point.x * scale, y: point.y * scale }));
      faceContext.drawImage(
        source.source,
        mask.crop.x * source.width,
        mask.crop.y * source.height,
        mask.crop.size * source.width,
        mask.crop.size * source.height,
        0,
        0,
        FACE_SAMPLE_SIZE,
        FACE_SAMPLE_SIZE,
      );
      const { data } = faceContext.getImageData(0, 0, FACE_SAMPLE_SIZE, FACE_SAMPLE_SIZE);

      const eyes = [
        toFaceSample(landmarks[FACE_KEY_POINTS.leftEyeOuter], mask.crop),
        toFaceSample(landmarks[FACE_KEY_POINTS.rightEyeOuter], mask.crop),
      ].filter((value): value is { x: number; y: number } => value !== null);
      const eyeBox = FACE_SAMPLE_SIZE * EYE_BOX_RATIO;
      const inEyeRegion = (x: number, y: number) =>
        eyes.some((eye) => Math.abs(x - eye.x) <= eyeBox && Math.abs(y - eye.y) <= eyeBox);

      let faceTotal = 0;
      let faceCount = 0;
      let eyeCount = 0;
      let eyeSaturated = 0;
      for (let y = 0; y < FACE_SAMPLE_SIZE; y += 1) {
        for (let x = 0; x < FACE_SAMPLE_SIZE; x += 1) {
          if (!isInsidePolygon(polygon, x, y)) continue;
          const offset = (y * FACE_SAMPLE_SIZE + x) * 4;
          const luma = toGrayscale(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0);
          faceTotal += luma;
          faceCount += 1;
          if (!inEyeRegion(x, y)) continue;
          eyeCount += 1;
          if (luma >= GLARE_SATURATION_LUMA) eyeSaturated += 1;
        }
      }

      return {
        faceMean: meanOf(faceTotal, faceCount),
        surroundMean,
        // 눈 영역을 못 잡으면 반사를 주장하지 않는다.
        eyeSaturatedRatio: eyeCount > 0 ? eyeSaturated / eyeCount : 0,
        sampleCount: faceCount,
      };
    },

    reset() {
      lastSampledAtMs = null;
    },
  };
}

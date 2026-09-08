// D-02 / IN-02. main <-> vision Worker의 메시지 계약.
// 시각 값은 모두 메인 스레드 performance 시계다. Worker는 받은 frameId/sampledAtMs를 그대로 돌려준다.
import type { FaceSensor, GestureSensor, ModelOutcome, PoseSensor } from './sensor-types';

export type { ModelOutcome } from './sensor-types';

export const VISION_PROTOCOL_VERSION = 1;

export type ModelPaths = Readonly<{
  wasmBasePath: string;
  face: string;
  pose: string;
  gesture: string;
}>;

/** 저장소에 고정한 로컬 자산만 읽는다. 외부 latest CDN URL을 런타임에 쓰지 않는다. */
export const PINNED_MODEL_PATHS: ModelPaths = Object.freeze({
  wasmBasePath: '/models/mediapipe/1.0.1/wasm',
  face: '/models/face/face_landmarker.task',
  pose: '/models/pose/pose_landmarker.task',
  gesture: '/models/gesture/gesture_recognizer.task',
});

export type VisionModelKind = 'face' | 'pose' | 'gesture';

export type WorkerInit = Readonly<{
  type: 'init';
  runtimeGeneration: number;
  paths: ModelPaths;
}>;

/**
 * 한 프레임 요청. bitmap은 transfer로 넘기고 Worker가 반드시 close한다.
 * models는 이 프레임에서 실제로 실행할 모델 목록이다.
 */
export type WorkerFrame = Readonly<{
  type: 'frame';
  runtimeGeneration: number;
  frameId: number;
  sampledAtMs: number;
  models: readonly VisionModelKind[];
  bitmap: ImageBitmap;
}>;

export type WorkerClose = Readonly<{ type: 'close' }>;

export type WorkerRequest = WorkerInit | WorkerFrame | WorkerClose;

/** 실행한 모델만 키로 담는다. 실행하지 않은 모델은 키 자체가 없다. */
export type FrameOutcomes = Readonly<{
  face?: ModelOutcome<FaceSensor>;
  pose?: ModelOutcome<PoseSensor>;
  gesture?: ModelOutcome<GestureSensor>;
}>;

export type WorkerReady = Readonly<{
  type: 'ready';
  runtimeGeneration: number;
  loaded: readonly VisionModelKind[];
}>;

export type WorkerResult = Readonly<{
  type: 'result';
  runtimeGeneration: number;
  frameId: number;
  sampledAtMs: number;
  outcomes: FrameOutcomes;
}>;

export type WorkerFailure = Readonly<{
  type: 'error';
  runtimeGeneration: number;
  /** 프레임 단위 실패면 해당 frameId, 초기화 실패면 null이다. */
  frameId: number | null;
  code: 'MODEL_LOAD_FAILED' | 'INFERENCE_FAILED' | 'DISPOSED' | 'PROTOCOL_ERROR';
}>;

export type WorkerClosed = Readonly<{ type: 'closed'; runtimeGeneration: number }>;

export type WorkerResponse = WorkerReady | WorkerResult | WorkerFailure | WorkerClosed;

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as { type?: unknown; runtimeGeneration?: unknown };
  if (typeof message.runtimeGeneration !== 'number') return false;
  return (
    message.type === 'ready' ||
    message.type === 'result' ||
    message.type === 'error' ||
    message.type === 'closed'
  );
}

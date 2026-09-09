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

/**
 * apps/web/public/models/manifest.json에 기록한 실제 sha256이다.
 * 런타임이 내려받은 바이트를 이 값과 대조해 다르면 모델을 만들지 않는다.
 */
export const PINNED_MODEL_SHA256: Readonly<Record<VisionModelKind, string>> = Object.freeze({
  face: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  pose: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  gesture: '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482',
});

/** 모델 바이트의 sha256을 계산해 고정값과 대조한다. */
export async function verifyModelBytes(
  kind: VisionModelKind,
  bytes: ArrayBuffer,
  digest: (data: ArrayBuffer) => Promise<ArrayBuffer>,
): Promise<boolean> {
  const hashed = await digest(bytes);
  const hex = [...new Uint8Array(hashed)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return hex === PINNED_MODEL_SHA256[kind];
}

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
  code:
    | 'MODEL_LOAD_FAILED'
    | 'MODEL_HASH_MISMATCH'
    | 'INFERENCE_FAILED'
    | 'DISPOSED'
    | 'PROTOCOL_ERROR';
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

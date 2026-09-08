// D-03/04/05 공용 센서 타입. D-01 facade가 onSensors 계약에 필요해 먼저 만든다.
// EXEC-CONTRACT-3 contracts/types.ts의 Sample/SensorSnapshot과 같은 모양을 소유 모듈에 구현한다.

export type NormalizedLandmark = Readonly<{ x: number; y: number; z: number }>;

export type SensorQuality = 'valid' | 'uncertain' | 'missing';

export type FaceSensor = Readonly<{
  landmarks: readonly NormalizedLandmark[];
  yawRad: number;
  quality: SensorQuality;
}>;

export type PoseSensor = Readonly<{
  landmarks: readonly (NormalizedLandmark & { visibility: number })[];
  quality: SensorQuality;
}>;

export type GestureKind = 'palm' | 'victory' | 'none';

export type GestureSensor = Readonly<{ kind: GestureKind; score: number }>;

/**
 * 한 모델이 실제로 실행한 프레임의 관측 기록.
 * frameId/sampledAtMs는 원본 프레임 값이며 receivedAtMs는 메인 스레드 수신 시각이다.
 */
export type Sample<T> = Readonly<{ frameId: number; sampledAtMs: number; receivedAtMs: number }> &
  ({ status: 'valid'; data: T } | { status: 'missing'; data: null });

/**
 * 묶음 발행. emittedAtMs는 발행 시각이며 새 센서 관측 시각이 아니다.
 * 실행하지 않은 센서는 이전 Sample을 유지하고, 세대 시작부터 실행하지 않았으면 null이다.
 */
export type SensorSnapshot = Readonly<{
  runtimeGeneration: number;
  emittedAtMs: number;
  face: Sample<FaceSensor> | null;
  pose: Sample<PoseSensor> | null;
  gesture: Sample<GestureSensor> | null;
}>;

/** face/pose는 300ms, gesture는 400ms를 넘으면 사용 불가다. */
export const FACE_MAX_AGE_MS = 300;
export const POSE_MAX_AGE_MS = 300;
export const GESTURE_MAX_AGE_MS = 400;

export type SensorKind = 'face' | 'pose' | 'gesture';

export const SENSOR_MAX_AGE_MS: Readonly<Record<SensorKind, number>> = Object.freeze({
  face: FACE_MAX_AGE_MS,
  pose: POSE_MAX_AGE_MS,
  gesture: GESTURE_MAX_AGE_MS,
});

/**
 * 표본이 지금 사용 가능한지 판정한다.
 * 다른 센서의 갱신으로 유효 시간을 연장하지 않으므로 자기 sampledAtMs만 본다.
 */
export function isSampleFresh(
  sample: Sample<unknown> | null,
  kind: SensorKind,
  nowMs: number,
): boolean {
  if (!sample || sample.status !== 'valid') return false;
  return nowMs - sample.sampledAtMs <= SENSOR_MAX_AGE_MS[kind];
}

/** quality가 uncertain이면 유효 얼굴·자세로 인정하지 않는다. */
export function isUsableQuality(quality: SensorQuality): boolean {
  return quality === 'valid';
}

export function isFiniteLandmark(value: NormalizedLandmark): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

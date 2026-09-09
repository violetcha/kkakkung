// D-04 / IN-04. PoseLandmarkerResult를 PoseSensor로 정규화한다.
// 설치 타입에 없는 presence/전체 confidence는 읽지 않는다. visibility 누락은 0, 비유한 좌표는 missing이다.
import type { ModelOutcome, PoseSensor, SensorQuality } from './sensor-types';

/** PoseLandmarker canonical 인덱스 중 상체 판정에 쓰는 관절. */
export const POSE_KEY_POINTS = Object.freeze({
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
});

/** 이 값 미만의 visibility는 해당 관절을 보지 못한 것으로 본다. */
export const POSE_MIN_VISIBILITY = 0.5;

/** 몸통 축을 세우는 데 필요한 필수 관절. 하나라도 없으면 자세를 판정하지 않는다. */
export const POSE_REQUIRED_POINTS = Object.freeze([
  POSE_KEY_POINTS.leftShoulder,
  POSE_KEY_POINTS.rightShoulder,
  POSE_KEY_POINTS.leftHip,
  POSE_KEY_POINTS.rightHip,
]);

type RawLandmark = Readonly<{ x: number; y: number; z: number; visibility?: number }>;

export type RawPoseResult = Readonly<{ landmarks: readonly (readonly RawLandmark[])[] }>;

const MISSING: ModelOutcome<PoseSensor> = Object.freeze({ status: 'missing', data: null });

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/** visibility 누락은 0으로 정규화한다. */
export function normalizeVisibility(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export type PoseLandmark = Readonly<{ x: number; y: number; z: number; visibility: number }>;

export function normalizePoseLandmarks(
  landmarks: readonly RawLandmark[],
): readonly PoseLandmark[] | null {
  const normalized: PoseLandmark[] = [];
  for (const point of landmarks) {
    if (!finite(point.x) || !finite(point.y) || !finite(point.z)) return null;
    normalized.push({
      x: point.x,
      y: point.y,
      z: point.z,
      visibility: normalizeVisibility(point.visibility),
    });
  }
  return normalized;
}

export function isJointVisible(landmark: PoseLandmark | undefined): boolean {
  return landmark !== undefined && landmark.visibility >= POSE_MIN_VISIBILITY;
}

/**
 * 몸통 축 기준 상체 기울임. 어깨 중점과 엉덩이 중점을 잇는 축의 기울기다.
 * 화면 y는 아래로 증가하므로 앞으로 숙이면 축이 짧아지고 좌우 기울임은 x 차이로 나온다.
 * 반환은 라디안이며 0이 수직이다.
 */
export function torsoLeanRad(landmarks: readonly PoseLandmark[]): number | null {
  const leftShoulder = landmarks[POSE_KEY_POINTS.leftShoulder];
  const rightShoulder = landmarks[POSE_KEY_POINTS.rightShoulder];
  const leftHip = landmarks[POSE_KEY_POINTS.leftHip];
  const rightHip = landmarks[POSE_KEY_POINTS.rightHip];
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
  const shoulderX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipX = (leftHip.x + rightHip.x) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const dx = shoulderX - hipX;
  const dy = hipY - shoulderY;
  if (Math.abs(dy) < 1e-6) return null;
  const lean = Math.atan2(dx, dy);
  return finite(lean) ? lean : null;
}

/**
 * 부분 미검출은 uncertain으로 표시한다.
 * 필수 몸통 관절이 보이지 않으면 자세를 유효로 인정하지 않는다.
 */
export function poseQuality(landmarks: readonly PoseLandmark[]): SensorQuality {
  const trunkVisible = POSE_REQUIRED_POINTS.every((index) => isJointVisible(landmarks[index]));
  if (!trunkVisible) return 'uncertain';
  const armsVisible = [
    POSE_KEY_POINTS.leftElbow,
    POSE_KEY_POINTS.rightElbow,
    POSE_KEY_POINTS.leftWrist,
    POSE_KEY_POINTS.rightWrist,
  ].every((index) => isJointVisible(landmarks[index]));
  return armsVisible ? 'valid' : 'uncertain';
}

/**
 * 결과를 센서 값으로 바꾼다.
 * D는 성공 카운터나 EXIT_PROGRESS를 만들지 않는다. 1.2초 유지 판정은 C가 소유한다.
 */
export function readPoseSensor(result: RawPoseResult | null | undefined): ModelOutcome<PoseSensor> {
  const raw = result?.landmarks?.[0];
  if (!raw || raw.length === 0) return MISSING;
  const landmarks = normalizePoseLandmarks(raw);
  if (!landmarks) return MISSING;
  if (torsoLeanRad(landmarks) === null) return MISSING;
  return { status: 'valid', data: { landmarks, quality: poseQuality(landmarks) } };
}

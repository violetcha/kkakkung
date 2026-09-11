// D-04 / IN-04. PoseLandmarkerResult를 PoseSensor로 정규화한다.
// 설치 타입에 없는 presence/전체 confidence는 읽지 않는다. visibility 누락은 0, 비유한 좌표는 missing이다.
import type { ModelOutcome, PoseSensor, SensorQuality } from './sensor-types';

/** PoseLandmarker canonical 인덱스 중 상체 판정에 쓰는 관절. */
export const POSE_KEY_POINTS = Object.freeze({
  nose: 0,
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

/** 얼굴과 어깨로 상체 축을 잡는다. 화면 밖 골반·다리는 사용하지 않는다. */
export const POSE_REQUIRED_POINTS = Object.freeze([
  POSE_KEY_POINTS.nose,
  POSE_KEY_POINTS.leftShoulder,
  POSE_KEY_POINTS.rightShoulder,
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
  for (const [index, point] of landmarks.entries()) {
    if (!finite(point.x) || !finite(point.y) || !finite(point.z)) {
      // 화면 밖 하체의 추정 실패가 얼굴·상체·양손 보정을 막지 않게 한다.
      if (index >= POSE_KEY_POINTS.leftHip) {
        normalized.push({ x: 0, y: 0, z: 0, visibility: 0 });
        continue;
      }
      return null;
    }
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
 * 코와 어깨 중점의 상대 깊이로 전후 기울임 신호를 만든다. 골반은 사용하지 않는다.
 * MediaPipe z는 카메라에 가까울수록 작으므로 앞으로 숙이면 양수가 커진다.
 * 개인별 얼굴 돌출·카메라 높이 차이는 중립 보정값을 빼서 제거한다.
 * 인체의 절대 각도가 아닌 라디안 단위 입력 신호다.
 */
export function torsoLeanRad(landmarks: readonly PoseLandmark[]): number | null {
  const nose = landmarks[POSE_KEY_POINTS.nose];
  const leftShoulder = landmarks[POSE_KEY_POINTS.leftShoulder];
  const rightShoulder = landmarks[POSE_KEY_POINTS.rightShoulder];
  if (!nose || !leftShoulder || !rightShoulder) return null;
  if (!POSE_REQUIRED_POINTS.every((index) => isJointVisible(landmarks[index]))) return null;
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const shoulderZ = (leftShoulder.z + rightShoulder.z) / 2;
  const dy = shoulderY - nose.y;
  if (dy <= 1e-6) return null;
  const lean = Math.atan2(shoulderZ - nose.z, dy);
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

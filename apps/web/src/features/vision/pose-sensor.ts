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
      // 화면 밖 하체의 추정 실패가 얼굴·상체 보정을 막지 않게 한다.
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

/** 어깨 사이 거리가 이보다 작으면 자세를 읽지 않는다(겹침·오검출). */
export const POSE_MIN_SHOULDER_SPAN = 0.02;

/**
 * 전후 기울임 신호. 웹캠 앞에서 몸을 앞으로 기울이면 상체가 카메라에 가까워져 양어깨 사이의
 * 화면상 거리가 커지고, 뒤로 기울이면 작아진다. 그 거리의 자연로그를 신호로 쓰고, 개인별
 * 체격·카메라 거리 차이는 중립 보정값을 빼서 제거한다(상대값 = ln(현재/중립), 앞이 양수).
 * z 는 쓰지 않는다: 고개만 돌려도 모델이 어깨 z 를 크게 흔들어 거리가 늘어난 것처럼 보였고,
 * 그 결과 왼쪽을 보면 전진이 걸렸다(2026-09-14 실기기). 몸통 회전으로 x 거리가 줄어드는 건
 * 런타임이 고개 회전 중 이동 판정을 막아 흡수한다(headTurnedForMove).
 * 이전의 코·어깨 상대 깊이(z) 신호는 상체 전체가 함께 움직이면 거의 변하지 않아 실기기에서
 * 앞뒤가 인식되지 않았다. 골반은 사용하지 않는다. 라디안이 아닌 무차원 입력 신호다.
 */
export function leanSignal(landmarks: readonly PoseLandmark[]): number | null {
  const nose = landmarks[POSE_KEY_POINTS.nose];
  const leftShoulder = landmarks[POSE_KEY_POINTS.leftShoulder];
  const rightShoulder = landmarks[POSE_KEY_POINTS.rightShoulder];
  if (!nose || !leftShoulder || !rightShoulder) return null;
  if (!POSE_REQUIRED_POINTS.every((index) => isJointVisible(landmarks[index]))) return null;
  const span = Math.abs(leftShoulder.x - rightShoulder.x);
  if (!finite(span) || span < POSE_MIN_SHOULDER_SPAN) return null;
  const signal = Math.log(span);
  return finite(signal) ? signal : null;
}

/**
 * 코와 양어깨가 보이면 유효한 자세다. 보정과 전후/좌우 입력은 이 세 점만 쓰므로 팔꿈치·손목은
 * 요구하지 않는다(책상 앞에 앉으면 손이 화면 밖인 경우가 흔하다). 팔이 필요한 탈출 포즈 판정은
 * matchesPose 가 팔 관절 visibility 를 따로 확인한다.
 */
export function poseQuality(landmarks: readonly PoseLandmark[]): SensorQuality {
  const trunkVisible = POSE_REQUIRED_POINTS.every((index) => isJointVisible(landmarks[index]));
  return trunkVisible ? 'valid' : 'uncertain';
}

/** 탈출 포즈처럼 팔이 필요한 판정을 위한 보조 확인. 입력 보정·이동에는 쓰지 않는다. */
export function armsVisible(landmarks: readonly PoseLandmark[]): boolean {
  return [
    POSE_KEY_POINTS.leftElbow,
    POSE_KEY_POINTS.rightElbow,
    POSE_KEY_POINTS.leftWrist,
    POSE_KEY_POINTS.rightWrist,
  ].every((index) => isJointVisible(landmarks[index]));
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
  if (leanSignal(landmarks) === null) return MISSING;
  return { status: 'valid', data: { landmarks, quality: poseQuality(landmarks) } };
}

// D-03 / IN-03. FaceLandmarkerResult를 FaceSensor로 정규화한다.
// 설치된 tasks-vision 1.0.1의 FaceLandmarkerResult에는 얼굴 전체 confidence가 없다.
// 없는 score 필드를 만들어 읽지 않고 점 존재·finite·필수 점·각도 유효성으로 품질을 정한다.
import type { FaceSensor, ModelOutcome, NormalizedLandmark, SensorQuality } from './sensor-types';

/** FaceLandmarker canonical 인덱스. 크롭·yaw 계산에 쓰는 최소 필수 점이다. */
export const FACE_KEY_POINTS = Object.freeze({
  noseTip: 1,
  chin: 152,
  leftEyeOuter: 263,
  rightEyeOuter: 33,
  leftCheek: 454,
  rightCheek: 234,
});

/** 이 각도를 넘는 급회전은 얼굴 가공에 쓰지 않는다. */
export const FACE_MAX_YAW_RAD = 1.0472; // 60도

type RawLandmark = Readonly<{ x: number; y: number; z: number }>;

export type RawFaceResult = Readonly<{
  faceLandmarks: readonly (readonly RawLandmark[])[];
  facialTransformationMatrixes?: readonly Readonly<{
    rows: number;
    columns: number;
    data: readonly number[];
  }>[];
}>;

const MISSING: ModelOutcome<FaceSensor> = Object.freeze({ status: 'missing', data: null });

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * 4x4 변환 행렬에서 yaw를 뽑는다. 행렬이 없으면 두 뺨 대비 코 위치로 근사한다.
 * 두 경로 모두 라디안이며 원시값은 비미러 프레임 기준 화면 오른쪽(+)이다. 카메라가 사용자를
 * 마주보므로 화면 오른쪽은 사용자의 왼쪽이다. 사용자 기준 부호는 readFaceSensor 가 정한다.
 */
export function faceYawFromMatrix(matrix: Readonly<{ data: readonly number[] }>): number | null {
  const m = matrix.data;
  // 열 우선 4x4의 [0][0]=m[0], [0][2]=m[8], [2][2]=m[10]
  const r00 = m[0];
  const r02 = m[8];
  const r22 = m[10];
  if (r00 === undefined || r02 === undefined || r22 === undefined) return null;
  if (!finite(r02) || !finite(r22)) return null;
  const yaw = Math.atan2(r02, r22);
  return finite(yaw) ? yaw : null;
}

/**
 * 행렬이 없을 때만 쓰는 근사. 두 뺨의 중앙에서 코가 벗어난 비율을 각도로 바꾼다.
 * 부호 규약: 코가 피검자 왼쪽 뺨(비미러 프레임의 큰 x) 쪽으로 갈수록 양수다.
 * 실기기에서 행렬 경로와 부호가 같은지는 별도 확인이 필요하다.
 */
export function faceYawFromLandmarks(landmarks: readonly RawLandmark[]): number | null {
  const left = landmarks[FACE_KEY_POINTS.leftCheek];
  const right = landmarks[FACE_KEY_POINTS.rightCheek];
  const nose = landmarks[FACE_KEY_POINTS.noseTip];
  if (!left || !right || !nose) return null;
  const span = left.x - right.x;
  if (!finite(span) || Math.abs(span) < 1e-6) return null;
  const center = (left.x + right.x) / 2;
  const ratio = Math.max(-1, Math.min(1, ((nose.x - center) / span) * 2));
  const yaw = Math.asin(ratio);
  return finite(yaw) ? yaw : null;
}

function hasRequiredPoints(landmarks: readonly RawLandmark[]): boolean {
  return Object.values(FACE_KEY_POINTS).every((index) => {
    const point = landmarks[index];
    return point !== undefined && finite(point.x) && finite(point.y) && finite(point.z);
  });
}

export function normalizeFaceLandmarks(
  landmarks: readonly RawLandmark[],
): readonly NormalizedLandmark[] {
  return landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z }));
}

/**
 * 결과를 센서 값으로 바꾼다. 원본 프레임은 포함하지 않는다.
 * 얼굴 없음·비유한 좌표·필수 점 누락은 missing, 급회전은 uncertain이다.
 */
export function readFaceSensor(result: RawFaceResult | null | undefined): ModelOutcome<FaceSensor> {
  const landmarks = result?.faceLandmarks?.[0];
  if (!landmarks || landmarks.length === 0) return MISSING;
  if (landmarks.some((point) => !finite(point.x) || !finite(point.y) || !finite(point.z)))
    return MISSING;
  if (!hasRequiredPoints(landmarks)) return MISSING;

  const matrix = result?.facialTransformationMatrixes?.[0];
  const yaw = (matrix ? faceYawFromMatrix(matrix) : null) ?? faceYawFromLandmarks(landmarks);
  if (yaw === null) return MISSING;

  const quality: SensorQuality = Math.abs(yaw) > FACE_MAX_YAW_RAD ? 'uncertain' : 'valid';
  return {
    status: 'valid',
    data: { landmarks: normalizeFaceLandmarks(landmarks), yawRad: toUserYaw(yaw), quality },
  };
}

/**
 * yawRad 의 부호 규약: 사용자가 자기 오른쪽으로 고개를 돌리면 양수다.
 * 모델 원시 yaw 는 비미러 프레임의 화면 오른쪽이 양수라 사용자 기준으로는 반대다.
 * 2026-09-14 실기기 확인: 원시값을 그대로 쓰자 좌우 회전이 반대로 나갔다. 여기서 한 번만 바꾼다.
 */
export function toUserYaw(rawYaw: number): number {
  return -rawYaw;
}

/** 뺨 사이 거리가 이보다 작으면 얼굴 크기를 읽지 않는다. */
export const FACE_MIN_SPAN = 0.01;

/**
 * 얼굴 크기 신호 ln(뺨 사이 거리). 카메라에 가까워지면 커진다. 전후 기울임 판정에서 어깨 거리와
 * 함께 쓴다(features/input/lean-signal). 고개를 돌리면 줄어들지만 그 동안은 이동 판정을 막는다.
 */
export function faceSpanSignal(landmarks: readonly NormalizedLandmark[]): number | null {
  const left = landmarks[FACE_KEY_POINTS.leftCheek];
  const right = landmarks[FACE_KEY_POINTS.rightCheek];
  if (!left || !right) return null;
  const span = Math.hypot(left.x - right.x, left.y - right.y);
  if (!finite(span) || span < FACE_MIN_SPAN) return null;
  const signal = Math.log(span);
  return finite(signal) ? signal : null;
}

/**
 * 표시 좌표와 의미 방향의 미러 변환을 담당하는 유일한 helper.
 * 셀프뷰는 좌우가 뒤집혀 보이므로 화면 좌표만 뒤집고 의미 방향은 그대로 둔다.
 * 두 번 적용하면 원본으로 돌아온다.
 */
export function mirrorNormalizedX(x: number): number {
  return 1 - x;
}

export function mirrorForDisplay(point: NormalizedLandmark): NormalizedLandmark {
  return { x: mirrorNormalizedX(point.x), y: point.y, z: point.z };
}

/** 의미 방향(yaw)의 미러. 화면 좌표 미러와 같은 helper에서만 처리한다. */
export function mirrorYaw(yawRad: number): number {
  return -yawRad;
}

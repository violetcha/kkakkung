// 전후 기울임 신호의 결합. 어깨 x 거리(pose)와 뺨 사이 거리(face)를 각각 중립 대비 로그 비율로
// 만들고 있는 것끼리 평균한다. 둘 다 카메라 거리에 반비례하므로 단위가 같고, 얼굴은 어깨보다
// 추정이 안정적이며 허리로 기울일 때 더 크게 움직인다. 한쪽만 있으면 그것만 쓴다.
import type { NormalizedLandmark } from '../vision/sensor-types';
import { faceSpanSignal } from '../vision/face-sensor';
import { leanSignal as shoulderSpanSignal, type PoseLandmark } from '../vision/pose-sensor';

export type LeanComponents = Readonly<{ shoulder: number | null; face: number | null }>;
export type LeanNeutral = Readonly<{ shoulderSpan: number | null; faceSpan: number | null }>;
export type RelativeLean = Readonly<{
  /** 사용 가능한 성분의 평균. 없으면 null 이며 이동 의도를 만들지 않는다. */
  combined: number | null;
  shoulder: number | null;
  face: number | null;
}>;

export const NO_LEAN: LeanComponents = Object.freeze({ shoulder: null, face: null });

export function leanComponents(
  pose: readonly PoseLandmark[] | null,
  face: readonly NormalizedLandmark[] | null,
): LeanComponents {
  return {
    shoulder: pose ? shoulderSpanSignal(pose) : null,
    face: face ? faceSpanSignal(face) : null,
  };
}

function diff(current: number | null, neutral: number | null): number | null {
  if (current === null || neutral === null) return null;
  const value = current - neutral;
  return Number.isFinite(value) ? value : null;
}

export function relativeLean(current: LeanComponents, neutral: LeanNeutral): RelativeLean {
  const shoulder = diff(current.shoulder, neutral.shoulderSpan);
  const face = diff(current.face, neutral.faceSpan);
  const parts = [shoulder, face].filter((v): v is number => v !== null);
  const combined = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  return { combined, shoulder, face };
}

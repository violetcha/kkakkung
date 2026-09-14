// D-05 / IN-05. GestureRecognizerResult를 GestureSensor로 정규화한다.
// 두 손이 서로 다른 유효 제스처면 none, 같은 종류면 최고 score 하나만 고른다.
// 손별 후보 배열은 이 모듈 밖으로 넘기지 않는다.
import type { GestureKind, GestureSensor, ModelOutcome, NormalizedLandmark } from './sensor-types';

/** SDK categoryName과 제품 제스처의 대응. 목록에 없는 이름은 사용하지 않는다. */
export const GESTURE_CATEGORY_MAP: Readonly<Record<string, Exclude<GestureKind, 'none'>>> =
  Object.freeze({
    Open_Palm: 'palm',
    Victory: 'victory',
  });

/** 이 점수 미만은 유효 제스처로 보지 않는다. */
export const GESTURE_MIN_SCORE = 0.6;

type RawCategory = Readonly<{ categoryName: string; score: number }>;

type RawPoint = Readonly<{ x: number; y: number; z: number }>;

export type RawGestureResult = Readonly<{
  gestures: readonly (readonly RawCategory[])[];
  /** GestureRecognizerResult.landmarks. 있으면 진단 표시용으로 함께 넘긴다. */
  landmarks?: readonly (readonly RawPoint[])[];
}>;

/** 유한한 손 landmarks 만 남긴다. 하나도 없으면 undefined 로 필드를 만들지 않는다. */
export function readHandLandmarks(
  landmarks: RawGestureResult['landmarks'],
): readonly (readonly NormalizedLandmark[])[] | undefined {
  if (!landmarks) return undefined;
  const hands: NormalizedLandmark[][] = [];
  for (const hand of landmarks) {
    if (!hand || hand.length === 0) continue;
    const points = hand.map((p: RawPoint) => ({ x: p.x, y: p.y, z: p.z }));
    if (points.every((p) => [p.x, p.y, p.z].every(Number.isFinite))) hands.push(points);
  }
  return hands.length ? hands : undefined;
}

export const NONE_GESTURE: GestureSensor = Object.freeze({ kind: 'none', score: 0 });

type HandCandidate = Readonly<{ kind: Exclude<GestureKind, 'none'>; score: number }>;

/** 한 손의 후보 목록에서 유효 제스처 한 개를 고른다. 없으면 null이다. */
export function pickHandGesture(categories: readonly RawCategory[]): HandCandidate | null {
  let best: HandCandidate | null = null;
  for (const category of categories) {
    const kind = GESTURE_CATEGORY_MAP[category.categoryName];
    if (!kind) continue;
    if (!Number.isFinite(category.score) || category.score < GESTURE_MIN_SCORE) continue;
    if (!best || category.score > best.score) best = { kind, score: category.score };
  }
  return best;
}

/**
 * 손별 결과를 합친다.
 * 서로 다른 유효 제스처는 none이고 같은 종류는 최고 score 하나다.
 */
export function combineHands(hands: readonly (HandCandidate | null)[]): GestureSensor {
  const found = hands.filter((hand): hand is HandCandidate => hand !== null);
  if (found.length === 0) return NONE_GESTURE;
  const first = found[0]!;
  if (found.some((hand) => hand.kind !== first.kind)) return NONE_GESTURE;
  const best = found.reduce((left, right) => (right.score > left.score ? right : left));
  return { kind: best.kind, score: best.score };
}

/**
 * 결과를 센서 값으로 바꾼다.
 * 손이 보이지 않으면 missing이 아니라 valid none이다. 모델은 실행됐고 제스처만 없다.
 */
export function readGestureSensor(
  result: RawGestureResult | null | undefined,
): ModelOutcome<GestureSensor> {
  if (!result || !Array.isArray(result.gestures)) return { status: 'missing', data: null };
  const hands = result.gestures.map((categories) => pickHandGesture(categories));
  const combined = combineHands(hands);
  const points = readHandLandmarks(result.landmarks);
  return { status: 'valid', data: points ? { ...combined, hands: points } : combined };
}

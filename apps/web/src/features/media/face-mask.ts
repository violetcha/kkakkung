// D-07 / ME-01. 얼굴 landmarks에서 보수적 내부 마스크를 만든다.
// 사각 crop만으로 배경 제거를 끝내지 않는다. 마스크 밖은 항상 검정으로 덮는다.
import type { NormalizedLandmark } from '../vision/sensor-types';

/** 가공 출력 규격. 인코딩 bitrate는 D-14가 소유한다. */
export const PROCESSED_FACE_SIZE = 160;
export const PROCESSED_FACE_FPS = 10;

/**
 * FaceLandmarker canonical face oval 인덱스.
 * 이 순서대로 이으면 얼굴 외곽 다각형이 된다.
 */
export const FACE_OVAL_INDICES: readonly number[] = Object.freeze([
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
  176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]);

/** 경계 오차를 흡수하려고 다각형을 중심 쪽으로 줄이는 비율. */
export const MASK_SHRINK = 0.92;

export type Point = Readonly<{ x: number; y: number }>;

export type FaceMask = Readonly<{
  /** 출력 캔버스 픽셀 좌표의 닫힌 다각형. */
  polygon: readonly Point[];
  /** 원본에서 잘라낼 정사각 영역(정규화 좌표). */
  crop: Readonly<{ x: number; y: number; size: number }>;
}>;

function centroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * 얼굴 외곽을 감싸는 정사각 crop과 그 안에서의 축소 다각형을 만든다.
 * 필수 외곽 점이 없으면 null이며 이때 안전 프레임으로 대체한다.
 */
export function buildFaceMask(
  landmarks: readonly NormalizedLandmark[],
  size: number = PROCESSED_FACE_SIZE,
): FaceMask | null {
  const oval: Point[] = [];
  for (const index of FACE_OVAL_INDICES) {
    const point = landmarks[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    oval.push({ x: point.x, y: point.y });
  }
  if (oval.length < 3) return null;

  const xs = oval.map((point) => point.x);
  const ys = oval.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return null;

  // 정사각 crop이라야 출력 비율이 왜곡되지 않는다.
  const cropSize = Math.max(width, height);
  const cropX = minX + width / 2 - cropSize / 2;
  const cropY = minY + height / 2 - cropSize / 2;

  const center = centroid(oval);
  const polygon = oval.map((point) => {
    // 중심 쪽으로 축소해 경계 밖 원본 픽셀이 남지 않게 한다.
    const shrunkX = center.x + (point.x - center.x) * MASK_SHRINK;
    const shrunkY = center.y + (point.y - center.y) * MASK_SHRINK;
    return {
      x: ((shrunkX - cropX) / cropSize) * size,
      y: ((shrunkY - cropY) / cropSize) * size,
    };
  });

  return { polygon, crop: { x: cropX, y: cropY, size: cropSize } };
}

/** 짝수-홀수 규칙의 점-다각형 판정. 마스크 밖 픽셀 검사에 쓴다. */
export function isInsidePolygon(polygon: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]!;
    const last = polygon[previous]!;
    const crosses = current.y > y !== last.y > y;
    if (!crosses) continue;
    const intersectX = ((last.x - current.x) * (y - current.y)) / (last.y - current.y) + current.x;
    if (x < intersectX) inside = !inside;
  }
  return inside;
}

/** 흑백 변환. 가공 출력은 색을 남기지 않는다. */
export function toGrayscale(red: number, green: number, blue: number): number {
  return Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
}

import { describe, expect, it } from 'vitest';

import {
  buildFaceMask,
  FACE_OVAL_INDICES,
  isInsidePolygon,
  MASK_SHRINK,
  PROCESSED_FACE_FPS,
  PROCESSED_FACE_SIZE,
  toGrayscale,
} from './face-mask';

const maxOval = Math.max(...FACE_OVAL_INDICES);

/** 화면 가운데의 작은 원형 얼굴 외곽을 만든다. */
function ovalLandmarks(centerX = 0.5, centerY = 0.5, radius = 0.12) {
  const points = Array.from({ length: maxOval + 1 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  FACE_OVAL_INDICES.forEach((index, order) => {
    const angle = (order / FACE_OVAL_INDICES.length) * Math.PI * 2;
    points[index] = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      z: 0,
    };
  });
  return points;
}

describe('buildFaceMask', () => {
  it('produces a square crop around the face oval', () => {
    const mask = buildFaceMask(ovalLandmarks());

    expect(mask).not.toBeNull();
    expect(mask!.crop.size).toBeCloseTo(0.24, 6);
    expect(mask!.crop.x).toBeCloseTo(0.38, 6);
    expect(mask!.crop.y).toBeCloseTo(0.38, 6);
    expect(mask!.polygon).toHaveLength(FACE_OVAL_INDICES.length);
  });

  it('shrinks the polygon inward so no boundary pixel survives', () => {
    const mask = buildFaceMask(ovalLandmarks())!;
    const centerPixel = PROCESSED_FACE_SIZE / 2;
    const radii = mask.polygon.map((point) =>
      Math.hypot(point.x - centerPixel, point.y - centerPixel),
    );

    // 축소하지 않았다면 반지름이 캔버스 절반과 같아야 한다.
    for (const radius of radii) expect(radius).toBeLessThan(centerPixel);
    expect(Math.max(...radii)).toBeCloseTo(centerPixel * MASK_SHRINK, 4);
  });

  it('returns null when a required oval point is missing or not finite', () => {
    const short = ovalLandmarks().slice(0, maxOval);
    expect(buildFaceMask(short)).toBeNull();

    const broken = ovalLandmarks();
    broken[FACE_OVAL_INDICES[0]!] = { x: Number.NaN, y: 0.5, z: 0 };
    expect(buildFaceMask(broken)).toBeNull();
  });

  it('returns null for a degenerate face with no area', () => {
    const flat = Array.from({ length: maxOval + 1 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(buildFaceMask(flat)).toBeNull();
  });

  it('keeps a face near the frame edge inside a square crop', () => {
    const mask = buildFaceMask(ovalLandmarks(0.1, 0.9, 0.08))!;
    expect(mask.crop.size).toBeCloseTo(0.16, 6);
    expect(mask.crop.x).toBeCloseTo(0.02, 6);
  });
});

describe('isInsidePolygon', () => {
  it('separates the masked interior from the background', () => {
    const mask = buildFaceMask(ovalLandmarks())!;
    const center = PROCESSED_FACE_SIZE / 2;

    expect(isInsidePolygon(mask.polygon, center, center)).toBe(true);
    // 네 모서리는 바깥이어야 한다. 사각 crop만으로는 배경이 남는다.
    expect(isInsidePolygon(mask.polygon, 1, 1)).toBe(false);
    expect(isInsidePolygon(mask.polygon, PROCESSED_FACE_SIZE - 1, 1)).toBe(false);
    expect(isInsidePolygon(mask.polygon, 1, PROCESSED_FACE_SIZE - 1)).toBe(false);
    expect(isInsidePolygon(mask.polygon, PROCESSED_FACE_SIZE - 1, PROCESSED_FACE_SIZE - 1)).toBe(
      false,
    );
  });

  it('leaves every pixel outside the mask available for the black fill', () => {
    const mask = buildFaceMask(ovalLandmarks())!;
    let outside = 0;
    let inside = 0;
    for (let y = 0; y < PROCESSED_FACE_SIZE; y += 4)
      for (let x = 0; x < PROCESSED_FACE_SIZE; x += 4)
        if (isInsidePolygon(mask.polygon, x, y)) inside += 1;
        else outside += 1;

    expect(inside).toBeGreaterThan(0);
    // 원형 마스크는 정사각 캔버스의 약 21%를 남긴다.
    expect(outside / (inside + outside)).toBeGreaterThan(0.15);
  });
});

describe('output format', () => {
  it('pins the processed face size and frame rate', () => {
    expect(PROCESSED_FACE_SIZE).toBe(160);
    expect(PROCESSED_FACE_FPS).toBe(10);
  });

  it('converts colour to a single grey level', () => {
    expect(toGrayscale(0, 0, 0)).toBe(0);
    expect(toGrayscale(255, 255, 255)).toBe(255);
    expect(toGrayscale(255, 0, 0)).toBe(76);
  });
});

// 전후 기울임 신호 결합 회귀: 어깨·얼굴 성분, 한쪽만 있을 때, 둘 다 없을 때, 얼굴 크기 신호.
import { describe, expect, it } from 'vitest';
import { leanComponents, relativeLean } from './lean-signal';
import { FACE_KEY_POINTS, faceSpanSignal } from '../vision/face-sensor';
import { POSE_KEY_POINTS, type PoseLandmark } from '../vision/pose-sensor';

function pose(halfSpan = 0.1): PoseLandmark[] {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  points[POSE_KEY_POINTS.nose] = { x: 0.5, y: 0.1, z: 0, visibility: 1 };
  points[POSE_KEY_POINTS.leftShoulder] = { x: 0.5 - halfSpan, y: 0.3, z: 0, visibility: 1 };
  points[POSE_KEY_POINTS.rightShoulder] = { x: 0.5 + halfSpan, y: 0.3, z: 0, visibility: 1 };
  return points;
}

function face(halfSpan = 0.08) {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[FACE_KEY_POINTS.leftCheek] = { x: 0.5 + halfSpan, y: 0.5, z: 0 };
  points[FACE_KEY_POINTS.rightCheek] = { x: 0.5 - halfSpan, y: 0.5, z: 0 };
  return points;
}

describe('faceSpanSignal', () => {
  it('is the log of the cheek distance and null when the face is collapsed or incomplete', () => {
    expect(faceSpanSignal(face(0.08))).toBeCloseTo(Math.log(0.16), 6);
    expect(faceSpanSignal(face(0.002))).toBeNull();
    expect(faceSpanSignal([])).toBeNull();
  });
});

describe('lean components and relative lean', () => {
  const neutral = { shoulderSpan: Math.log(0.2), faceSpan: Math.log(0.16) };

  it('averages shoulder and face log-ratios when both are calibrated', () => {
    // Shoulders 20% wider, face 40% wider: closer to the camera, face moves more.
    const current = leanComponents(pose(0.12), face(0.112));
    const rel = relativeLean(current, neutral);
    expect(rel.shoulder).toBeCloseTo(Math.log(1.2), 6);
    expect(rel.face).toBeCloseTo(Math.log(1.4), 6);
    expect(rel.combined).toBeCloseTo((Math.log(1.2) + Math.log(1.4)) / 2, 6);
  });

  it('falls back to the shoulder alone when the face neutral or face landmarks are missing', () => {
    const shoulderOnly = relativeLean(leanComponents(pose(0.08), null), neutral);
    expect(shoulderOnly.face).toBeNull();
    expect(shoulderOnly.combined).toBeCloseTo(Math.log(0.8), 6);
    const noFaceNeutral = relativeLean(leanComponents(pose(0.08), face()), {
      shoulderSpan: Math.log(0.2),
      faceSpan: null,
    });
    expect(noFaceNeutral.combined).toBeCloseTo(Math.log(0.8), 6);
  });

  it('uses the face alone when the shoulders are not readable, and null when nothing is', () => {
    const faceOnly = relativeLean(leanComponents(null, face(0.04)), neutral);
    expect(faceOnly.shoulder).toBeNull();
    expect(faceOnly.combined).toBeCloseTo(Math.log(0.5), 6);
    expect(relativeLean(leanComponents(null, null), neutral).combined).toBeNull();
  });
});

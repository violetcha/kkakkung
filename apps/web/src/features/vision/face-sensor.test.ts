import { describe, expect, it } from 'vitest';

import {
  FACE_KEY_POINTS,
  FACE_MAX_YAW_RAD,
  faceYawFromLandmarks,
  faceYawFromMatrix,
  mirrorForDisplay,
  mirrorNormalizedX,
  mirrorYaw,
  readFaceSensor,
  toUserYaw,
  type RawFaceResult,
} from './face-sensor';
import { isSampleFresh, isUsableQuality, type Sample } from './sensor-types';

const maxIndex = Math.max(...Object.values(FACE_KEY_POINTS));

function landmarks(overrides: Record<number, { x: number; y: number; z: number }> = {}) {
  const points = Array.from({ length: maxIndex + 1 }, (_, index) => ({
    x: 0.5 + index * 0.0001,
    y: 0.5,
    z: 0,
  }));
  for (const [index, value] of Object.entries(overrides)) points[Number(index)] = value;
  return points;
}

/** 열 우선 4x4에서 yaw만 준 회전 행렬. */
function yawMatrix(yaw: number) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    rows: 4,
    columns: 4,
    data: [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, 0, 0, 0, 1],
  };
}

const result = (over: Partial<RawFaceResult> = {}): RawFaceResult => ({
  faceLandmarks: [landmarks()],
  facialTransformationMatrixes: [yawMatrix(0)],
  ...over,
});

describe('readFaceSensor', () => {
  it('returns a finite yaw and usable validity for a frontal face', () => {
    const outcome = readFaceSensor(result());

    expect(outcome.status).toBe('valid');
    if (outcome.status !== 'valid') throw new Error('expected a valid face');
    expect(Number.isFinite(outcome.data.yawRad)).toBe(true);
    expect(outcome.data.quality).toBe('valid');
    expect(isUsableQuality(outcome.data.quality)).toBe(true);
    expect(outcome.data.landmarks).toHaveLength(maxIndex + 1);
  });

  it('carries no raw frame, only timestamps-free normalized values', () => {
    const outcome = readFaceSensor(result());
    if (outcome.status !== 'valid') throw new Error('expected a valid face');

    expect(Object.keys(outcome.data).sort()).toEqual(['landmarks', 'quality', 'yawRad']);
    expect(Object.keys(outcome.data.landmarks[0]!).sort()).toEqual(['x', 'y', 'z']);
  });

  it('reports missing for an empty face list', () => {
    expect(readFaceSensor(result({ faceLandmarks: [] }))).toEqual({
      status: 'missing',
      data: null,
    });
    expect(readFaceSensor(null)).toEqual({ status: 'missing', data: null });
  });

  it('reports missing when any landmark is not finite', () => {
    const broken = landmarks({ [FACE_KEY_POINTS.noseTip]: { x: Number.NaN, y: 0.5, z: 0 } });
    expect(readFaceSensor(result({ faceLandmarks: [broken] }))).toEqual({
      status: 'missing',
      data: null,
    });
  });

  it('reports missing when a required key point is absent', () => {
    const short = landmarks().slice(0, FACE_KEY_POINTS.chin);
    expect(readFaceSensor(result({ faceLandmarks: [short] }))).toEqual({
      status: 'missing',
      data: null,
    });
  });

  it('marks a sharp turn uncertain instead of valid', () => {
    const outcome = readFaceSensor(result({ facialTransformationMatrixes: [yawMatrix(1.4)] }));
    if (outcome.status !== 'valid') throw new Error('expected a valid face');

    expect(Math.abs(outcome.data.yawRad)).toBeGreaterThan(FACE_MAX_YAW_RAD);
    expect(outcome.data.quality).toBe('uncertain');
    expect(isUsableQuality(outcome.data.quality)).toBe(false);
  });

  it('falls back to landmark geometry when no transformation matrix is present', () => {
    const turned = landmarks({
      [FACE_KEY_POINTS.rightCheek]: { x: 0.3, y: 0.5, z: 0 },
      [FACE_KEY_POINTS.leftCheek]: { x: 0.7, y: 0.5, z: 0 },
      [FACE_KEY_POINTS.noseTip]: { x: 0.6, y: 0.5, z: 0 },
    });
    const outcome = readFaceSensor({ faceLandmarks: [turned] });
    if (outcome.status !== 'valid') throw new Error('expected a valid face');

    // Nose toward the subject's left cheek (large x in the unmirrored frame) = head turned to the
    // user's left = negative user yaw.
    expect(outcome.data.yawRad).toBeLessThan(0);
    expect(faceYawFromLandmarks(turned)).toBeGreaterThan(0);
  });

  it('does not read a face-level confidence field that the installed SDK lacks', () => {
    const withScore = { faceLandmarks: [landmarks()], score: 0.1 } as RawFaceResult;
    const outcome = readFaceSensor(withScore);

    expect(outcome.status).toBe('valid');
  });
});

describe('faceYawFromMatrix', () => {
  it('recovers the yaw that built the matrix', () => {
    expect(faceYawFromMatrix(yawMatrix(0.5))).toBeCloseTo(0.5, 6);
    expect(faceYawFromMatrix(yawMatrix(-0.75))).toBeCloseTo(-0.75, 6);
  });

  it('returns null for a truncated or non finite matrix', () => {
    expect(faceYawFromMatrix({ data: [1, 0] })).toBeNull();
    expect(faceYawFromMatrix({ data: Array.from({ length: 16 }, () => Number.NaN) })).toBeNull();
  });
});

describe('mirror helpers', () => {
  it('returns the original value when the display mirror is applied twice', () => {
    expect(mirrorNormalizedX(mirrorNormalizedX(0.2))).toBeCloseTo(0.2, 12);
    const point = { x: 0.2, y: 0.4, z: 0.1 };
    const round = mirrorForDisplay(mirrorForDisplay(point));
    expect(round.x).toBeCloseTo(point.x, 12);
    expect(round.y).toBe(point.y);
    expect(round.z).toBe(point.z);
    expect(mirrorYaw(mirrorYaw(0.3))).toBeCloseTo(0.3, 12);
  });

  it('reports the user-side yaw: raw screen-right rotation becomes a negative (left) turn', () => {
    const outcome = readFaceSensor(result({ facialTransformationMatrixes: [yawMatrix(0.4)] }));
    if (outcome.status !== 'valid') throw new Error('expected a valid face');
    const displayed = outcome.data.landmarks.map(mirrorForDisplay);

    expect(displayed[0]!.x).toBeCloseTo(1 - outcome.data.landmarks[0]!.x, 12);
    expect(faceYawFromMatrix(yawMatrix(0.4))).toBeCloseTo(0.4, 6);
    expect(outcome.data.yawRad).toBeCloseTo(-0.4, 6);
    expect(toUserYaw(toUserYaw(0.3))).toBeCloseTo(0.3, 12);
  });
});

describe('face freshness', () => {
  it('cannot use a cached face older than 300ms', () => {
    const sample = {
      frameId: 4,
      sampledAtMs: 1000,
      receivedAtMs: 1005,
      status: 'valid',
      data: { landmarks: [], yawRad: 0, quality: 'valid' },
    } as const satisfies Sample<{
      landmarks: readonly never[];
      yawRad: number;
      quality: 'valid';
    }>;

    expect(isSampleFresh(sample, 'face', 1300)).toBe(true);
    expect(isSampleFresh(sample, 'face', 1301)).toBe(false);
  });

  it('does not extend the pose age when only the face frameId advances', () => {
    const pose = {
      frameId: 10,
      sampledAtMs: 1000,
      receivedAtMs: 1020,
      status: 'valid',
      data: { landmarks: [], quality: 'valid' },
    } as const;

    // face가 1600에 갱신돼도 pose 자신의 sampledAtMs만 본다.
    expect(isSampleFresh(pose, 'pose', 1600)).toBe(false);
  });
});

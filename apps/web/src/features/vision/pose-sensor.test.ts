import { describe, expect, it } from 'vitest';

import {
  isJointVisible,
  normalizePoseLandmarks,
  normalizeVisibility,
  POSE_KEY_POINTS,
  POSE_MIN_VISIBILITY,
  poseQuality,
  readPoseSensor,
  torsoLeanRad,
  type PoseLandmark,
} from './pose-sensor';
import { isSampleFresh, isUsableQuality } from './sensor-types';

const maxIndex = Math.max(...Object.values(POSE_KEY_POINTS));

type Raw = { x: number; y: number; z: number; visibility?: number };

function body(overrides: Record<number, Raw> = {}): Raw[] {
  const points: Raw[] = Array.from({ length: maxIndex + 1 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));
  points[POSE_KEY_POINTS.nose] = { x: 0.5, y: 0.1, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.leftShoulder] = { x: 0.4, y: 0.3, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.rightShoulder] = { x: 0.6, y: 0.3, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.leftHip] = { x: 0.42, y: 0.7, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.rightHip] = { x: 0.58, y: 0.7, z: 0, visibility: 0.9 };
  for (const [index, value] of Object.entries(overrides)) points[Number(index)] = value;
  return points;
}

describe('readPoseSensor', () => {
  it('returns normalized upper body landmarks with a lean for a full body', () => {
    const outcome = readPoseSensor({ landmarks: [body()] });

    expect(outcome.status).toBe('valid');
    if (outcome.status !== 'valid') throw new Error('expected a valid pose');
    expect(outcome.data.quality).toBe('valid');
    expect(isUsableQuality(outcome.data.quality)).toBe(true);
    const lean = torsoLeanRad(outcome.data.landmarks as readonly PoseLandmark[]);
    expect(lean).not.toBeNull();
    expect(Math.abs(lean!)).toBeLessThan(0.1);
  });

  it('uses face-to-shoulder depth for forward/back without relying on hips', () => {
    const forward = body({
      [POSE_KEY_POINTS.nose]: { x: 0.5, y: 0.1, z: -0.1, visibility: 0.9 },
    });
    const back = body({
      [POSE_KEY_POINTS.nose]: { x: 0.5, y: 0.1, z: 0.1, visibility: 0.9 },
    });

    const leanForward = torsoLeanRad(normalizePoseLandmarks(forward)!);
    const leanBack = torsoLeanRad(normalizePoseLandmarks(back)!);

    expect(leanForward!).toBeGreaterThan(0);
    expect(leanBack!).toBeLessThan(0);
  });

  it('marks a hidden wrist uncertain so the consumer resets its hold', () => {
    const hidden = body({
      [POSE_KEY_POINTS.leftWrist]: { x: 0.4, y: 0.6, z: 0, visibility: 0.1 },
    });
    const outcome = readPoseSensor({ landmarks: [hidden] });
    if (outcome.status !== 'valid') throw new Error('expected a valid pose');

    expect(outcome.data.quality).toBe('uncertain');
    expect(isUsableQuality(outcome.data.quality)).toBe(false);
  });

  it('accepts a seated upper body even when the hips are unseen or invalid', () => {
    const seated = body({
      [POSE_KEY_POINTS.leftHip]: { x: Number.NaN, y: 1.5, z: 0, visibility: 0 },
      [POSE_KEY_POINTS.rightHip]: { x: 0.58, y: 1.5, z: 0, visibility: 0 },
    });
    const outcome = readPoseSensor({ landmarks: [seated] });
    if (outcome.status !== 'valid') throw new Error('expected a valid pose');

    expect(outcome.data.quality).toBe('valid');
    expect(torsoLeanRad(outcome.data.landmarks as readonly PoseLandmark[])).toBe(0);
  });

  it('accepts face, shoulders and hands without any lower-body landmarks', () => {
    const upperOnly = body().slice(0, POSE_KEY_POINTS.rightWrist + 1);
    expect(readPoseSensor({ landmarks: [upperOnly] })).toMatchObject({
      status: 'valid',
      data: { quality: 'valid' },
    });
  });

  it('refuses a hidden face or shoulder instead of inventing a neutral reference', () => {
    for (const index of [POSE_KEY_POINTS.nose, POSE_KEY_POINTS.leftShoulder]) {
      const points = body();
      points[index]!.visibility = 0;
      expect(readPoseSensor({ landmarks: [points] })).toEqual({ status: 'missing', data: null });
    }
  });

  it('reports missing for no body, a non finite coordinate or a flat upper-body axis', () => {
    expect(readPoseSensor({ landmarks: [] })).toEqual({ status: 'missing', data: null });
    expect(readPoseSensor(null)).toEqual({ status: 'missing', data: null });
    const broken = body({
      [POSE_KEY_POINTS.leftShoulder]: { x: Number.POSITIVE_INFINITY, y: 0.3, z: 0 },
    });
    expect(readPoseSensor({ landmarks: [broken] })).toEqual({ status: 'missing', data: null });
    const flat = body({
      [POSE_KEY_POINTS.nose]: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
    });
    expect(readPoseSensor({ landmarks: [flat] })).toEqual({ status: 'missing', data: null });
  });

  it('normalizes a missing visibility to zero instead of guessing presence', () => {
    expect(normalizeVisibility(undefined)).toBe(0);
    expect(normalizeVisibility(Number.NaN)).toBe(0);
    expect(normalizeVisibility(0.42)).toBe(0.42);

    const outcome = readPoseSensor({
      landmarks: [body({ [POSE_KEY_POINTS.leftWrist]: { x: 0.4, y: 0.6, z: 0 } })],
    });
    if (outcome.status !== 'valid') throw new Error('expected a valid pose');
    expect(outcome.data.landmarks[POSE_KEY_POINTS.leftWrist]!.visibility).toBe(0);
    expect(outcome.data.quality).toBe('uncertain');
  });

  it('does not read a presence or overall confidence field the SDK lacks', () => {
    const outcome = readPoseSensor({ landmarks: [body()], presence: 0.1 } as never);
    if (outcome.status !== 'valid') throw new Error('expected a valid pose');

    expect(Object.keys(outcome.data).sort()).toEqual(['landmarks', 'quality']);
    expect(Object.keys(outcome.data.landmarks[0]!).sort()).toEqual(['visibility', 'x', 'y', 'z']);
  });

  it('treats a pose sample older than 300ms as unusable', () => {
    const sample = {
      frameId: 10,
      sampledAtMs: 1000,
      receivedAtMs: 1020,
      status: 'valid',
      data: { landmarks: [], quality: 'valid' },
    } as const;

    expect(isSampleFresh(sample, 'pose', 1300)).toBe(true);
    expect(isSampleFresh(sample, 'pose', 1301)).toBe(false);
  });
});

describe('isJointVisible', () => {
  it('uses the shared visibility threshold', () => {
    expect(isJointVisible({ x: 0, y: 0, z: 0, visibility: POSE_MIN_VISIBILITY })).toBe(true);
    expect(isJointVisible({ x: 0, y: 0, z: 0, visibility: POSE_MIN_VISIBILITY - 0.01 })).toBe(
      false,
    );
    expect(isJointVisible(undefined)).toBe(false);
  });
});

describe('poseQuality', () => {
  it('is uncertain when a required trunk joint is not visible', () => {
    const landmarks = normalizePoseLandmarks(
      body({ [POSE_KEY_POINTS.rightShoulder]: { x: 0.6, y: 0.3, z: 0, visibility: 0 } }),
    )!;
    expect(poseQuality(landmarks)).toBe('uncertain');
  });
});

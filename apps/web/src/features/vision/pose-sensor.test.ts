import { describe, expect, it } from 'vitest';

import {
  isJointVisible,
  normalizePoseLandmarks,
  normalizeVisibility,
  POSE_KEY_POINTS,
  POSE_MIN_VISIBILITY,
  poseQuality,
  readPoseSensor,
  leanSignal,
  armsVisible,
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
    const lean = leanSignal(outcome.data.landmarks as readonly PoseLandmark[]);
    expect(lean).not.toBeNull();
    // 어깨 거리 0.2 의 자연로그. 중립을 빼면 0 이 된다.
    expect(lean!).toBeCloseTo(Math.log(0.2), 6);
  });

  it('reads forward/back from the shoulder span growing or shrinking, not from nose depth', () => {
    const neutral = leanSignal(normalizePoseLandmarks(body())!)!;
    const forward = body({
      [POSE_KEY_POINTS.leftShoulder]: { x: 0.38, y: 0.3, z: 0, visibility: 0.9 },
      [POSE_KEY_POINTS.rightShoulder]: { x: 0.62, y: 0.3, z: 0, visibility: 0.9 },
    });
    const back = body({
      [POSE_KEY_POINTS.leftShoulder]: { x: 0.42, y: 0.3, z: 0, visibility: 0.9 },
      [POSE_KEY_POINTS.rightShoulder]: { x: 0.58, y: 0.3, z: 0, visibility: 0.9 },
    });
    // Nose depth alone changes nothing: the whole upper body moves together on a webcam.
    const noseOnly = body({
      [POSE_KEY_POINTS.nose]: { x: 0.5, y: 0.1, z: -0.1, visibility: 0.9 },
    });

    expect(leanSignal(normalizePoseLandmarks(forward)!)! - neutral).toBeCloseTo(Math.log(1.2), 6);
    expect(leanSignal(normalizePoseLandmarks(back)!)! - neutral).toBeCloseTo(Math.log(0.8), 6);
    expect(leanSignal(normalizePoseLandmarks(noseOnly)!)! - neutral).toBeCloseTo(0, 6);
  });

  it('ignores shoulder depth: a head turn that shakes z must not look like leaning', () => {
    const neutral = leanSignal(normalizePoseLandmarks(body())!)!;
    const shakenZ = body({
      [POSE_KEY_POINTS.leftShoulder]: { x: 0.4, y: 0.3, z: -0.15, visibility: 0.9 },
      [POSE_KEY_POINTS.rightShoulder]: { x: 0.6, y: 0.3, z: 0.12, visibility: 0.9 },
    });
    expect(leanSignal(normalizePoseLandmarks(shakenZ)!)! - neutral).toBeCloseTo(0, 6);
  });

  it('returns null for a collapsed shoulder span', () => {
    const collapsed = body({
      [POSE_KEY_POINTS.leftShoulder]: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      [POSE_KEY_POINTS.rightShoulder]: { x: 0.505, y: 0.3, z: 0, visibility: 0.9 },
    });
    expect(leanSignal(normalizePoseLandmarks(collapsed)!)).toBeNull();
    expect(readPoseSensor({ landmarks: [collapsed] }).status).toBe('missing');
  });

  it('stays valid with hidden wrists and elbows: calibration and movement need only face and shoulders', () => {
    const hidden = body({
      [POSE_KEY_POINTS.leftElbow]: { x: 0.35, y: 0.5, z: 0, visibility: 0.1 },
      [POSE_KEY_POINTS.rightElbow]: { x: 0.65, y: 0.5, z: 0, visibility: 0.1 },
      [POSE_KEY_POINTS.leftWrist]: { x: 0.4, y: 0.6, z: 0, visibility: 0.1 },
      [POSE_KEY_POINTS.rightWrist]: { x: 0.6, y: 0.6, z: 0, visibility: 0.1 },
    });
    const outcome = readPoseSensor({ landmarks: [hidden] });
    if (outcome.status !== 'valid') throw new Error('expected a valid pose');

    expect(outcome.data.quality).toBe('valid');
    expect(isUsableQuality(outcome.data.quality)).toBe(true);
    expect(armsVisible(outcome.data.landmarks as readonly PoseLandmark[])).toBe(false);
    expect(armsVisible(normalizePoseLandmarks(body())!)).toBe(true);
  });

  it('accepts a seated upper body even when the hips are unseen or invalid', () => {
    const seated = body({
      [POSE_KEY_POINTS.leftHip]: { x: Number.NaN, y: 1.5, z: 0, visibility: 0 },
      [POSE_KEY_POINTS.rightHip]: { x: 0.58, y: 1.5, z: 0, visibility: 0 },
    });
    const outcome = readPoseSensor({ landmarks: [seated] });
    if (outcome.status !== 'valid') throw new Error('expected a valid pose');

    expect(outcome.data.quality).toBe('valid');
    expect(leanSignal(outcome.data.landmarks as readonly PoseLandmark[])).toBeCloseTo(
      Math.log(0.2),
      6,
    );
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

  it('reports missing for no body, a non finite coordinate or a collapsed shoulder span', () => {
    expect(readPoseSensor({ landmarks: [] })).toEqual({ status: 'missing', data: null });
    expect(readPoseSensor(null)).toEqual({ status: 'missing', data: null });
    const broken = body({
      [POSE_KEY_POINTS.leftShoulder]: { x: Number.POSITIVE_INFINITY, y: 0.3, z: 0 },
    });
    expect(readPoseSensor({ landmarks: [broken] })).toEqual({ status: 'missing', data: null });
    const collapsed = body({
      [POSE_KEY_POINTS.leftShoulder]: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      [POSE_KEY_POINTS.rightShoulder]: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
    });
    expect(readPoseSensor({ landmarks: [collapsed] })).toEqual({ status: 'missing', data: null });
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
    // A hidden wrist no longer blocks calibration or movement; only the arm check sees it.
    expect(outcome.data.quality).toBe('valid');
    expect(armsVisible(outcome.data.landmarks as readonly PoseLandmark[])).toBe(false);
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

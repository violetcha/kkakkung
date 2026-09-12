import { describe, expect, it } from 'vitest';

import { POSE_KEY_POINTS, readPoseSensor } from '../vision/pose-sensor';
import type { SensorSnapshot } from '../vision/sensor-types';
import { createCalibrator, isNeutralUsable, relativeToNeutral } from './calibration';
import { INPUT_TUNING } from './input-tuning';

const GENERATION = 3;

function poseLandmarks(leanOffset = 0) {
  const points = Array.from({ length: Math.max(...Object.values(POSE_KEY_POINTS)) + 1 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));
  points[POSE_KEY_POINTS.nose] = { x: 0.5, y: 0.1, z: -leanOffset, visibility: 0.9 };
  points[POSE_KEY_POINTS.leftShoulder] = { x: 0.4 + leanOffset, y: 0.3, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.rightShoulder] = { x: 0.6 + leanOffset, y: 0.3, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.leftHip] = { x: 0.4, y: 1.7, z: 0, visibility: 0 };
  points[POSE_KEY_POINTS.rightHip] = { x: 0.6, y: 1.7, z: 0, visibility: 0 };
  return points;
}

function snapshot(
  frameId: number,
  atMs: number,
  options: {
    yaw?: number;
    leanOffset?: number;
    faceQuality?: 'valid' | 'uncertain';
    poseMissing?: boolean;
    generation?: number;
  } = {},
): SensorSnapshot {
  return {
    runtimeGeneration: options.generation ?? GENERATION,
    emittedAtMs: atMs,
    face: {
      frameId,
      sampledAtMs: atMs,
      receivedAtMs: atMs,
      status: 'valid',
      data: {
        landmarks: [],
        yawRad: options.yaw ?? 0.02,
        quality: options.faceQuality ?? 'valid',
      },
    },
    pose: options.poseMissing
      ? { frameId, sampledAtMs: atMs, receivedAtMs: atMs, status: 'missing', data: null }
      : {
          frameId,
          sampledAtMs: atMs,
          receivedAtMs: atMs,
          status: 'valid',
          data: { landmarks: poseLandmarks(options.leanOffset), quality: 'valid' },
        },
    gesture: null,
  };
}

function feed(
  calibrator: ReturnType<typeof createCalibrator>,
  count: number,
  options: Parameters<typeof snapshot>[2] = {},
) {
  let accepted = 0;
  for (let index = 0; index < count; index += 1) {
    const at = 1000 + index * 40;
    if (calibrator.observe(snapshot(index + 1, at, options), at)) accepted += 1;
  }
  return accepted;
}

describe('createCalibrator', () => {
  it('does not reuse one cached pose as eight independent calibration samples', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);
    const pose = snapshot(1, 1000).pose;
    for (let i = 0; i < 8; i++)
      calibrator.observe({ ...snapshot(i + 1, 1000 + i * 30), pose }, 1000 + i * 30);
    expect(calibrator.sampleCount).toBe(1);
    expect(calibrator.finish().state).toBe('failed');
  });
  it('calibrates normalized upper-body observations with no hips or legs in frame', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);
    const pose = readPoseSensor({
      landmarks: [poseLandmarks().slice(0, POSE_KEY_POINTS.rightWrist + 1)],
    });
    for (let index = 0; index < INPUT_TUNING.calibrationMinSamples; index++) {
      const at = 1000 + index * 40;
      const value = snapshot(index + 1, at);
      calibrator.observe(
        { ...value, pose: { frameId: index + 1, sampledAtMs: at, receivedAtMs: at, ...pose } },
        at,
      );
    }
    expect(calibrator.finish()).toMatchObject({ state: 'ready', errorCode: null });
  });
  it('produces a neutral reference from enough stable samples', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);
    feed(calibrator, INPUT_TUNING.calibrationMinSamples);

    const result = calibrator.finish();

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('expected a ready calibration');
    expect(result.neutral.sampleCount).toBe(INPUT_TUNING.calibrationMinSamples);
    expect(result.neutral.yawRad).toBeCloseTo(0.02, 6);
    expect(result.neutral.tuningVersion).toBe(INPUT_TUNING.tuningVersion);
    expect(result.neutral.runtimeGeneration).toBe(GENERATION);
    expect(calibrator.state).toBe('ready');
  });

  it('stays uncalibrated when too few samples arrive', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);
    feed(calibrator, INPUT_TUNING.calibrationMinSamples - 1);

    const result = calibrator.finish();

    expect(result).toEqual({
      state: 'failed',
      neutral: null,
      errorCode: 'CALIBRATION_NOT_ENOUGH_SAMPLES',
    });
    expect(calibrator.getNeutral()).toBeNull();
  });

  it('reports which sensor was missing when nothing was collected', () => {
    const noPose = createCalibrator();
    noPose.begin(GENERATION);
    feed(noPose, 10, { poseMissing: true });
    expect(noPose.finish()).toMatchObject({ errorCode: 'CALIBRATION_NO_POSE' });

    const noFace = createCalibrator();
    noFace.begin(GENERATION);
    feed(noFace, 10, { faceQuality: 'uncertain' });
    expect(noFace.finish()).toMatchObject({ errorCode: 'CALIBRATION_NO_FACE' });
  });

  it('rejects an unstable capture instead of averaging a moving head', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);
    for (let index = 0; index < INPUT_TUNING.calibrationMinSamples; index += 1) {
      const at = 1000 + index * 40;
      calibrator.observe(snapshot(index + 1, at, { yaw: index * 0.2 }), at);
    }

    expect(calibrator.finish()).toMatchObject({
      state: 'failed',
      errorCode: 'CALIBRATION_UNSTABLE',
    });
  });

  it('ignores stale samples, repeated frame ids and uncertain quality', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);

    // 같은 frameId를 다시 세지 않는다.
    expect(calibrator.observe(snapshot(1, 1000), 1000)).toBe(true);
    expect(calibrator.observe(snapshot(1, 1040), 1040)).toBe(false);
    // 300ms를 넘긴 표본은 신선하지 않다.
    expect(calibrator.observe(snapshot(2, 1000), 1400)).toBe(false);
    // uncertain 얼굴은 유효 표본이 아니다.
    expect(calibrator.observe(snapshot(3, 1100, { faceQuality: 'uncertain' }), 1100)).toBe(false);
    expect(calibrator.sampleCount).toBe(1);
  });

  it('ignores samples from another runtime generation', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);

    expect(calibrator.observe(snapshot(1, 1000, { generation: GENERATION + 1 }), 1000)).toBe(false);
    expect(calibrator.sampleCount).toBe(0);
  });

  it('drops the previous neutral when a new generation starts', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);
    feed(calibrator, INPUT_TUNING.calibrationMinSamples);
    calibrator.finish();
    expect(calibrator.getNeutral()).not.toBeNull();

    calibrator.begin(GENERATION + 1);

    expect(calibrator.getNeutral()).toBeNull();
    expect(calibrator.state).toBe('running');
  });

  it('clears everything on reset', () => {
    const calibrator = createCalibrator();
    calibrator.begin(GENERATION);
    feed(calibrator, INPUT_TUNING.calibrationMinSamples);
    calibrator.finish();

    calibrator.reset();

    expect(calibrator.state).toBe('idle');
    expect(calibrator.getNeutral()).toBeNull();
    expect(calibrator.observe(snapshot(1, 1000), 1000)).toBe(false);
  });

  it('does not accept observations before begin', () => {
    const calibrator = createCalibrator();
    expect(calibrator.observe(snapshot(1, 1000), 1000)).toBe(false);
    expect(calibrator.state).toBe('idle');
  });
});

describe('isNeutralUsable', () => {
  it('refuses a neutral from another generation or tuning version', () => {
    const neutral = {
      yawRad: 0,
      leanRad: 0,
      tuningVersion: INPUT_TUNING.tuningVersion,
      runtimeGeneration: GENERATION,
      sampleCount: 10,
    };

    expect(isNeutralUsable(neutral, GENERATION)).toBe(true);
    expect(isNeutralUsable(neutral, GENERATION + 1)).toBe(false);
    expect(isNeutralUsable({ ...neutral, tuningVersion: 'other' }, GENERATION)).toBe(false);
    expect(isNeutralUsable(null, GENERATION)).toBe(false);
  });
});

describe('relativeToNeutral', () => {
  it('returns null before calibration so no action can fire', () => {
    expect(relativeToNeutral(0.9, undefined)).toBeNull();
    expect(relativeToNeutral(0.9, 0.1)).toBeCloseTo(0.8, 6);
    expect(relativeToNeutral(Number.NaN, 0.1)).toBeNull();
  });
});

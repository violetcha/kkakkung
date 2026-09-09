import { describe, expect, it } from 'vitest';

import type { SensorSnapshot } from '../vision/sensor-types';
import { PROCESSED_FACE_SIZE } from './face-mask';
import {
  createSafeFacePolicy,
  defaultFaceShape,
  SAFE_FACE_HOLD_MS,
  SAFE_FACE_TUNING_VERSION,
} from './safe-face';

const GENERATION = 2;

function snapshot(
  frameId: number,
  atMs: number,
  options: { quality?: 'valid' | 'uncertain'; missing?: boolean; generation?: number } = {},
): SensorSnapshot {
  return {
    runtimeGeneration: options.generation ?? GENERATION,
    emittedAtMs: atMs,
    face: options.missing
      ? { frameId, sampledAtMs: atMs, receivedAtMs: atMs, status: 'missing', data: null }
      : {
          frameId,
          sampledAtMs: atMs,
          receivedAtMs: atMs,
          status: 'valid',
          data: { landmarks: [], yawRad: 0, quality: options.quality ?? 'valid' },
        },
    pose: null,
    gesture: null,
  };
}

describe('createSafeFacePolicy', () => {
  it('draws the live face while the sample stays fresh and valid', () => {
    const policy = createSafeFacePolicy();

    const decision = policy.decide(snapshot(1, 1000), 1000, GENERATION);

    expect(decision).toEqual({ mode: 'live', frameId: 1 });
    expect(policy.mode).toBe('live');
  });

  it('holds the last safe frame before falling back to the default face', () => {
    const policy = createSafeFacePolicy();
    policy.decide(snapshot(1, 1000), 1000, GENERATION);

    expect(policy.decide(snapshot(2, 1100, { missing: true }), 1100, GENERATION).mode).toBe('hold');
    expect(policy.decide(null, 1000 + SAFE_FACE_HOLD_MS, GENERATION).mode).toBe('hold');
    expect(policy.decide(null, 1000 + SAFE_FACE_HOLD_MS + 1, GENERATION).mode).toBe('default');
  });

  it('never holds the last real face indefinitely', () => {
    const policy = createSafeFacePolicy();
    policy.decide(snapshot(1, 1000), 1000, GENERATION);

    expect(policy.decide(null, 1_000_000, GENERATION).mode).toBe('default');
  });

  it('treats an uncertain or stale face as a tracking failure', () => {
    const policy = createSafeFacePolicy();
    policy.decide(snapshot(1, 1000), 1000, GENERATION);

    expect(policy.decide(snapshot(2, 1100, { quality: 'uncertain' }), 1100, GENERATION).mode).toBe(
      'hold',
    );
    // sampledAtMs 기준 301ms를 넘긴 결과는 새 검출이 아니다.
    expect(policy.decide(snapshot(3, 1100), 1401, GENERATION).mode).toBe('hold');
  });

  it('does not let an older generation result overwrite the default face', () => {
    const policy = createSafeFacePolicy();
    policy.decide(snapshot(1, 1000), 1000, GENERATION);
    policy.decide(null, 1_000_000, GENERATION);
    expect(policy.mode).toBe('default');

    const stale = policy.decide(
      snapshot(9, 1_000_000, { generation: GENERATION - 1 }),
      1_000_000,
      GENERATION,
    );

    expect(stale.mode).toBe('default');
    expect(stale.frameId).toBeNull();
  });

  it('recovers to live on a fresh sample of the current generation', () => {
    const policy = createSafeFacePolicy();
    policy.decide(snapshot(1, 1000), 1000, GENERATION);
    policy.decide(null, 1_000_000, GENERATION);

    const recovered = policy.decide(snapshot(20, 1_000_010), 1_000_010, GENERATION);

    expect(recovered).toEqual({ mode: 'live', frameId: 20 });
  });

  it('does not count the same frameId as a new detection', () => {
    const policy = createSafeFacePolicy();
    policy.decide(snapshot(5, 1000), 1000, GENERATION);

    const repeat = policy.decide(snapshot(5, 1000), 1100, GENERATION);

    expect(repeat.mode).toBe('live');
    expect(repeat.frameId).toBeNull();
  });

  it('clears the hold on reset', () => {
    const policy = createSafeFacePolicy();
    policy.decide(snapshot(1, 1000), 1000, GENERATION);

    policy.reset();

    expect(policy.mode).toBe('default');
    expect(policy.decide(null, 1010, GENERATION).mode).toBe('default');
  });

  it('records the hold time as an explicit initial value, not a spec constant', () => {
    expect(SAFE_FACE_HOLD_MS).toBe(1200);
    expect(SAFE_FACE_TUNING_VERSION).toBe('D-safe-face-1');
    const shorter = createSafeFacePolicy(300);
    shorter.decide(snapshot(1, 1000), 1000, GENERATION);
    expect(shorter.decide(null, 1301, GENERATION).mode).toBe('default');
  });
});

describe('defaultFaceShape', () => {
  it('is generated from the canvas size only, with no source pixels', () => {
    const shape = defaultFaceShape();

    expect(shape.head.x).toBe(PROCESSED_FACE_SIZE / 2);
    expect(shape.head.radius).toBeLessThan(PROCESSED_FACE_SIZE / 2);
    expect(shape.eyes).toHaveLength(2);
    expect(shape.eyes[0]!.x).toBeLessThan(shape.eyes[1]!.x);
    expect(shape.mouth.y).toBeGreaterThan(shape.eyes[0]!.y);
  });
});

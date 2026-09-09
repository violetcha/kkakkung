import { describe, expect, it, vi } from 'vitest';

import type { SensorSnapshot } from '../vision/sensor-types';
import {
  createInputFallback,
  FACE_INVALID_MS,
  INFERENCE_STALL_MS,
  type InputFailureCode,
} from './input-fallback';
import type { InputMode } from './interaction-context';

const GENERATION = 5;

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

function harness() {
  const modes: InputMode[] = [];
  const failures: InputFailureCode[] = [];
  const clearHolds = vi.fn();
  const fallback = createInputFallback({
    clearHolds,
    onModeChange: (mode) => modes.push(mode),
    onFailure: (code) => failures.push(code),
  });
  return { fallback, modes, failures, clearHolds };
}

describe('createInputFallback', () => {
  it('starts in motion mode and is not degraded', () => {
    const base = harness();

    expect(base.fallback.mode).toBe('motion');
    expect(base.fallback.degraded).toBe(false);
  });

  it('switches to keyboard and clears the holds when the camera ends', () => {
    const base = harness();

    base.fallback.report('CAMERA_ENDED');

    expect(base.fallback.mode).toBe('keyboard');
    expect(base.fallback.degraded).toBe(true);
    expect(base.modes).toEqual(['keyboard']);
    expect(base.failures).toEqual(['CAMERA_ENDED']);
    expect(base.clearHolds).toHaveBeenCalledTimes(1);
  });

  it('switches to keyboard on a worker error', () => {
    const base = harness();
    base.fallback.report('WORKER_ERROR');

    expect(base.fallback.mode).toBe('keyboard');
    expect(base.fallback.lastFailure).toBe('WORKER_ERROR');
  });

  it('detects a stalled inference from the missing new results', () => {
    const base = harness();
    base.fallback.observe(snapshot(1, 1000), 1000, GENERATION);

    expect(
      base.fallback.observe(snapshot(1, 1000), 1000 + INFERENCE_STALL_MS, GENERATION),
    ).toBeNull();
    expect(
      base.fallback.observe(snapshot(1, 1000), 1000 + INFERENCE_STALL_MS + 1, GENERATION),
    ).toBe('INFERENCE_STALLED');
    expect(base.fallback.mode).toBe('keyboard');
  });

  it('detects a stalled inference when the snapshots stop arriving', () => {
    const base = harness();
    base.fallback.observe(snapshot(1, 1000), 1000, GENERATION);

    expect(base.fallback.observe(null, 1000 + INFERENCE_STALL_MS + 1, GENERATION)).toBe(
      'INFERENCE_STALLED',
    );
  });

  it('degrades after the face stays invalid for the whole window', () => {
    const base = harness();
    base.fallback.observe(snapshot(1, 1000), 1000, GENERATION);

    let frame = 2;
    let now = 1000;
    let result: InputFailureCode | null = null;
    while (now < 1000 + FACE_INVALID_MS + 200 && result === null) {
      now += 200;
      result = base.fallback.observe(snapshot(frame++, now, { missing: true }), now, GENERATION);
    }

    expect(result).toBe('FACE_INVALID');
    expect(base.fallback.mode).toBe('keyboard');
  });

  it('does not degrade while the face keeps coming back valid', () => {
    const base = harness();
    let now = 1000;
    for (let frame = 1; frame <= 20; frame += 1) {
      now += 100;
      expect(base.fallback.observe(snapshot(frame, now), now, GENERATION)).toBeNull();
    }
    expect(base.fallback.degraded).toBe(false);
  });

  it('reports the failure only through the status callback and never ends participation', () => {
    const base = harness();
    base.fallback.report('CAMERA_ENDED');
    base.fallback.report('WORKER_ERROR');

    // 같은 저하 상태에서는 모드 변경을 반복하지 않는다.
    expect(base.modes).toEqual(['keyboard']);
    expect(base.failures).toEqual(['CAMERA_ENDED', 'WORKER_ERROR']);
  });

  it('keeps the motion mode when only the microphone failed', () => {
    const base = harness();

    base.fallback.reportMicrophoneOnly();

    expect(base.fallback.mode).toBe('motion');
    expect(base.fallback.degraded).toBe(false);
    expect(base.clearHolds).not.toHaveBeenCalled();
  });

  it('refuses to restore the motion without a new calibration', () => {
    const base = harness();
    base.fallback.report('CAMERA_ENDED');

    expect(base.fallback.restoreMotion({ calibrated: false, requestedMode: 'motion' })).toBe(false);
    expect(base.fallback.mode).toBe('keyboard');
  });

  it('refuses to restore the motion without an explicit mode choice', () => {
    const base = harness();
    base.fallback.report('CAMERA_ENDED');

    expect(base.fallback.restoreMotion({ calibrated: true, requestedMode: 'keyboard' })).toBe(
      false,
    );
    expect(base.fallback.mode).toBe('keyboard');
  });

  it('restores the motion after a new calibration and an explicit choice', () => {
    const base = harness();
    base.fallback.report('CAMERA_ENDED');

    expect(base.fallback.restoreMotion({ calibrated: true, requestedMode: 'motion' })).toBe(true);
    expect(base.fallback.mode).toBe('motion');
    expect(base.fallback.degraded).toBe(false);
    expect(base.fallback.lastFailure).toBeNull();
    expect(base.modes).toEqual(['keyboard', 'motion']);
  });

  it('does not carry the pre failure state into the next round', () => {
    const base = harness();
    base.fallback.report('CAMERA_ENDED');

    base.fallback.reset();

    expect(base.fallback.mode).toBe('motion');
    expect(base.fallback.degraded).toBe(false);
    expect(base.fallback.lastFailure).toBeNull();
  });

  it('ignores a snapshot from an older generation for the freshness window', () => {
    const base = harness();
    base.fallback.observe(snapshot(1, 1000), 1000, GENERATION);

    const stale = base.fallback.observe(
      snapshot(2, 1100, { generation: GENERATION - 1 }),
      1100,
      GENERATION,
    );

    expect(stale).toBeNull();
    expect(base.fallback.degraded).toBe(false);
  });
});

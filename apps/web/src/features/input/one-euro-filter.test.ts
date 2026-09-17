import { describe, expect, it } from 'vitest';

import { PRODUCT_ACTION_MS } from '@kkakkung/protocol/game-schema';
import { INPUT_TUNING, SENSOR_TUNING_VERSION, SERVER_ACTION_MS } from './input-tuning';
import { applyHysteresis, createOneEuroFilter, smoothingAlpha } from './one-euro-filter';

const config = {
  minCutoffHz: INPUT_TUNING.filterMinCutoffHz,
  beta: INPUT_TUNING.filterBeta,
  derivativeCutoffHz: INPUT_TUNING.filterDerivativeCutoffHz,
  maxGapMs: INPUT_TUNING.filterMaxGapMs,
};

describe('createOneEuroFilter', () => {
  it('returns the first sample unchanged and then smooths toward the input', () => {
    const filter = createOneEuroFilter(config);

    expect(filter.filter(0.5, 1000)).toBe(0.5);
    expect(filter.initialized).toBe(true);
    const second = filter.filter(1.5, 1033);
    expect(second).toBeGreaterThan(0.5);
    expect(second).toBeLessThan(1.5);
  });

  it('attenuates jitter around a steady value', () => {
    const filter = createOneEuroFilter(config);
    let time = 1000;
    filter.filter(0, time);
    const noisy = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1];
    let last = 0;
    for (const value of noisy) {
      time += 33;
      last = filter.filter(value, time);
    }

    expect(Math.abs(last)).toBeLessThan(0.1);
  });

  it('reinitializes on a non positive dt instead of dividing by zero', () => {
    const filter = createOneEuroFilter(config);
    filter.filter(0.4, 1000);

    expect(filter.filter(0.9, 1000)).toBe(0.9);
    expect(filter.filter(0.9, 900)).toBe(0.9);
    expect(Number.isFinite(filter.filter(0.9, 933))).toBe(true);
  });

  it('reinitializes after a long gap instead of reusing the stale state', () => {
    const filter = createOneEuroFilter(config);
    filter.filter(0, 1000);
    filter.filter(0, 1033);

    const afterGap = filter.filter(1.2, 1033 + INPUT_TUNING.filterMaxGapMs + 1);

    expect(afterGap).toBe(1.2);
  });

  it('never lets a non finite input reach the internal state', () => {
    const filter = createOneEuroFilter(config);
    filter.filter(0.5, 1000);

    expect(Number.isNaN(filter.filter(Number.NaN, 1033))).toBe(true);
    expect(filter.initialized).toBe(false);
    const recovered = filter.filter(0.5, 1066);
    expect(recovered).toBe(0.5);
    expect(Number.isFinite(recovered)).toBe(true);

    filter.filter(0.6, 1099);
    expect(filter.filter(Number.POSITIVE_INFINITY, 1132)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(filter.filter(0.6, 1165))).toBe(true);
  });

  it('forgets the previous state on reset', () => {
    const filter = createOneEuroFilter(config);
    filter.filter(1, 1000);
    filter.reset();

    expect(filter.initialized).toBe(false);
    expect(filter.filter(0.2, 1033)).toBe(0.2);
  });
});

describe('smoothingAlpha', () => {
  it('grows with the cutoff and stays inside the unit range', () => {
    const slow = smoothingAlpha(1, 0.033);
    const fast = smoothingAlpha(10, 0.033);

    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(1);
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThan(1);
  });
});

describe('applyHysteresis', () => {
  it('needs the enter threshold to activate and the exit threshold to stay', () => {
    const bounds = { enterRad: INPUT_TUNING.turnEnterRad, exitRad: INPUT_TUNING.turnExitRad };

    expect(applyHysteresis(false, bounds.enterRad - 0.001, bounds)).toBe(false);
    expect(applyHysteresis(false, bounds.enterRad, bounds)).toBe(true);
    expect(applyHysteresis(true, bounds.exitRad, bounds)).toBe(true);
    expect(applyHysteresis(true, bounds.exitRad - 0.001, bounds)).toBe(false);
  });

  it('does not flip repeatedly for noise between the two thresholds', () => {
    const bounds = { enterRad: 0.3, exitRad: 0.2 };
    let active = false;
    const states: boolean[] = [];
    for (const magnitude of [0.25, 0.26, 0.24, 0.25, 0.26]) {
      active = applyHysteresis(active, magnitude, bounds);
      states.push(active);
    }

    expect(states).toEqual([false, false, false, false, false]);

    active = applyHysteresis(active, 0.31, bounds);
    const held: boolean[] = [];
    for (const magnitude of [0.25, 0.26, 0.24, 0.25]) {
      active = applyHysteresis(active, magnitude, bounds);
      held.push(active);
    }
    expect(held).toEqual([true, true, true, true]);
  });

  it('treats a non finite magnitude as inactive', () => {
    expect(applyHysteresis(true, Number.NaN, { enterRad: 0.3, exitRad: 0.2 })).toBe(false);
  });
});

describe('INPUT_TUNING', () => {
  it('pins the first recognition numbers under a version', () => {
    expect(INPUT_TUNING.tuningVersion).toBe(SENSOR_TUNING_VERSION);
    expect(INPUT_TUNING.forwardHoldMs).toBe(180);
    expect(INPUT_TUNING.backHoldMs).toBe(320);
    expect(INPUT_TUNING.turnHoldMs).toBe(150);
    expect(INPUT_TUNING.neutralHoldMs).toBe(150);
    expect(Object.isFrozen(INPUT_TUNING)).toBe(true);
  });

  it('separates the enter and exit angle of every intent', () => {
    expect(INPUT_TUNING.forwardExitRad).toBeLessThan(INPUT_TUNING.forwardEnterRad);
    expect(INPUT_TUNING.backExitRad).toBeLessThan(INPUT_TUNING.backEnterRad);
    expect(INPUT_TUNING.turnExitRad).toBeLessThan(INPUT_TUNING.turnEnterRad);
  });

  it('keeps the server action time separate from the local recognition delays', () => {
    // S15P21C204-270. The web mirrors the protocol's action durations; no local 450/300 remains.
    expect(SERVER_ACTION_MS).toEqual(PRODUCT_ACTION_MS);
    expect(SERVER_ACTION_MS.move).toBe(600);
    expect(SERVER_ACTION_MS.turn).toBe(400);
    expect(SERVER_ACTION_MS.move).not.toBe(INPUT_TUNING.forwardHoldMs);
    expect(SERVER_ACTION_MS.turn).not.toBe(INPUT_TUNING.turnHoldMs);
  });
});

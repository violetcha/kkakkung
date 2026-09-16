import { expect, it } from 'vitest';
import { IDLE_POSE, WALK, walkPose } from './walk-pose';

it('returns the idle pose when there is no move in progress or the stride is unusable', () => {
  for (const stride of [null, NaN, Infinity]) expect(walkPose(stride)).toBe(IDLE_POSE);
  expect(IDLE_POSE).toEqual({ leg: [0, 0], arm: [0, 0], bob: 0 });
});

it('swings opposite limbs in anti-phase and returns to the idle pose at both ends of the cell', () => {
  for (const stride of [0, 1]) {
    const pose = walkPose(stride);
    expect(pose.leg[0]).toBeCloseTo(0);
    expect(pose.leg[1]).toBeCloseTo(0);
    expect(pose.arm[0]).toBeCloseTo(0);
    expect(pose.bob).toBeCloseTo(0);
  }
  const quarter = walkPose(0.25);
  expect(quarter.leg[0]).toBeCloseTo(WALK.legSwingRad);
  expect(quarter.leg[1]).toBeCloseTo(-WALK.legSwingRad);
  // 팔은 같은 쪽 다리와 반대로 움직인다.
  expect(quarter.arm[0]).toBeCloseTo(-WALK.armSwingRad);
  expect(quarter.arm[1]).toBeCloseTo(WALK.armSwingRad);
  const threeQuarter = walkPose(0.75);
  expect(threeQuarter.leg[0]).toBeCloseTo(-WALK.legSwingRad);
  expect(threeQuarter.arm[0]).toBeCloseTo(WALK.armSwingRad);
});

it('bobs twice per cell, peaking on each step and staying within the configured height', () => {
  expect(walkPose(0.25).bob).toBeCloseTo(WALK.bobHeight);
  expect(walkPose(0.5).bob).toBeCloseTo(0);
  expect(walkPose(0.75).bob).toBeCloseTo(WALK.bobHeight);
  for (let i = 0; i <= 20; i++) {
    const bob = walkPose(i / 20).bob;
    expect(bob).toBeGreaterThanOrEqual(0);
    expect(bob).toBeLessThanOrEqual(WALK.bobHeight + 1e-9);
  }
  // 진행도는 0~1로 잘라서 본다.
  expect(walkPose(2.25)).toEqual(walkPose(1));
});

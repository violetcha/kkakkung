import { describe, expect, it } from 'vitest';

import {
  GRAB_HAND_REACH_MS,
  GRAB_HAND_RELEASE_MS,
  GRAB_HAND_SIGNAL_MS,
  grabHandReach,
  refreshGrabHandMotion,
} from './grab-hand';

describe('first-person grab hand motion', () => {
  it('reaches forward, holds, then returns after the grab signal expires', () => {
    const motion = refreshGrabHandMotion(null, 1000);

    expect(grabHandReach(motion, 999)).toBe(0);
    expect(grabHandReach(motion, 1000)).toBe(0);
    expect(grabHandReach(motion, 1000 + GRAB_HAND_REACH_MS)).toBe(1);
    expect(grabHandReach(motion, 1000 + GRAB_HAND_SIGNAL_MS)).toBe(1);
    expect(grabHandReach(motion, 1000 + GRAB_HAND_SIGNAL_MS + GRAB_HAND_RELEASE_MS)).toBe(0);
  });

  it('extends a held fist without restarting the forward motion', () => {
    const first = refreshGrabHandMotion(null, 1000);
    const refreshed = refreshGrabHandMotion(first, 1200);

    expect(refreshed.startedAtMs).toBe(1000);
    expect(refreshed.untilMs).toBe(1200 + GRAB_HAND_SIGNAL_MS);
    expect(grabHandReach(refreshed, 1200)).toBe(1);
  });

  it('starts a new motion after the previous hand has fully returned', () => {
    const first = refreshGrabHandMotion(null, 1000);
    const restartedAt = first.untilMs + GRAB_HAND_RELEASE_MS + 1;
    const restarted = refreshGrabHandMotion(first, restartedAt);

    expect(restarted.startedAtMs).toBe(restartedAt);
    expect(grabHandReach(restarted, restartedAt)).toBe(0);
  });
});

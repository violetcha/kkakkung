import { describe, expect, it } from 'vitest';

import { INPUT_TUNING } from './input-tuning';
import { createMoveIntentController, MOVE_REFRESH_MS, type MoveIntent } from './move-intent';

function harness() {
  const sent: MoveIntent[] = [];
  const timers = new Map<number, () => void>();
  let next = 1;
  const controller = createMoveIntentController({
    send: (direction) => sent.push(direction),
    now: () => 0,
    setTimer: (handler) => {
      const handle = next++;
      timers.set(handle, handler);
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
  });
  return {
    controller,
    sent,
    get timerCount() {
      return timers.size;
    },
    fire: () => {
      for (const [handle, handler] of [...timers.entries()]) {
        timers.delete(handle);
        handler();
      }
    },
  };
}

const FORWARD = INPUT_TUNING.forwardEnterRad + 0.05;
const BACK = -(INPUT_TUNING.backEnterRad + 0.05);

describe('createMoveIntentController', () => {
  it('needs the forward hold time before it sends an intent', () => {
    const base = harness();

    base.controller.updateMotion(FORWARD, 1000);
    expect(base.sent).toEqual([]);

    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs - 1);
    expect(base.sent).toEqual([]);

    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs);
    expect(base.sent).toEqual(['forward']);
  });

  it('uses the longer back hold time', () => {
    const base = harness();

    base.controller.updateMotion(BACK, 1000);
    base.controller.updateMotion(BACK, 1000 + INPUT_TUNING.forwardHoldMs);
    expect(base.sent).toEqual([]);

    base.controller.updateMotion(BACK, 1000 + INPUT_TUNING.backHoldMs);
    expect(base.sent).toEqual(['back']);
  });

  it('sends nothing before calibration', () => {
    const base = harness();

    base.controller.updateMotion(null, 1000);
    base.controller.updateMotion(null, 5000);

    expect(base.sent).toEqual([]);
    expect(base.controller.current).toBeNull();
  });

  it('refreshes the held intent every 100ms and stops on release', () => {
    const base = harness();
    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs);
    expect(base.sent).toEqual(['forward']);

    base.fire();
    base.fire();
    expect(base.sent).toEqual(['forward', 'forward', 'forward']);
    expect(MOVE_REFRESH_MS).toBe(100);

    base.controller.release();
    expect(base.sent.at(-1)).toBeNull();
    expect(base.timerCount).toBe(0);
  });

  it('sends the null direction exactly once on release', () => {
    const base = harness();
    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs);

    base.controller.release();
    base.controller.release();

    expect(base.sent.filter((value) => value === null)).toHaveLength(1);
  });

  it('routes the keyboard through the same intent function', () => {
    const base = harness();

    base.controller.setKey('forward', true);
    expect(base.sent).toEqual(['forward']);

    base.controller.setKey('forward', false);
    expect(base.sent).toEqual(['forward', null]);
  });

  it('treats both directions at once as neutral', () => {
    const base = harness();
    base.controller.setKey('forward', true);
    base.controller.setKey('back', true);

    expect(base.sent).toEqual(['forward', null]);
    expect(base.controller.current).toBeNull();
  });

  it('treats a motion in both directions as neutral', () => {
    const base = harness();
    // 두 방향이 동시에 유지될 수 없도록 lean 부호가 하나만 선택된다.
    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs);
    base.controller.updateMotion(BACK, 2000);

    expect(base.controller.current).toBeNull();
    expect(base.sent).toEqual(['forward', null]);
  });

  it('does not resend the same direction when the motion keeps holding', () => {
    const base = harness();
    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs + 40);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs + 80);

    expect(base.sent).toEqual(['forward']);
  });

  it('does not refire the previous motion after reset', () => {
    const base = harness();
    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs);

    base.controller.reset();
    base.controller.updateMotion(FORWARD, 5000);

    expect(base.sent).toEqual(['forward']);
    expect(base.timerCount).toBe(0);
    base.controller.updateMotion(FORWARD, 5000 + INPUT_TUNING.forwardHoldMs);
    expect(base.sent).toEqual(['forward', 'forward']);
  });

  it('keeps a noisy boundary from repeating the command', () => {
    const base = harness();
    let now = 1000;
    base.controller.updateMotion(FORWARD, now);
    now += INPUT_TUNING.forwardHoldMs;
    base.controller.updateMotion(FORWARD, now);

    for (const value of [
      INPUT_TUNING.forwardExitRad + 0.01,
      INPUT_TUNING.forwardEnterRad - 0.01,
      INPUT_TUNING.forwardExitRad + 0.02,
    ]) {
      now += 40;
      base.controller.updateMotion(value, now);
    }

    expect(base.sent).toEqual(['forward']);
  });
});

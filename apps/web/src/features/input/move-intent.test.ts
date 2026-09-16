import { describe, expect, it } from 'vitest';

import { INPUT_TUNING } from './input-tuning';
import { createMoveIntentController, MOVE_REFRESH_MS, type MoveIntent } from './move-intent';

function harness() {
  const sent: MoveIntent[] = [];
  const timers = new Map<number, () => void>();
  let next = 1;
  let clock = 0;
  const controller = createMoveIntentController({
    send: (direction) => sent.push(direction),
    now: () => clock,
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
    advance: (ms: number) => {
      clock += ms;
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

  it('ignores movement keys in motion mode', () => {
    const base = harness();

    base.controller.setKey('forward', true);
    base.advance(INPUT_TUNING.forwardHoldMs * 2);
    base.fire();
    base.controller.setKey('forward', false);

    expect(base.sent).toEqual([]);
    expect(base.controller.current).toBeNull();
    expect(base.controller.mode).toBe('motion');
  });

  it('holds a movement key for the motion hold time before it sends', () => {
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.setKey('forward', true);
    expect(base.sent).toEqual([]);
    // 유지 시간을 채우기 전에 타이머가 깨어나도 의도를 만들지 않는다.
    base.advance(INPUT_TUNING.forwardHoldMs - 1);
    base.fire();
    expect(base.sent).toEqual([]);

    base.advance(1);
    base.fire();
    expect(base.sent).toEqual(['forward']);

    // 놓으면 즉시 멈춘다. 모션도 임계를 벗어나면 바로 멈추므로 같은 규칙이다.
    base.controller.setKey('forward', false);
    expect(base.sent).toEqual(['forward', null]);
    expect(base.timerCount).toBe(0);
  });

  it('uses the longer back hold time for the back key too', () => {
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.setKey('back', true);
    base.advance(INPUT_TUNING.forwardHoldMs);
    base.fire();
    expect(base.sent).toEqual([]);

    base.advance(INPUT_TUNING.backHoldMs - INPUT_TUNING.forwardHoldMs);
    base.fire();
    expect(base.sent).toEqual(['back']);
  });

  it('sends nothing for a key released before the hold time', () => {
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.setKey('forward', true);
    base.advance(INPUT_TUNING.forwardHoldMs - 20);
    base.controller.setKey('forward', false);
    base.advance(100);
    base.fire();

    expect(base.sent).toEqual([]);
    expect(base.timerCount).toBe(0);
  });

  it('treats both directions at once as neutral', () => {
    const base = harness();
    base.controller.setMode('keyboard');
    base.controller.setKey('forward', true);
    base.advance(INPUT_TUNING.forwardHoldMs);
    base.fire();
    expect(base.sent).toEqual(['forward']);

    base.controller.setKey('back', true);
    expect(base.sent).toEqual(['forward', null]);
    expect(base.controller.current).toBeNull();

    // 한쪽을 놓아도 남은 키는 유지 시간을 다시 채워야 한다.
    base.controller.setKey('forward', false);
    base.advance(INPUT_TUNING.backHoldMs);
    base.fire();
    expect(base.sent).toEqual(['forward', null, 'back']);
  });

  it('drops a held key when the mode changes back to motion', () => {
    const base = harness();
    base.controller.setMode('keyboard');
    base.controller.setKey('forward', true);
    base.advance(INPUT_TUNING.forwardHoldMs);
    base.fire();
    expect(base.sent).toEqual(['forward']);

    base.controller.setMode('motion');
    expect(base.sent).toEqual(['forward', null]);
    // 모션 모드가 된 뒤의 키는 무시하고, 이전 키가 이어지지도 않는다.
    base.controller.setKey('forward', true);
    base.advance(INPUT_TUNING.forwardHoldMs);
    base.fire();
    expect(base.sent).toEqual(['forward', null]);
  });

  it('ignores motion candidates in keyboard mode', () => {
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs);

    expect(base.sent).toEqual([]);
    expect(base.controller.motionActive).toBe(false);
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

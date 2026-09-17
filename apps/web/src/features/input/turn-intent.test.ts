import { describe, expect, it } from 'vitest';

import { INPUT_TUNING } from './input-tuning';
import { createTurnIntentController, type TurnDirection } from './turn-intent';

function harness() {
  const sent: TurnDirection[] = [];
  const timers = new Map<number, () => void>();
  let next = 1;
  let clock = 0;
  const controller = createTurnIntentController({
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
    /** 키를 누르고 유지 시간을 채운 뒤 타이머를 깨운다. */
    hold: (direction: TurnDirection) => {
      controller.keyDown(direction, false);
      const handles = [...timers.keys()];
      clock += INPUT_TUNING.turnHoldMs;
      for (const handle of handles) {
        const handler = timers.get(handle);
        timers.delete(handle);
        handler?.();
      }
    },
  };
}

const RIGHT = INPUT_TUNING.turnEnterRad + 0.05;
const LEFT = -(INPUT_TUNING.turnEnterRad + 0.05);
const NEUTRAL = 0;

describe('createTurnIntentController', () => {
  it('fires once after the hold time and latches', () => {
    const base = harness();

    base.controller.updateMotion(RIGHT, 1000);
    expect(base.sent).toEqual([]);

    base.controller.updateMotion(RIGHT, 1000 + INPUT_TUNING.turnHoldMs);
    expect(base.sent).toEqual(['right']);
    expect(base.controller.latched).toBe(true);

    base.controller.updateMotion(RIGHT, 2000);
    base.controller.updateMotion(RIGHT, 3000);
    expect(base.sent).toEqual(['right']);
  });

  it('needs a neutral hold before the next turn', () => {
    const base = harness();
    base.controller.updateMotion(RIGHT, 1000);
    base.controller.updateMotion(RIGHT, 1000 + INPUT_TUNING.turnHoldMs);

    base.controller.updateMotion(NEUTRAL, 2000);
    base.controller.updateMotion(NEUTRAL, 2000 + INPUT_TUNING.neutralHoldMs - 1);
    expect(base.controller.latched).toBe(true);

    base.controller.updateMotion(NEUTRAL, 2000 + INPUT_TUNING.neutralHoldMs);
    expect(base.controller.latched).toBe(false);

    base.controller.updateMotion(LEFT, 3000);
    base.controller.updateMotion(LEFT, 3000 + INPUT_TUNING.turnHoldMs);
    expect(base.sent).toEqual(['right', 'left']);
  });

  it('does not unlatch from noise between the exit and enter thresholds', () => {
    const base = harness();
    base.controller.updateMotion(RIGHT, 1000);
    base.controller.updateMotion(RIGHT, 1000 + INPUT_TUNING.turnHoldMs);

    let now = 2000;
    for (const value of [
      INPUT_TUNING.turnExitRad + 0.01,
      INPUT_TUNING.turnEnterRad - 0.01,
      INPUT_TUNING.turnExitRad + 0.02,
    ]) {
      now += 60;
      base.controller.updateMotion(value, now);
    }

    expect(base.controller.latched).toBe(true);
    expect(base.sent).toEqual(['right']);
  });

  it('sends nothing before calibration', () => {
    const base = harness();

    base.controller.updateMotion(null, 1000);
    base.controller.updateMotion(null, 5000);

    expect(base.sent).toEqual([]);
  });

  it('restarts the hold when the motion direction flips', () => {
    const base = harness();
    base.controller.updateMotion(RIGHT, 1000);
    base.controller.updateMotion(LEFT, 1000 + INPUT_TUNING.turnHoldMs);

    expect(base.sent).toEqual([]);
    base.controller.updateMotion(LEFT, 1000 + INPUT_TUNING.turnHoldMs * 2);
    expect(base.sent).toEqual(['left']);
  });

  it('turns once after the key is held for the motion hold time and ignores the auto repeat', () => {
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.keyDown('left', false);
    base.controller.keyDown('left', true);
    expect(base.sent).toEqual([]);

    base.advance(INPUT_TUNING.turnHoldMs);
    base.fire();
    base.controller.keyDown('left', true);
    expect(base.sent).toEqual(['left']);
    expect(base.controller.latched).toBe(true);
  });

  it('sends nothing for a key released before the hold time', () => {
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.keyDown('right', false);
    base.advance(INPUT_TUNING.turnHoldMs - 10);
    base.controller.keyUp('right');
    base.advance(100);
    base.fire();

    expect(base.sent).toEqual([]);
    expect(base.controller.latched).toBe(false);
    expect(base.timerCount).toBe(0);
  });

  it('needs the key released and a neutral wait before the next turn', () => {
    const base = harness();
    base.controller.setMode('keyboard');
    base.hold('right');
    expect(base.sent).toEqual(['right']);

    // 놓고 바로 다시 누르면 중립이 아니므로 받지 않는다.
    base.controller.keyUp('right');
    base.controller.keyDown('right', false);
    base.advance(INPUT_TUNING.turnHoldMs);
    base.fire();
    expect(base.sent).toEqual(['right']);
    expect(base.controller.latched).toBe(true);

    // 모든 키를 놓고 중립 시간을 채우면 latch가 풀린다.
    base.controller.keyUp('right');
    base.advance(INPUT_TUNING.neutralHoldMs - 1);
    base.fire();
    expect(base.controller.latched).toBe(true);
    base.advance(1);
    base.fire();
    expect(base.controller.latched).toBe(false);

    base.hold('left');
    expect(base.sent).toEqual(['right', 'left']);
  });

  it('turns on release when the hold elapsed but the timer never fired', () => {
    // 이동과 같은 경합: keyup이 유지 타이머를 앞질러도 시계상 채운 유지 시간은 잃지 않는다.
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.keyDown('left', false);
    base.advance(INPUT_TUNING.turnHoldMs + 30);
    base.controller.keyUp('left');

    expect(base.sent).toEqual(['left']);
    expect(base.controller.latched).toBe(true);

    // 놓은 뒤에는 보통처럼 중립 시간이 지나야 다음 회전을 받는다.
    base.advance(INPUT_TUNING.neutralHoldMs);
    base.fire();
    expect(base.controller.latched).toBe(false);

    // 유지 시간 전에 놓으면 발동하지 않는다.
    base.controller.keyDown('right', false);
    base.advance(INPUT_TUNING.turnHoldMs - 1);
    base.controller.keyUp('right');
    expect(base.sent).toEqual(['left']);
    expect(base.timerCount).toBe(0);
  });

  it('drops the hold when a second direction is pressed at the same time', () => {
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.keyDown('left', false);
    base.controller.keyDown('right', false);
    base.advance(INPUT_TUNING.turnHoldMs);
    base.fire();
    expect(base.sent).toEqual([]);

    // 한쪽을 놓아도 남은 키는 새로 눌러야 한다.
    base.controller.keyUp('right');
    base.advance(INPUT_TUNING.turnHoldMs);
    base.fire();
    expect(base.sent).toEqual([]);
  });

  it('accepts only the current mode candidate', () => {
    const base = harness();

    // 모션 모드에서는 키 후보를 채택하지 않는다.
    base.controller.keyDown('left', false);
    base.advance(INPUT_TUNING.turnHoldMs);
    base.fire();
    expect(base.sent).toEqual([]);

    base.controller.setMode('keyboard');
    base.controller.updateMotion(RIGHT, 1000);
    base.controller.updateMotion(RIGHT, 1000 + INPUT_TUNING.turnHoldMs);
    expect(base.sent).toEqual([]);

    base.hold('left');
    expect(base.sent).toEqual(['left']);
  });

  it('clears the latch and the pressed keys on a mode change', () => {
    const base = harness();
    base.controller.updateMotion(RIGHT, 1000);
    base.controller.updateMotion(RIGHT, 1000 + INPUT_TUNING.turnHoldMs);
    expect(base.controller.latched).toBe(true);

    base.controller.setMode('keyboard');

    expect(base.controller.latched).toBe(false);
    expect(base.controller.mode).toBe('keyboard');
    base.hold('right');
    expect(base.sent).toEqual(['right', 'right']);

    // 키를 누른 채 모션으로 돌아가면 그 키는 버려진다.
    base.controller.keyUp('right');
    base.controller.keyDown('left', false);
    base.controller.setMode('motion');
    base.advance(INPUT_TUNING.turnHoldMs);
    base.fire();
    expect(base.sent).toEqual(['right', 'right']);
    expect(base.timerCount).toBe(0);
  });

  it('requires a fresh press or neutral after reset', () => {
    const base = harness();
    base.controller.setMode('keyboard');
    base.hold('left');
    expect(base.sent).toEqual(['left']);

    base.controller.reset();
    expect(base.controller.latched).toBe(false);
    base.hold('left');

    expect(base.sent).toEqual(['left', 'left']);
  });
});

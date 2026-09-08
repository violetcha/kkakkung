import { describe, expect, it } from 'vitest';

import { INPUT_TUNING } from './input-tuning';
import { createTurnIntentController, type TurnDirection } from './turn-intent';

function harness() {
  const sent: TurnDirection[] = [];
  const controller = createTurnIntentController({ send: (direction) => sent.push(direction) });
  return { controller, sent };
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

  it('sends one turn on the first keydown and ignores the auto repeat', () => {
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.keyDown('left', false);
    base.controller.keyDown('left', true);
    base.controller.keyDown('left', true);

    expect(base.sent).toEqual(['left']);
  });

  it('does not turn on keyup and allows a new press afterwards', () => {
    const base = harness();
    base.controller.setMode('keyboard');
    base.controller.keyDown('right', false);

    base.controller.keyUp('right');
    expect(base.sent).toEqual(['right']);

    base.controller.keyDown('right', false);
    expect(base.sent).toEqual(['right', 'right']);
  });

  it('accepts only the current mode candidate', () => {
    const base = harness();

    // 모션 모드에서는 키 후보를 채택하지 않는다.
    base.controller.keyDown('left', false);
    expect(base.sent).toEqual([]);

    base.controller.setMode('keyboard');
    base.controller.updateMotion(RIGHT, 1000);
    base.controller.updateMotion(RIGHT, 1000 + INPUT_TUNING.turnHoldMs);
    expect(base.sent).toEqual([]);

    base.controller.keyDown('left', false);
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
    base.controller.keyDown('right', false);
    expect(base.sent).toEqual(['right', 'right']);
  });

  it('requires a fresh press or neutral after reset', () => {
    const base = harness();
    base.controller.setMode('keyboard');
    base.controller.keyDown('left', false);

    base.controller.reset();
    base.controller.keyDown('left', false);

    expect(base.sent).toEqual(['left', 'left']);
    expect(base.controller.latched).toBe(false);
  });
});

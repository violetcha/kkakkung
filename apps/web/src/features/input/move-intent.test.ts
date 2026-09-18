import { describe, expect, it } from 'vitest';

import { INPUT_TUNING, SERVER_ACTION_MS } from './input-tuning';
import {
  createMoveIntentController,
  MOVE_REFRESH_MS,
  releaseLagStats,
  type MoveIntent,
} from './move-intent';

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

/** 하네스의 advance 는 누적이다. 절대 시각으로 다루기 위해 현재 값을 들고 다닌다. */
function stopwatch(base: ReturnType<typeof harness>) {
  let at = 0;
  return {
    to(target: number) {
      base.advance(target - at);
      at = target;
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

  // S15P21C204-281. 짧게 기울였다 돌아오면 정확히 한 칸이다. 서버는 한 칸이 끝나는 Tick에만
  // 유지 의도를 보므로, 의도를 보낸 뒤 해제하면 시작한 한 칸만 남고 다음 칸이 시작되지 않는다.
  it('sends one cell for a tap and stops refreshing', () => {
    const base = harness();
    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, 1000 + INPUT_TUNING.forwardHoldMs);
    expect(base.sent).toEqual(['forward']);
    expect(base.controller.phase).toBe('tap');

    base.advance(MOVE_REFRESH_MS);
    base.fire();
    expect(base.sent).toEqual(['forward', null]);
    expect(base.controller.phase).toBe('tap');

    // 기울임을 풀면 더 보내지 않는다. 한 칸은 서버가 끝까지 옮긴다.
    base.controller.updateMotion(0, 1000 + INPUT_TUNING.forwardHoldMs + MOVE_REFRESH_MS);
    expect(base.sent).toEqual(['forward', null]);
    expect(base.controller.phase).toBe('idle');
    expect(base.timerCount).toBe(0);
  });

  it('upgrades to continuous movement when the lean is kept, then refreshes every 100ms', () => {
    const base = harness();
    const armedAt = 1000 + INPUT_TUNING.forwardHoldMs;
    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, armedAt);

    base.advance(MOVE_REFRESH_MS);
    base.fire();
    expect(base.sent).toEqual(['forward', null]);

    base.advance(INPUT_TUNING.holdToContinuousMs - MOVE_REFRESH_MS);
    base.controller.updateMotion(FORWARD, armedAt + INPUT_TUNING.holdToContinuousMs);
    expect(base.controller.phase).toBe('hold');
    expect(base.sent).toEqual(['forward', null, 'forward']);

    base.fire();
    base.fire();
    expect(base.sent).toEqual(['forward', null, 'forward', 'forward', 'forward']);
    expect(MOVE_REFRESH_MS).toBe(100);
    // 연속 전환은 서버 한 칸보다 먼저 끝나야 다음 칸이 끊기지 않는다.
    expect(INPUT_TUNING.holdToContinuousMs).toBeLessThan(SERVER_ACTION_MS.move);

    base.controller.release();
    expect(base.sent.at(-1)).toBeNull();
    expect(base.timerCount).toBe(0);
    expect(base.controller.phase).toBe('idle');
  });

  it('keeps the keyboard on the same tap and hold rule', () => {
    const base = harness();
    base.controller.setMode('keyboard');
    base.controller.setKey('forward', true);
    expect(base.sent).toEqual([]);

    base.advance(INPUT_TUNING.forwardHoldMs);
    base.fire();
    expect(base.sent).toEqual(['forward']);
    expect(base.controller.phase).toBe('tap');

    base.advance(MOVE_REFRESH_MS);
    base.fire();
    expect(base.sent).toEqual(['forward', null]);

    // 키를 계속 누르고 있으면 표본이 없어도 타이머가 연속으로 올린다.
    base.advance(INPUT_TUNING.holdToContinuousMs);
    base.fire();
    expect(base.controller.phase).toBe('hold');
    expect(base.sent).toEqual(['forward', null, 'forward']);
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

  it('sends the intent on release when the hold elapsed but the timer never fired', () => {
    // 메인 스레드가 막히면 keyup이 유지 타이머보다 먼저 처리된다. 시계상 유지 시간을 채웠으면
    // 놓는 시점에 forward가 나가고 곧바로 null이 따라야 한다(모션의 임계 진입 뒤 즉시 이탈과 같음).
    const base = harness();
    base.controller.setMode('keyboard');

    base.controller.setKey('forward', true);
    base.advance(INPUT_TUNING.forwardHoldMs + 50);
    base.controller.setKey('forward', false);

    expect(base.sent).toEqual(['forward', null]);
    expect(base.controller.current).toBeNull();
    expect(base.timerCount).toBe(0);

    // 유지 시간을 채우지 못한 채 놓으면 타이머가 안 돌았어도 아무것도 나가지 않는다.
    base.controller.setKey('back', true);
    base.advance(INPUT_TUNING.backHoldMs - 1);
    base.controller.setKey('back', false);
    expect(base.sent).toEqual(['forward', null]);
    expect(base.timerCount).toBe(0);
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

  // S15P21C204-280. 해제 지연은 "해제를 보인 표본의 시각"과 "그 표본을 받아 의도를 끊은 시각"의
  // 차이다. 두 시각은 같은 시계(vision)를 쓰므로 추론·필터·전달에 걸린 시간만 남는다.
  it('measures the lag between the releasing sample and the release', () => {
    const base = harness();
    expect(base.controller.releaseLag).toEqual({
      lastMs: null,
      medianMs: null,
      maxMs: null,
      samples: 0,
    });

    const clock = stopwatch(base);
    const armedAt = 1000 + INPUT_TUNING.forwardHoldMs;
    base.controller.updateMotion(FORWARD, 1000);
    base.controller.updateMotion(FORWARD, armedAt);
    // 표본은 armedAt + 40 에 찍혔고 우리는 그보다 25ms 뒤에 처리한다.
    clock.to(armedAt + 40 + 25);
    base.controller.updateMotion(0, armedAt + 40);

    expect(base.controller.releaseLag).toMatchObject({ lastMs: 25, medianMs: 25, maxMs: 25 });
    expect(base.controller.releaseLag.samples).toBe(1);
  });

  it('keeps only the last releases and reports the median and the largest', () => {
    const base = harness();
    const clock = stopwatch(base);
    let sampleAt = 1000;
    for (const lag of [10, 30, 20]) {
      clock.to(sampleAt);
      base.controller.updateMotion(FORWARD, sampleAt);
      clock.to(sampleAt + INPUT_TUNING.forwardHoldMs);
      base.controller.updateMotion(FORWARD, sampleAt + INPUT_TUNING.forwardHoldMs);
      const releasedAt = sampleAt + INPUT_TUNING.forwardHoldMs + 40;
      clock.to(releasedAt + lag);
      base.controller.updateMotion(0, releasedAt);
      sampleAt = releasedAt + 1000;
    }
    expect(base.controller.releaseLag).toMatchObject({ lastMs: 20, medianMs: 20, maxMs: 30 });
    expect(base.controller.releaseLag.samples).toBe(3);
  });

  it('does not measure the keyboard, where no sample is involved', () => {
    const base = harness();
    base.controller.setMode('keyboard');
    base.controller.setKey('forward', true);
    base.advance(INPUT_TUNING.forwardHoldMs);
    base.fire();
    base.controller.setKey('forward', false);
    expect(base.controller.releaseLag.samples).toBe(0);
  });
});

describe('releaseLagStats', () => {
  it('averages the middle pair for an even window', () => {
    expect(releaseLagStats([10, 20, 30, 40])).toMatchObject({ medianMs: 25, maxMs: 40 });
  });

  it('is empty until a release is seen', () => {
    expect(releaseLagStats([])).toEqual({
      lastMs: null,
      medianMs: null,
      maxMs: null,
      samples: 0,
    });
  });
});

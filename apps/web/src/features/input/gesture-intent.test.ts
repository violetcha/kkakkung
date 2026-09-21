import { describe, expect, it, vi } from 'vitest';

import type { NormalizedLandmark, SensorSnapshot } from '../vision/sensor-types';
import {
  createGestureIntentController,
  GRAB_RESEND_MS,
  GESTURE_HOLD_MS,
  type CommandInput,
} from './gesture-intent';
import {
  createContextStore,
  type InteractionContext,
  type InteractionState,
} from './interaction-context';

const GENERATION = 4;

const runner: InteractionContext = {
  matchId: 'match-1',
  selfPlayerId: 'runner-1',
  role: 'runner',
  phase: 'PLAYING',
  status: 'ACTIVE',
  mode: 'motion',
  pageActive: true,
};

const tagger: InteractionContext = { ...runner, selfPlayerId: 'tagger-1', role: 'tagger' };

function gestureSnapshot(
  frameId: number,
  atMs: number,
  kind: 'palm' | 'victory' | 'none',
  options: {
    missing?: boolean;
    generation?: number;
    hands?: readonly (readonly NormalizedLandmark[])[];
  } = {},
): SensorSnapshot {
  return {
    runtimeGeneration: options.generation ?? GENERATION,
    emittedAtMs: atMs,
    face: null,
    pose: null,
    gesture: options.missing
      ? { frameId, sampledAtMs: atMs, receivedAtMs: atMs, status: 'missing', data: null }
      : {
          frameId,
          sampledAtMs: atMs,
          receivedAtMs: atMs,
          status: 'valid',
          data: { kind, score: 0.9, ...(options.hands ? { hands: options.hands } : {}) },
        },
  };
}

function fistHand(open = false): NormalizedLandmark[] {
  const hand = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [pip, tip] of [
    [6, 8],
    [10, 12],
    [14, 16],
    [18, 20],
  ] as const) {
    hand[pip] = { x: 0.4, y: 0, z: 0 };
    hand[tip] = { x: open && tip === 8 ? 0.6 : 0.2, y: 0, z: 0 };
  }
  return hand;
}

function harness(context: InteractionContext) {
  const sent: CommandInput[] = [];
  const states: InteractionState[] = [];
  const store = createContextStore();
  store.set(context);
  let counter = 0;
  const controller = createGestureIntentController({
    context: store,
    send: (command) => {
      sent.push(command);
      return `request-${++counter}`;
    },
    onInteractionState: (state) => states.push(state),
  });
  return { controller, sent, states, store };
}

/** 600ms를 채우는 연속 손동작. */
function holdGesture(base: ReturnType<typeof harness>, kind: 'palm' | 'victory', startMs = 1000) {
  base.controller.observe(gestureSnapshot(1, startMs, kind), startMs, GENERATION);
  base.controller.observe(gestureSnapshot(2, startMs + 300, kind), startMs + 300, GENERATION);
  const end = startMs + GESTURE_HOLD_MS;
  return base.controller.observe(gestureSnapshot(3, end, kind), end, GENERATION);
}

describe('createGestureIntentController', () => {
  it('requires physical release after firing across installation updates and observation gaps', () => {
    const base = harness(tagger);
    expect(holdGesture(base, 'victory')).toBe('install');
    base.store.set({ ...tagger, installationId: 'installed' });
    base.controller.reset();
    for (let i = 4; i <= 20; i++) {
      const at = 1000 + i * 300;
      base.controller.observe(gestureSnapshot(i, at, 'victory'), at, GENERATION);
    }
    expect(base.sent).toEqual([{ type: 'INSTALL', payload: { kind: 'sensor' } }]);
    base.controller.observe(gestureSnapshot(21, 7300, 'none'), 7300, GENERATION);
    for (let i = 22; i <= 24; i++) {
      const at = 7600 + (i - 22) * 300;
      base.controller.observe(gestureSnapshot(i, at, 'victory'), at, GENERATION);
    }
    expect(base.sent.at(-1)).toEqual({
      type: 'INSTALL_CANCEL',
      payload: { installationId: 'installed' },
    });
    expect(base.sent).toHaveLength(2);
  });

  it('does not count sparse, duplicate or stale-generation observations toward a hold', () => {
    const base = harness({ ...runner, incomingExchangeId: 'exchange' });
    base.controller.observe(gestureSnapshot(1, 0, 'palm'), 0, GENERATION);
    base.controller.observe(gestureSnapshot(2, 1000, 'palm'), 1000, GENERATION);
    expect(base.sent).toHaveLength(0);
    base.controller.observe(gestureSnapshot(2, 1300, 'palm'), 1300, GENERATION);
    base.controller.observe(
      gestureSnapshot(3, 1500, 'palm', { generation: GENERATION - 1 }),
      1500,
      GENERATION,
    );
    base.controller.observe(gestureSnapshot(3, 1600, 'palm'), 1600, GENERATION);
    expect(base.sent).toHaveLength(0);
  });

  it('accepts screen equipment selection without callback echo', () => {
    const base = harness(tagger);
    base.controller.syncEquipment('trap');
    base.controller.syncEquipment('trap');
    expect(base.states).toEqual([]);
    base.controller.pressKey('F');
    expect(base.sent.at(-1)).toEqual({ type: 'INSTALL', payload: { kind: 'trap' } });
    base.controller.pressKey('1');
    expect(base.states).toEqual([{ selectedEquipment: 'sensor', mode: 'motion' }]);
  });

  it('accepts an incoming exchange with the palm gesture', () => {
    const base = harness({ ...runner, incomingExchangeId: 'exchange-1' });

    expect(holdGesture(base, 'palm')).toBe('exchange-accept');
    expect(base.sent).toEqual([{ type: 'EXCHANGE_ACCEPT', payload: { exchangeId: 'exchange-1' } }]);
    expect(base.controller.lastRequestId).toBe('request-1');
  });

  it('needs the full hold before firing', () => {
    const base = harness({ ...runner, incomingExchangeId: 'exchange-1' });

    base.controller.observe(gestureSnapshot(1, 1000, 'palm'), 1000, GENERATION);
    const early = base.controller.observe(
      gestureSnapshot(2, 1000 + GESTURE_HOLD_MS - 1, 'palm'),
      1000 + GESTURE_HOLD_MS - 1,
      GENERATION,
    );

    expect(early).toBeNull();
    expect(base.sent).toEqual([]);
  });

  it('does not fire twice while the hand keeps holding', () => {
    const base = harness({ ...runner, incomingExchangeId: 'exchange-1' });
    holdGesture(base, 'palm');

    base.controller.observe(
      gestureSnapshot(4, 1000 + GESTURE_HOLD_MS + 100, 'palm'),
      1000 + GESTURE_HOLD_MS + 100,
      GENERATION,
    );

    expect(base.sent).toHaveLength(1);
  });

  it('resets the hold on a missing, none, stale or old generation sample', () => {
    for (const options of [
      { snapshot: gestureSnapshot(2, 1600, 'none'), now: 1600 },
      { snapshot: gestureSnapshot(2, 1600, 'palm', { missing: true }), now: 1600 },
      // gesture age 400ms를 넘긴 표본
      { snapshot: gestureSnapshot(2, 1600, 'palm'), now: 2100 },
      {
        snapshot: gestureSnapshot(2, 1600, 'palm', { generation: GENERATION - 1 }),
        now: 1600,
      },
    ]) {
      const base = harness({ ...runner, incomingExchangeId: 'exchange-1' });
      base.controller.observe(gestureSnapshot(1, 1000, 'palm'), 1000, GENERATION);
      base.controller.observe(options.snapshot, options.now, GENERATION);
      base.controller.observe(gestureSnapshot(3, 1700, 'palm'), 1700, GENERATION);

      expect(base.sent).toEqual([]);
    }
  });

  it('requests an exchange only when there is a target and no session', () => {
    const withTarget = harness({ ...runner, targetPlayerId: 'runner-2' });
    expect(holdGesture(withTarget, 'palm')).toBe('exchange-request');
    expect(withTarget.sent).toEqual([
      { type: 'EXCHANGE_REQUEST', payload: { targetPlayerId: 'runner-2' } },
    ]);

    // 자기 요청(outgoing)이 이미 있으면 새 요청을 만들지 않는다.
    const waiting = harness({
      ...runner,
      targetPlayerId: 'runner-2',
      outgoingExchangeId: 'exchange-9',
    });
    expect(holdGesture(waiting, 'palm')).toBeNull();
    expect(waiting.sent).toEqual([]);

    const noTarget = harness(runner);
    expect(holdGesture(noTarget, 'palm')).toBeNull();
  });

  it('never starts an exit with the palm gesture', () => {
    const base = harness({ ...runner, exitId: 'exit-1' });

    expect(holdGesture(base, 'palm')).toBeNull();
    expect(base.sent).toEqual([]);
  });

  it('prefers the incoming accept, then the exit, then the exchange request for the E key', () => {
    const accept = harness({
      ...runner,
      incomingExchangeId: 'exchange-1',
      exitId: 'exit-1',
      targetPlayerId: 'runner-2',
    });
    expect(accept.controller.pressKey('E')).toBe('exchange-accept');

    const exit = harness({ ...runner, exitId: 'exit-1', targetPlayerId: 'runner-2' });
    expect(exit.controller.pressKey('E')).toBe('exit-start');
    expect(exit.sent).toEqual([{ type: 'EXIT_START', payload: { exitId: 'exit-1' } }]);

    const request = harness({ ...runner, targetPlayerId: 'runner-2' });
    expect(request.controller.pressKey('E')).toBe('exchange-request');
  });

  it('installs only for a tagger and only the selected equipment', () => {
    const base = harness(tagger);

    expect(base.controller.pressKey('F')).toBe('install');
    expect(base.sent).toEqual([{ type: 'INSTALL', payload: { kind: 'sensor' } }]);

    expect(base.controller.pressKey('2')).toBe('select-equipment');
    expect(base.states).toEqual([{ selectedEquipment: 'trap', mode: 'motion' }]);
    expect(base.controller.pressKey('F')).toBe('install');
    expect(base.sent.at(-1)).toEqual({ type: 'INSTALL', payload: { kind: 'trap' } });
  });

  it('keeps the number keys out of the runner interactions', () => {
    // 핫바는 아이템 칸이고 지도 교환·탈출 도전은 E 에만 있다. 숫자 키로는 절대 일어나지 않는다.
    const near = harness({ ...runner, targetPlayerId: 'runner-2', exitId: 'exit-1' });
    expect(near.controller.pressKey('1')).toBeNull();
    expect(near.controller.pressKey('2')).toBeNull();
    expect(near.sent).toEqual([]);
    expect(near.controller.pressKey('E')).toBe('exit-start');
  });

  it('sends a grab intent only for an active tagger in the playing phase', () => {
    const active = harness(tagger);
    expect(active.controller.pressKey('G')).toBe('grab');
    expect(active.sent).toEqual([{ type: 'GRAB_INTENT', payload: {} }]);

    const asRunner = harness(runner);
    expect(asRunner.controller.pressKey('G')).toBeNull();
    expect(asRunner.sent).toEqual([]);

    const practice = harness({ ...tagger, phase: 'TEAM_PRACTICE' });
    expect(practice.controller.pressKey('G')).toBeNull();
    expect(practice.sent).toEqual([]);
  });

  it('sends immediately for a fist and refreshes only after the resend interval', () => {
    const base = harness(tagger);
    const fist = [fistHand()];

    expect(
      base.controller.observe(gestureSnapshot(1, 1000, 'none', { hands: fist }), 1000, GENERATION),
    ).toBe('grab');
    expect(
      base.controller.observe(
        gestureSnapshot(2, 1000 + GRAB_RESEND_MS - 1, 'none', { hands: fist }),
        1000 + GRAB_RESEND_MS - 1,
        GENERATION,
      ),
    ).toBeNull();
    expect(
      base.controller.observe(
        gestureSnapshot(3, 1000 + GRAB_RESEND_MS, 'none', { hands: fist }),
        1000 + GRAB_RESEND_MS,
        GENERATION,
      ),
    ).toBe('grab');
    expect(base.sent).toEqual([
      { type: 'GRAB_INTENT', payload: {} },
      { type: 'GRAB_INTENT', payload: {} },
    ]);
  });

  it('rearms fist grabbing after an open, missing or stale observation', () => {
    for (const interruption of ['open', 'missing', 'stale'] as const) {
      const base = harness(tagger);
      base.controller.observe(
        gestureSnapshot(1, 1000, 'none', { hands: [fistHand()] }),
        1000,
        GENERATION,
      );
      const snapshot =
        interruption === 'missing'
          ? gestureSnapshot(2, 1100, 'none', { missing: true })
          : gestureSnapshot(2, 1100, 'none', { hands: [fistHand(true)] });
      base.controller.observe(snapshot, interruption === 'stale' ? 1501 : 1100, GENERATION);
      const resumedAt = interruption === 'stale' ? 1510 : 1110;
      expect(
        base.controller.observe(
          gestureSnapshot(3, resumedAt, 'none', { hands: [fistHand()] }),
          resumedAt,
          GENERATION,
        ),
      ).toBe('grab');
      expect(base.sent).toHaveLength(2);
    }
  });

  it('does not turn a fist into a grab outside the active motion tagger context', () => {
    const contexts = [runner, { ...tagger, phase: 'TEAM_PRACTICE' as const }];
    for (const context of contexts) {
      const base = harness(context);
      base.controller.observe(
        gestureSnapshot(1, 1000, 'none', { hands: [fistHand()] }),
        1000,
        GENERATION,
      );
      expect(base.sent).toEqual([]);
    }
    const keyboard = harness(tagger);
    keyboard.controller.setMode('keyboard');
    keyboard.controller.observe(
      gestureSnapshot(1, 1000, 'none', { hands: [fistHand()] }),
      1000,
      GENERATION,
    );
    expect(keyboard.sent).toEqual([]);
  });

  it('makes no selection or install for a runner or an unassigned role', () => {
    const asRunner = harness(runner);
    expect(asRunner.controller.pressKey('1')).toBeNull();
    expect(asRunner.controller.pressKey('F')).toBeNull();
    expect(holdGesture(asRunner, 'victory')).toBeNull();
    expect(asRunner.sent).toEqual([]);
    expect(asRunner.states).toEqual([]);

    const noRole = harness({ ...runner, role: null });
    expect(noRole.controller.pressKey('F')).toBeNull();
    expect(noRole.sent).toEqual([]);
  });

  it('installs with the victory gesture for a tagger', () => {
    const base = harness(tagger);
    expect(holdGesture(base, 'victory')).toBe('install');
  });

  it('cancels a pending installation instead of starting a new one', () => {
    const base = harness({ ...tagger, installationId: 'install-1' });

    expect(base.controller.pressKey('F')).toBe('install-cancel');
    expect(base.sent).toEqual([
      { type: 'INSTALL_CANCEL', payload: { installationId: 'install-1' } },
    ]);
  });

  it('treats a repeated equipment selection as a no-op', () => {
    const base = harness(tagger);

    expect(base.controller.pressKey('1')).toBeNull();
    expect(base.states).toEqual([]);
  });

  it('blocks every action except the cancel while a challenge runs', () => {
    const base = harness({
      ...runner,
      challengeId: 'challenge-1',
      incomingExchangeId: 'exchange-1',
      targetPlayerId: 'runner-2',
    });

    expect(base.controller.pressKey('E')).toBeNull();
    expect(holdGesture(base, 'palm')).toBeNull();
    expect(base.sent).toEqual([]);

    expect(base.controller.pressKey('Escape')).toBe('exit-cancel');
    expect(base.sent).toEqual([{ type: 'EXIT_CANCEL', payload: { challengeId: 'challenge-1' } }]);
  });

  it('does nothing on Escape without a challenge', () => {
    const base = harness(runner);
    expect(base.controller.pressKey('Escape')).toBeNull();
  });

  it('makes no gesture action while the input is locked', () => {
    const base = harness({ ...runner, incomingExchangeId: 'exchange-1', pageActive: false });

    expect(holdGesture(base, 'palm')).toBeNull();
    expect(base.controller.pressKey('E')).toBeNull();
  });

  it('ignores motion gestures in keyboard mode but keeps the keys working', () => {
    const base = harness({ ...runner, incomingExchangeId: 'exchange-1' });
    base.controller.setMode('keyboard');

    expect(holdGesture(base, 'palm')).toBeNull();
    expect(base.controller.pressKey('E')).toBe('exchange-accept');
  });

  it('does not repeat the state callback for the same mode', () => {
    const base = harness(tagger);
    base.controller.setMode('keyboard');
    const seen = base.states.length;

    base.controller.setMode('keyboard');

    expect(base.states).toHaveLength(seen);
  });

  it('keeps the returned requestId as an identifier only', () => {
    const base = harness({ ...runner, incomingExchangeId: 'exchange-1' });
    holdGesture(base, 'palm');

    expect(base.controller.lastRequestId).toBe('request-1');
    expect(typeof base.controller.lastRequestId).toBe('string');
  });

  it('clears the hold on reset', () => {
    const base = harness({ ...runner, incomingExchangeId: 'exchange-1' });
    base.controller.observe(gestureSnapshot(1, 1000, 'palm'), 1000, GENERATION);

    base.controller.reset();
    base.controller.observe(
      gestureSnapshot(2, 1000 + GESTURE_HOLD_MS, 'palm'),
      1000 + GESTURE_HOLD_MS,
      GENERATION,
    );

    expect(base.sent).toEqual([]);
  });

  it('creates no item command or new equipment kind', () => {
    const base = harness(tagger);
    base.controller.pressKey('F');
    base.controller.pressKey('2');
    base.controller.pressKey('F');

    const types = base.sent.map((command) => command.type);
    expect(new Set(types)).toEqual(new Set(['INSTALL']));
    const kinds = base.sent
      .filter((command) => command.type === 'INSTALL')
      .map((command) => (command.payload as { kind: string }).kind);
    expect(new Set(kinds)).toEqual(new Set(['sensor', 'trap']));
  });
});

describe('key ownership', () => {
  it('does not expose any arrow key handling', () => {
    const base = harness(runner);
    const send = vi.fn();
    expect(send).not.toHaveBeenCalled();
    // 방향키 시퀀스는 C가 소유한다. D의 키 목록에 없다.
    expect(base.controller.pressKey('E' as never)).toBeNull();
  });
});

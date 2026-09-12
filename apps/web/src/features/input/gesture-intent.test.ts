import { describe, expect, it, vi } from 'vitest';

import type { SensorSnapshot } from '../vision/sensor-types';
import {
  createGestureIntentController,
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
  options: { missing?: boolean; generation?: number } = {},
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
          data: { kind, score: 0.9 },
        },
  };
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

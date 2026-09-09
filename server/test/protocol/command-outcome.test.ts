/**
 * accepted → core rejection (no private change) → command-outcome at the last applicable view
 * version → request-status returns the same outcome. Uses the FakeCore; C's SessionRuntime
 * consumer test must be run against these exact messages.
 */
import { describe, expect, it } from 'vitest';
import { commandOutcomeSchema, requestStatusResultSchema } from '@kkakkung/protocol/game-messages';
import { CommandQueue } from '../../src/game/CommandQueue.js';
import { EventDispatcher } from '../../src/game/EventDispatcher.js';
import { MatchContext } from '../../src/game/MatchContext.js';
import { MatchDriver } from '../../src/game/MatchDriver.js';
import { projectPrivateBody } from '../../src/game/PlayerProjection.js';
import {
  FakeCore,
  fakeClock,
  layoutFor,
  testTuning,
  type FakeState,
} from '../room/test-harness.js';

const requestId = '30000000-0000-4000-8000-000000000001';

describe('command outcome delivery', () => {
  it('closes an accepted EXIT_START that the core refuses with an outcome at the current view version', () => {
    const clock = fakeClock(0);
    const context = new MatchContext({ serverEpoch: 'e', matchId: 'match-1' });
    const queue = new CommandQueue();
    const core = new FakeCore({ reject: { EXIT_START: 'NOT_ALLOWED' } });
    const players = [
      { playerId: 'r1', role: 'runner' as const },
      { playerId: 't1', role: 'tagger' as const },
    ];
    const instance = context.createInstance('game');
    const layout = layoutFor(players);
    let state = core.createMatch({
      matchId: 'match-1',
      gameInstanceId: instance.gameInstanceId,
      seed: 1,
      tuning: testTuning,
      layout,
      players,
    });
    const sent: { channel: string; playerId: string; message: unknown }[] = [];
    const dispatcher = new EventDispatcher({
      context,
      now: clock.now,
      sender: {
        sendView: (playerId, message) => sent.push({ channel: 'private-view', playerId, message }),
        sendEvent: (playerId, message) =>
          sent.push({ channel: 'private-event', playerId, message }),
        sendOutcome: (playerId, message) =>
          sent.push({ channel: 'command-outcome', playerId, message }),
        sendStatus: (playerId, message) =>
          sent.push({ channel: 'request-status-result', playerId, message }),
      },
      viewBody: (playerId) => projectPrivateBody(core, state, playerId, null),
    });
    const driver = new MatchDriver<FakeState>({
      core,
      context,
      queue,
      now: clock.now,
      handlePhaseCommand: () => ({ result: 'rejected', code: 'INVALID_PHASE' }),
      onStateCommitted: (attached) => {
        state = attached.state;
        for (const p of players) dispatcher.publishView(p.playerId, 'change', 'PLAYING');
      },
      stateVersionFor: (actorId) => dispatcher.applicableVersion(actorId),
      onOutcome: (actorId, outcome) => dispatcher.sendOutcome(actorId, outcome),
      onEvent: (event, id) => dispatcher.dispatchEvent(event, id),
      onMediaFrame: () => undefined,
      onMediaIntent: () => undefined,
      onIntegrityFailure: () => undefined,
    });
    driver.attach({
      gameInstanceId: instance.gameInstanceId,
      kind: 'game',
      state,
      topology: layout.topology,
    });
    for (const p of players) context.enterInstance(p.playerId, instance.gameInstanceId);
    driver.enqueueControl(instance.gameInstanceId, { type: 'START_PLAYING', startTick: 1 });
    driver.tick();
    for (const p of players) dispatcher.publishView(p.playerId, 'initial', 'PLAYING');
    const viewVersion = dispatcher.applicableVersion('r1');
    const viewsBefore = sent.filter((s) => s.channel === 'private-view').length;

    const accepted = queue.accept({
      actorId: 'r1',
      command: {
        matchId: 'match-1',
        requestId,
        sequence: 12,
        type: 'EXIT_START',
        payload: { exitId: 'exit-r1' },
      },
      gameInstanceId: instance.gameInstanceId,
      nowMs: clock.now(),
      stateVersion: viewVersion,
    });
    expect(accepted.status).toBe('accepted');
    driver.tick();
    const outcome = sent.find((s) => s.channel === 'command-outcome');
    expect(outcome?.playerId).toBe('r1');
    expect(commandOutcomeSchema.parse(outcome?.message)).toEqual({
      matchId: 'match-1',
      requestId,
      sequence: 12,
      tick: 2,
      stateVersion: viewVersion,
      result: 'rejected',
      code: 'NOT_ALLOWED',
    });
    // No private view changed, so no new view was sent and the outcome references the last one.
    expect(sent.filter((s) => s.channel === 'private-view').length).toBe(viewsBefore);
    dispatcher.sendStatus('r1', queue.status('r1', 'match-1', requestId));
    const status = sent.find((s) => s.channel === 'request-status-result');
    expect(requestStatusResultSchema.parse(status?.message)).toEqual({
      matchId: 'match-1',
      requestId,
      status: 'done',
      outcome: outcome?.message,
    });
    expect(queue.status('t1', 'match-1', requestId)).toEqual({
      matchId: 'match-1',
      requestId,
      status: 'unknown',
      outcome: null,
    });
    // Same request again: original receipt/outcome replayed, no second core call.
    const steps = core.calls.filter((c) => c.method === 'stepMatch').length;
    const replay = queue.accept({
      actorId: 'r1',
      command: {
        matchId: 'match-1',
        requestId,
        sequence: 12,
        type: 'EXIT_START',
        payload: { exitId: 'exit-r1' },
      },
      gameInstanceId: instance.gameInstanceId,
      nowMs: clock.now(),
      stateVersion: viewVersion,
    });
    expect(replay).toMatchObject({ status: 'duplicate', outcome: outcome?.message });
    driver.tick();
    const lastStep = core.calls.filter((c) => c.method === 'stepMatch').at(-1)!.args as {
      commands: unknown[];
    };
    expect(core.calls.filter((c) => c.method === 'stepMatch').length).toBe(steps + 1);
    expect(lastStep.commands).toEqual([]);
  });
});

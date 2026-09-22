/**
 * Single-tick path with the harness FakeCore. These checks prove the driver's queue/outcome/
 * event boundaries only; real rule integration waits for A's engine.
 */
import { describe, expect, it } from 'vitest';
import type { CommandEnvelope, CommandOutcome } from '@kkakkung/protocol/game-messages';
import { CommandQueue } from '../../src/game/CommandQueue.js';
import { MatchContext } from '../../src/game/MatchContext.js';
import { MatchDriver } from '../../src/game/MatchDriver.js';
import type { AudienceEvent, MediaIntent, TrustedMediaFrame } from '../../src/game/ports.js';
import { FakeCore, fakeClock, layoutFor, testTuning, type FakeState } from './test-harness.js';

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const players = [
  { playerId: 'r1', role: 'runner' as const },
  { playerId: 'r2', role: 'runner' as const },
  { playerId: 't1', role: 'tagger' as const },
];

function setup(core = new FakeCore({ emitEvents: true })) {
  const clock = fakeClock(1000);
  const context = new MatchContext({ serverEpoch: 'e', matchId: 'match-1' });
  const queue = new CommandQueue();
  const outcomes: { actorId: string; outcome: CommandOutcome }[] = [];
  const events: AudienceEvent[] = [];
  const frames: TrustedMediaFrame[] = [];
  const intents: MediaIntent[] = [];
  const failures: string[] = [];
  const committed: string[] = [];
  const driver = new MatchDriver<FakeState>({
    core,
    context,
    queue,
    now: clock.now,
    handlePhaseCommand: () => ({ result: 'applied', code: null }),
    onStateCommitted: (instance) => committed.push(instance.gameInstanceId),
    stateVersionFor: () => context.stateVersion,
    onOutcome: (actorId, outcome) => outcomes.push({ actorId, outcome }),
    onEvent: (event) => events.push(event),
    onMediaFrame: (frame) => frames.push(frame),
    onMediaIntent: (intent) => intents.push(intent),
    onIntegrityFailure: (id, reason) => failures.push(`${id}:${reason}`),
  });
  const instance = context.createInstance('game');
  const layout = layoutFor(players);
  const state = core.createMatch({
    matchId: 'match-1',
    gameInstanceId: instance.gameInstanceId,
    seed: 1,
    tuning: testTuning,
    layout,
    players,
  });
  driver.attach({
    gameInstanceId: instance.gameInstanceId,
    kind: 'game',
    state,
    topology: layout.topology,
    mediaInstanceId: 'media-1',
  });
  for (const p of players) context.enterInstance(p.playerId, instance.gameInstanceId);
  driver.enqueueControl(instance.gameInstanceId, { type: 'START_PLAYING', startTick: 1 });
  driver.tick();
  const accept = (actorId: string, command: CommandEnvelope) =>
    queue.accept({
      actorId,
      command,
      gameInstanceId: instance.gameInstanceId,
      nowMs: clock.now(),
      stateVersion: context.stateVersion,
    });
  const actorOffset: Record<string, number> = { r1: 1000, r2: 2000, t1: 3000 };
  const move = (
    actorId: string,
    sequence: number,
    direction: 'forward' | 'back' | null = 'forward',
  ): CommandEnvelope => ({
    matchId: 'match-1',
    requestId: uuid((actorOffset[actorId] ?? 9000) + sequence),
    sequence,
    type: 'MOVE_INTENT',
    payload: { direction },
  });
  return {
    clock,
    context,
    queue,
    driver,
    core,
    outcomes,
    events,
    frames,
    intents,
    failures,
    committed,
    instance,
    accept,
    move,
    state,
  };
}

describe('MatchDriver single tick path', () => {
  it('steps once with frozen input and closes every accepted command exactly once', () => {
    const h = setup();
    h.accept('r1', h.move('r1', 1));
    h.accept('r2', h.move('r2', 1));
    h.accept('t1', {
      matchId: 'match-1',
      requestId: uuid(50),
      sequence: 1,
      type: 'TURN',
      payload: { direction: 'left' },
    });
    const stepsBefore = h.core.calls.filter((c) => c.method === 'stepMatch').length;
    const report = h.driver.tick();
    expect(h.core.calls.filter((c) => c.method === 'stepMatch').length).toBe(stepsBefore + 1);
    expect(report.processed).toBe(3);
    expect(h.outcomes).toHaveLength(3);
    expect(h.outcomes.every((o) => o.outcome.result === 'applied')).toBe(true);
    expect(h.queue.pendingCount()).toBe(0);
    expect(h.committed).toContain(h.instance.gameInstanceId);
    // Spatial sounds reach the media frame only; hunter markers reach the tagger audience only.
    const frame = h.frames.at(-1)!;
    expect(frame.events.map((e) => e.kind)).toEqual(['footstep', 'footstep']);
    expect(frame.mediaInstanceId).toBe('media-1');
    expect(
      h.events.every(
        (e) =>
          e.type === 'HUNTER_MARKER' && e.audience.includes('t1') && !e.audience.includes('r1'),
      ),
    ).toBe(true);
    expect(JSON.stringify(h.events)).not.toContain('SPATIAL_SOUND');
  });

  it('turns a core rejection into a rejected outcome without changing state or sending applied', () => {
    const h = setup(new FakeCore({ reject: { EXIT_START: 'NOT_ALLOWED' } }));
    h.accept('r1', {
      matchId: 'match-1',
      requestId: uuid(7),
      sequence: 7,
      type: 'EXIT_START',
      payload: { exitId: 'exit-r1' },
    });
    const before = h.core.getFrame(
      h.driver.instance(h.instance.gameInstanceId)!.state,
    ).participants;
    h.driver.tick();
    expect(h.outcomes).toEqual([
      {
        actorId: 'r1',
        outcome: {
          matchId: 'match-1',
          requestId: uuid(7),
          sequence: 7,
          tick: 2,
          stateVersion: h.context.stateVersion,
          result: 'rejected',
          code: 'NOT_ALLOWED',
        },
      },
    ]);
    expect(
      h.core.getFrame(h.driver.instance(h.instance.gameInstanceId)!.state).participants,
    ).toEqual(before);
    expect(h.queue.status('r1', 'match-1', uuid(7)).status).toBe('done');
    // A new request is possible right away.
    expect(h.accept('r1', h.move('r1', 8)).status).toBe('accepted');
  });

  it('applies controls only on the next tick and never inside the enqueueing callback', () => {
    const h = setup();
    const before = h.core.getFrame(h.driver.instance(h.instance.gameInstanceId)!.state);
    h.driver.enqueueControl(h.instance.gameInstanceId, { type: 'CONNECTION_LOST', playerId: 'r1' });
    expect(h.core.getFrame(h.driver.instance(h.instance.gameInstanceId)!.state)).toEqual(before);
    h.driver.tick();
    const after = h.core.getFrame(h.driver.instance(h.instance.gameInstanceId)!.state);
    expect(after.participants.find((p) => p.playerId === 'r1')?.status).toBe('CAPTURED');
    expect(h.intents).toContainEqual({
      type: 'RETIRE_PLAYER',
      playerId: 'r1',
      reason: 'connection-lost',
    });
  });

  // S15P21C204-335. A decided instance used to step and emit a media frame every tick of the
  // result screen, and each frame asked E to retire the round's media again.
  it('keeps a settled instance attached but never steps it or emits another frame', () => {
    const h = setup();
    const framesBefore = h.frames.length;
    const stateBefore = h.driver.instance(h.instance.gameInstanceId)!.state;
    h.driver.settle(h.instance.gameInstanceId);
    h.driver.enqueueControl(h.instance.gameInstanceId, { type: 'CONNECTION_LOST', playerId: 'r1' });
    h.accept('r1', h.move('r1', 1));
    for (let i = 0; i < 5; i++) h.driver.tick();
    expect(h.frames).toHaveLength(framesBefore);
    expect(h.driver.instance(h.instance.gameInstanceId)?.state).toBe(stateBefore);
    expect(h.driver.attached().map((i) => i.gameInstanceId)).toEqual([h.instance.gameInstanceId]);
    expect(h.outcomes.at(-1)?.outcome).toMatchObject({ result: 'canceled', code: 'ROUND_ENDED' });
  });

  it('cancels pending requests of a detached instance and ignores late results for it', () => {
    const h = setup();
    h.accept('r1', h.move('r1', 1));
    h.accept('r2', h.move('r2', 1));
    const canceled = h.driver.detach(h.instance.gameInstanceId);
    expect(canceled.map((c) => c.outcome.result)).toEqual(['canceled', 'canceled']);
    expect(h.outcomes.every((o) => o.outcome.code === 'CANCELED')).toBe(true);
    const report = h.driver.tick();
    expect(report.stepped).toEqual([]);
    expect(h.frames.filter((f) => f.tick === report.tick)).toEqual([]);
  });

  it('cancels commands whose actor already left the instance instead of applying them elsewhere', () => {
    const h = setup();
    h.accept('r1', h.move('r1', 1));
    h.context.leaveInstance('r1');
    h.driver.tick();
    expect(h.outcomes).toEqual([
      expect.objectContaining({
        actorId: 'r1',
        outcome: expect.objectContaining({ result: 'canceled', code: 'CANCELED' }),
      }),
    ]);
  });

  it('refuses to commit a step whose outcomes are missing or duplicated and closes pending as ROUND_ENDED', () => {
    for (const mode of ['drop', 'duplicate'] as const) {
      const h = setup(new FakeCore({ corruptOutcomes: mode }));
      h.accept('r1', h.move('r1', 1));
      h.accept('r2', h.move('r2', 1));
      const before = h.core.getFrame(
        h.driver.instance(h.instance.gameInstanceId)!.state,
      ).participants;
      const report = h.driver.tick();
      expect(report.integrityFailures).toEqual([h.instance.gameInstanceId]);
      expect(h.failures[0]).toMatch(
        mode === 'drop' ? /OUTCOME_COUNT_MISMATCH/ : /OUTCOME_COUNT_MISMATCH|DUPLICATE_OUTCOME/,
      );
      expect(
        h.outcomes.every(
          (o) => o.outcome.result === 'canceled' && o.outcome.code === 'ROUND_ENDED',
        ),
      ).toBe(true);
      expect(h.outcomes).toHaveLength(2);
      expect(
        h.core.getFrame(h.driver.instance(h.instance.gameInstanceId)!.state).participants,
      ).toEqual(before);
      expect(h.queue.pendingCount()).toBe(0);
    }
  });

  it('expires a held move by the real clock and cancels stale queued moves before the core', () => {
    const h = setup();
    h.accept('r1', h.move('r1', 1));
    h.driver.tick();
    h.clock.advance(501);
    h.accept('r1', h.move('r1', 2));
    h.clock.advance(600);
    const steps = h.core.calls.filter((c) => c.method === 'stepMatch').length;
    h.driver.tick();
    const lastStep = h.core.calls.filter((c) => c.method === 'stepMatch').at(-1)!.args as {
      commands: unknown[];
      controls: unknown[];
    };
    expect(h.core.calls.filter((c) => c.method === 'stepMatch').length).toBe(steps + 1);
    expect(lastStep.commands).toEqual([]);
    expect(lastStep.controls).toContainEqual({ type: 'EXPIRE_MOVE', playerId: 'r1', sequence: 1 });
    expect(h.outcomes.at(-1)?.outcome).toMatchObject({
      sequence: 2,
      result: 'canceled',
      code: 'EXPIRED',
    });
  });
});

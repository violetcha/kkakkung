// F-12 / QA-07 G3 regression on the real module composition: A `matchCore` stepped by B's
// MatchDriver/CommandQueue/MatchContext with six authenticated player ids and protocol 0.2.0
// command envelopes. Covers G3-A (capture, escape, personal end vs. connection loss ordering),
// G3-B (trap install, arming, restraint, same-tick priority) on A's real handlers, and keeps
// undecided items (G3-C) out of pass/fail. No Cloud, device or socket is involved.
import { describe, expect, it } from 'vitest';
import { COMMAND_TYPES } from '@kkakkung/protocol/game-messages';
import {
  activeExits,
  createPriorityOrder,
  priorityForTick,
  selectPriorityCandidate,
} from '@kkakkung/game-core/match';
import {
  DEFAULT_PLACEMENTS,
  G3_RULES_LANDED,
  G3_TUNING,
  PRODUCT_DECISION_PENDING,
  createG3Harness,
  frameDigest,
  type G3Harness,
  type Placement,
} from '../fixtures/g3-scenarios.ts';

const MOVE = G3_TUNING.moveTicks;
const EXIT_MIN = G3_TUNING.exitMinimumTicks;
const EXIT_EXPIRY = G3_TUNING.exitExpiryTicks;
const EXIT_RETRY = G3_TUNING.exitRetryTicks;
const INSTALL = G3_TUNING.installationTicks;
const ARM = G3_TUNING.armTicks;
const RESTRAINT = G3_TUNING.restraintTicks;
const IMMUNITY = G3_TUNING.restraintImmunityTicks;

const challengeEnded = (h: G3Harness) => h.events.filter((e) => e.type === 'EXIT_CHALLENGE_ENDED');
const challengeStarted = (h: G3Harness) => h.events.filter((e) => e.type === 'EXIT_CHALLENGE');
const progress = (challengeId: string, completed = true) =>
  ({ challengeId, method: 'pose', completed }) as const;

describe('assembly: A matchCore through B driver', () => {
  it('creates a six-player game and opens play with a fixed deadline', () => {
    const h = createG3Harness();
    expect(h.frame().phase).toBe('GAME_LOADING');
    expect(h.frame().participants).toHaveLength(6);
    h.start();
    const s = h.state();
    expect(s.phase).toBe('PLAYING');
    expect(s.startTick).toBe(1);
    expect(s.deadlineTick).toBe(1 + G3_TUNING.roundTicks);
    expect(activeExits(s.exits)).toHaveLength(3);
    expect(h.integrityFailures).toEqual([]);
  });

  it('accepts protocol envelopes and closes every processed command with exactly one outcome', () => {
    const h = createG3Harness();
    h.start();
    expect(h.move('t1').status).toBe('accepted');
    expect(h.turn('r2', 'left').status).toBe('accepted');
    const report = h.tick();
    expect(report.processed).toBe(2);
    expect(h.outcomes).toHaveLength(2);
    expect(h.outcomes.every((o) => o.outcome.result === 'applied')).toBe(true);
    expect(h.player('t1').action?.kind).toBe('move');
  });
});

describe('G3-A personal end and connection loss', () => {
  it('a contact capture fixes the runner once, closes its exit and keeps the match running', () => {
    const h = createG3Harness();
    h.start();
    h.move('t1');
    h.ticks(MOVE + 1);
    const r1 = h.player('r1');
    expect(r1.status).toBe('CAPTURED');
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 1 });
    expect(h.frame().phase).toBe('PLAYING');
    expect(
      activeExits(h.state().exits)
        .map((e) => e.ownerId)
        .sort(),
    ).toEqual(['r2', 'r3']);
    expect(h.intents).toContainEqual({
      type: 'RETIRE_PLAYER',
      playerId: 'r1',
      reason: 'personal-ended',
    });
    expect(h.intents.some((i) => i.type === 'RETIRE_INSTANCE')).toBe(false);
    // The ended runner no longer acts; the others do.
    h.move('r1');
    h.move('r2');
    h.tick();
    expect(h.lastOutcome('r1')).toMatchObject({ result: 'rejected', code: 'NOT_ACTIVE' });
    expect(h.lastOutcome('r2')).toMatchObject({ result: 'applied' });
  });

  it('close in the same tick as the capture: the personal result wins, the match continues', () => {
    const h = createG3Harness();
    h.start();
    h.move('t1');
    h.ticks(MOVE);
    // The tagger's move completes on the next tick; the socket closes in that same tick.
    h.lost('r1');
    h.tick();
    expect(h.player('r1').status).toBe('CAPTURED');
    expect(h.player('r1').connected).toBe(false);
    expect(h.frame().phase).toBe('PLAYING');
    expect(h.frame().abortReason).toBeNull();
    expect(h.frame().counts.captured).toBe(1);
    expect(activeExits(h.state().exits)).toHaveLength(2);
    // Ended-then-disconnected is not an abort: no RETIRE_INSTANCE, only the personal retirement.
    expect(h.intents.filter((i) => i.type === 'RETIRE_INSTANCE')).toEqual([]);
  });

  it('close one tick earlier: an ACTIVE runner leaving aborts with GAME_CONNECTION_LOST', () => {
    const h = createG3Harness();
    h.start();
    h.move('t1');
    h.ticks(MOVE - 1);
    h.lost('r1');
    h.tick();
    expect(h.frame().phase).toBe('ABORTED');
    expect(h.frame().abortReason).toBe('GAME_CONNECTION_LOST');
    expect(h.player('r1').status).toBe('ACTIVE');
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 0 });
    expect(h.intents).toContainEqual({ type: 'RETIRE_INSTANCE', reason: 'aborted' });
    // The pending capture never lands and later commands are canceled, not applied.
    h.tick();
    expect(h.player('r1').status).toBe('ACTIVE');
    h.move('r2');
    h.tick();
    expect(h.lastOutcome('r2')).toMatchObject({ result: 'canceled', code: 'ROUND_ENDED' });
  });

  it('an ACTIVE tagger leaving aborts as well; ended players leaving never does', () => {
    const tagger = createG3Harness();
    tagger.start();
    tagger.lost('t3');
    tagger.tick();
    expect(tagger.frame().phase).toBe('ABORTED');
    expect(tagger.frame().abortReason).toBe('GAME_CONNECTION_LOST');

    const ended = createG3Harness();
    ended.start();
    ended.move('t1');
    ended.ticks(MOVE + 1);
    expect(ended.player('r1').status).toBe('CAPTURED');
    ended.lost('r1');
    ended.tick();
    expect(ended.frame().phase).toBe('PLAYING');
    expect(ended.player('r1').connected).toBe(false);
  });

  it('two captures end the round for taggers and cancel everything after', () => {
    const h = createG3Harness();
    h.start();
    h.move('t1');
    h.move('t2');
    h.ticks(MOVE + 1);
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 2 });
    expect(h.frame().phase).toBe('RESULT');
    expect(h.frame().result).toEqual({ winner: 'taggers', reason: 'two-captured' });
    expect(h.intents).toContainEqual({ type: 'RETIRE_INSTANCE', reason: 'round-ended' });
    expect(h.player('r3').status).toBe('ACTIVE');
    h.move('r3');
    h.tick();
    expect(h.lastOutcome('r3')).toMatchObject({ result: 'canceled', code: 'ROUND_ENDED' });
    // Counts are never rolled back by a later disconnect.
    h.lost('r1');
    h.tick();
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 2 });
  });
});

describe(`G3-A escape (${G3_RULES_LANDED.escape})`, () => {
  /** r1 walks from (5,6) to its approach cell (5,3), still facing the exit wall (5,2). */
  function runnerAtApproach(h: G3Harness) {
    h.walk('r1', 3);
    expect(h.player('r1').cell).toEqual({ x: 5, y: 3 });
    expect(h.player('r1').dir).toBe(0);
    expect(h.send('r1', 'EXIT_START', { exitId: 'exit-r1' })).toMatchObject({ result: 'applied' });
    const challenge = h.player('r1').challenge;
    if (!challenge) throw new Error('no challenge issued');
    return challenge;
  }

  it('a runner escapes through its own exit: challenge at the approach, success only from the 2 s minimum', () => {
    const h = createG3Harness();
    h.start();
    const challenge = runnerAtApproach(h);
    const startedAt = h.state().tick!;
    expect(challenge).toEqual({
      challengeId: 'ch-1',
      exitId: 'exit-r1',
      poseKind: 'left',
      startedAtTick: startedAt,
      minSuccessTick: startedAt + EXIT_MIN,
      expiresAtTick: startedAt + EXIT_EXPIRY,
    });
    expect(challengeStarted(h)).toEqual([
      expect.objectContaining({ audience: ['r1'], payload: challenge }),
    ]);
    // The pose locks movement and turning.
    h.move('r1');
    h.turn('r1', 'left');
    h.tick();
    expect(
      h
        .outcomesOf('r1')
        .slice(-2)
        .map((o) => o.outcome.code),
    ).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
    // An early success report is refused and changes nothing.
    expect(h.send('r1', 'EXIT_PROGRESS', progress('ch-1'))).toMatchObject({
      result: 'rejected',
      code: 'NOT_READY',
    });
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 0 });
    expect(h.player('r1').challenge).toEqual(challenge);
    // From the minimum tick the report succeeds exactly once.
    h.until(challenge.minSuccessTick - 1);
    expect(h.send('r1', 'EXIT_PROGRESS', progress('ch-1'))).toMatchObject({ result: 'applied' });
    expect(h.state().tick).toBe(challenge.minSuccessTick);
    expect(h.player('r1').status).toBe('ESCAPED');
    expect(h.frame().counts).toEqual({ escaped: 1, captured: 0 });
    expect(h.frame().phase).toBe('PLAYING');
    expect(
      activeExits(h.state().exits)
        .map((e) => e.ownerId)
        .sort(),
    ).toEqual(['r2', 'r3']);
    expect(challengeEnded(h)).toEqual([
      expect.objectContaining({
        audience: ['r1'],
        payload: { challengeId: 'ch-1', result: 'escaped', reason: null },
      }),
    ]);
    expect(h.intents).toContainEqual({
      type: 'RETIRE_PLAYER',
      playerId: 'r1',
      reason: 'personal-ended',
    });
    // A repeated report of the same id is refused; the count stays.
    expect(h.send('r1', 'EXIT_PROGRESS', progress('ch-1'))).toMatchObject({
      result: 'rejected',
      code: 'NOT_ACTIVE',
    });
    expect(h.frame().counts.escaped).toBe(1);
    expect(h.integrityFailures).toEqual([]);
  });

  it('EXIT_START away from the approach, on a foreign exit, or by a tagger issues no challenge', () => {
    const h = createG3Harness();
    h.start();
    h.accept('r1', h.envelope('r1', 'EXIT_START', { exitId: 'exit-r1' }));
    h.accept('r2', h.envelope('r2', 'EXIT_START', { exitId: 'exit-r1' }));
    h.accept('t1', h.envelope('t1', 'EXIT_START', { exitId: 'exit-r1' }));
    h.tick();
    for (const id of ['r1', 'r2', 't1'])
      expect(h.lastOutcome(id)).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(h.state().challengeSeq).toBe(0);
    expect(challengeStarted(h)).toEqual([]);
    // A report without a challenge is stale, not an escape.
    expect(h.send('r1', 'EXIT_PROGRESS', progress('ch-1'))).toMatchObject({
      result: 'rejected',
      code: 'STALE_REQUEST',
    });
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 0 });
  });

  it('a capture landing in the same tick as the success report wins: report canceled, no escape', () => {
    const h = createG3Harness();
    h.start();
    const challenge = runnerAtApproach(h);
    // t1 follows to the cell behind the approach while the runner holds its pose.
    h.walk('t1', 3);
    expect(h.player('t1').cell).toEqual({ x: 5, y: 4 });
    expect(h.player('r1').status).toBe('ACTIVE');
    h.until(challenge.minSuccessTick);
    // The tagger's last step completes on the very tick the report is processed.
    h.move('t1');
    h.ticks(MOVE);
    h.accept('r1', h.envelope('r1', 'EXIT_PROGRESS', progress('ch-1')));
    h.tick();
    expect(h.player('t1').cell).toEqual({ x: 5, y: 3 });
    expect(h.player('r1').status).toBe('CAPTURED');
    expect(h.lastOutcome('r1')).toMatchObject({ result: 'canceled', code: 'NOT_ACTIVE' });
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 1 });
    expect(h.player('r1').challenge).toBeNull();
    expect(challengeEnded(h)).toEqual([
      expect.objectContaining({
        payload: { challengeId: 'ch-1', result: 'canceled', reason: 'NOT_ACTIVE' },
      }),
    ]);
    expect(h.frame().phase).toBe('PLAYING');
  });

  it('two escapes end the round for the runners and cancel everything after', () => {
    const h = createG3Harness();
    h.start();
    // r1 (3 steps) and r2 (5 steps) walk north to their approaches.
    h.walk('r1', 3);
    h.walk('r2', 5);
    expect(h.player('r1').cell).toEqual({ x: 5, y: 3 });
    expect(h.player('r2').cell).toEqual({ x: 2, y: 3 });
    h.accept('r1', h.envelope('r1', 'EXIT_START', { exitId: 'exit-r1' }));
    h.accept('r2', h.envelope('r2', 'EXIT_START', { exitId: 'exit-r2' }));
    h.tick();
    const c1 = h.player('r1').challenge!;
    const c2 = h.player('r2').challenge!;
    expect([c1.challengeId, c2.challengeId].sort()).toEqual(['ch-1', 'ch-2']);
    h.until(Math.max(c1.minSuccessTick, c2.minSuccessTick) - 1);
    h.accept('r1', h.envelope('r1', 'EXIT_PROGRESS', progress(c1.challengeId)));
    h.accept('r2', h.envelope('r2', 'EXIT_PROGRESS', progress(c2.challengeId)));
    h.tick();
    expect(h.frame().counts).toEqual({ escaped: 2, captured: 0 });
    expect(h.frame().phase).toBe('RESULT');
    expect(h.frame().result).toEqual({ winner: 'runners', reason: 'two-escaped' });
    expect(h.intents).toContainEqual({ type: 'RETIRE_INSTANCE', reason: 'round-ended' });
    expect(h.player('r3').status).toBe('ACTIVE');
    expect(h.send('t3', 'MOVE_INTENT', { direction: 'forward' })).toMatchObject({
      result: 'canceled',
      code: 'ROUND_ENDED',
    });
  });

  it('an unfinished challenge fails at the 8 s deadline and the retry gate opens 10 ticks later', () => {
    const h = createG3Harness();
    h.start();
    const challenge = runnerAtApproach(h);
    h.until(challenge.expiresAtTick);
    expect(h.player('r1').challenge).toBeNull();
    expect(h.player('r1').status).toBe('ACTIVE');
    expect(challengeEnded(h)).toEqual([
      expect.objectContaining({
        audience: ['r1'],
        payload: { challengeId: 'ch-1', result: 'failed', reason: 'EXPIRED' },
      }),
    ]);
    // Straight away: the retry gate refuses. Ten ticks later a new challenge id is issued.
    expect(h.send('r1', 'EXIT_START', { exitId: 'exit-r1' })).toMatchObject({
      result: 'rejected',
      code: 'NOT_ALLOWED',
    });
    h.until(challenge.expiresAtTick + EXIT_RETRY - 1);
    expect(h.send('r1', 'EXIT_START', { exitId: 'exit-r1' })).toMatchObject({ result: 'applied' });
    expect(h.player('r1').challenge).toMatchObject({ challengeId: 'ch-2', poseKind: 'left' });
    // A cancel by the owner ends it as canceled and also arms the retry gate.
    expect(h.send('r1', 'EXIT_CANCEL', { challengeId: 'ch-2' })).toMatchObject({
      result: 'applied',
    });
    expect(h.player('r1').challenge).toBeNull();
    expect(challengeEnded(h).at(-1)).toMatchObject({
      payload: { challengeId: 'ch-2', result: 'canceled', reason: 'CANCELED' },
    });
    expect(h.send('r1', 'EXIT_START', { exitId: 'exit-r1' })).toMatchObject({
      result: 'rejected',
      code: 'NOT_ALLOWED',
    });
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 0 });
  });
});

describe(`G3-B trap and priority (${G3_RULES_LANDED.trap})`, () => {
  it('a tagger installs a trap off its start cell, it arms 20 ticks after placement, and the first runner entering is restrained', () => {
    const h = createG3Harness();
    h.start();
    // Start cells refuse devices.
    expect(h.send('t1', 'INSTALL', { kind: 'trap' })).toMatchObject({
      result: 'rejected',
      code: 'NOT_ALLOWED',
    });
    h.face('t1', 'right');
    h.walk('t1', 1);
    expect(h.player('t1').cell).toEqual({ x: 6, y: 7 });
    expect(h.send('t1', 'INSTALL', { kind: 'trap' })).toMatchObject({ result: 'applied' });
    const placedAt = h.state().tick!;
    expect(h.player('t1').installation).toEqual({
      installationId: 'ins-1',
      kind: 'trap',
      startTick: placedAt,
      endTick: placedAt + INSTALL,
      armedTick: placedAt + INSTALL + ARM,
    });
    // Reserving spends nothing; completion spends one charge and leaves the device unarmed.
    expect(h.player('t1').equipment).toEqual({ sensor: 1, trap: 1 });
    h.until(placedAt + INSTALL);
    expect(h.player('t1').installation).toBeNull();
    expect(h.player('t1').equipment).toEqual({ sensor: 1, trap: 0 });
    expect(h.player('t1').ownedEquipment).toEqual([
      {
        equipmentId: 'eq-1',
        state: 'UNARMED',
        armedTick: placedAt + INSTALL + ARM,
        kind: 'trap',
        cell: { x: 6, y: 7 },
      },
    ]);
    h.until(placedAt + INSTALL + ARM);
    expect(h.player('t1').ownedEquipment[0]!.state).toBe('ARMED');
    // The installer walks on; the device stays on the floor.
    h.walk('t1', 1);
    expect(h.player('t1').cell).toEqual({ x: 7, y: 7 });
    // r1 comes around into the trap cell: east one cell, then south into (6,7).
    h.face('r1', 'right');
    h.walk('r1', 1);
    expect(h.player('r1').cell).toEqual({ x: 6, y: 6 });
    h.face('r1', 'right');
    expect(h.player('r1').dir).toBe(2);
    h.step('r1');
    const trappedAt = h.state().tick!;
    expect(h.player('r1').cell).toEqual({ x: 6, y: 7 });
    // Restrained, not captured: the tagger stands one cell away.
    expect(h.player('r1').status).toBe('ACTIVE');
    expect(h.player('r1').restraintUntilTick).toBe(trappedAt + RESTRAINT);
    expect(h.player('t1').ownedEquipment[0]).toMatchObject({ equipmentId: 'eq-1', state: 'SPENT' });
    // The activation reaches the media path as a spot and a sound, never as a runner id.
    const sounds = h.frames.flatMap((f) => f.events).filter((s) => s.kind === 'trap');
    expect(sounds).toEqual([
      expect.objectContaining({ tick: trappedAt, kind: 'trap', cell: { x: 6, y: 7 } }),
    ]);
    expect(JSON.stringify(sounds)).not.toContain('r1');
    // While restrained: moving is refused, looking around is allowed.
    expect(h.send('r1', 'MOVE_INTENT', { direction: 'forward' })).toMatchObject({
      result: 'rejected',
      code: 'NOT_ALLOWED',
    });
    expect(h.send('r1', 'TURN', { direction: 'left' })).toMatchObject({ result: 'applied' });
    // Release at the end tick; the re-restraint immunity runs for the next 40 ticks.
    h.until(trappedAt + RESTRAINT);
    expect(h.player('r1').restraintUntilTick).toBeNull();
    expect(h.player('r1').restraintImmuneUntilTick).toBe(trappedAt + RESTRAINT + IMMUNITY);
    expect(h.send('r1', 'MOVE_INTENT', { direction: 'forward' })).toMatchObject({
      result: 'applied',
    });
    expect(h.integrityFailures).toEqual([]);
  });

  it('two runners entering one trap in the same tick: exactly one is restrained, chosen by the seeded priority', () => {
    // t1 faces south onto (6,5); r1 and r2 face that cell from west and east.
    const placements: readonly Placement[] = [
      { playerId: 'r1', role: 'runner', cell: { x: 5, y: 5 }, dir: 1 },
      { playerId: 'r2', role: 'runner', cell: { x: 7, y: 5 }, dir: 3 },
      { playerId: 'r3', role: 'runner', cell: { x: 2, y: 9 }, dir: 0 },
      { playerId: 't1', role: 'tagger', cell: { x: 6, y: 4 }, dir: 2 },
      { playerId: 't2', role: 'tagger', cell: { x: 9, y: 9 }, dir: 0 },
      { playerId: 't3', role: 'tagger', cell: { x: 10, y: 10 }, dir: 0 },
    ];
    const h = createG3Harness({ placements });
    h.start();
    h.walk('t1', 1);
    expect(h.player('t1').cell).toEqual({ x: 6, y: 5 });
    expect(h.send('t1', 'INSTALL', { kind: 'trap' })).toMatchObject({ result: 'applied' });
    h.ticks(INSTALL + ARM);
    expect(h.player('t1').ownedEquipment[0]).toMatchObject({
      state: 'ARMED',
      cell: { x: 6, y: 5 },
    });
    h.walk('t1', 1);
    expect(h.player('t1').cell).toEqual({ x: 6, y: 6 });
    // Both runners step onto the trap in the same tick.
    h.move('r1');
    h.move('r2');
    h.ticks(MOVE);
    h.stop('r1');
    h.stop('r2');
    h.tick();
    expect(h.player('r1').cell).toEqual({ x: 6, y: 5 });
    expect(h.player('r2').cell).toEqual({ x: 6, y: 5 });
    const restrained = ['r1', 'r2'].filter((id) => h.player(id).restraintUntilTick !== null);
    expect(restrained).toHaveLength(1);
    const s = h.state();
    expect(restrained[0]).toBe(
      selectPriorityCandidate(s.priority!, s.tick!, s.startTick!, ['r1', 'r2']),
    );
    expect(h.player('t1').ownedEquipment[0]!.state).toBe('SPENT');
    // The other runner is free and the spent device never picks anyone again.
    const free = restrained[0] === 'r1' ? 'r2' : 'r1';
    expect(h.player(free).restraintUntilTick).toBeNull();
    expect(h.send(free, 'MOVE_INTENT', { direction: 'forward' })).toMatchObject({
      result: 'applied',
    });
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 0 });
  });

  it('a trap on the approach cell blocks the exit challenge until release; a turn is still allowed', () => {
    const placements: readonly Placement[] = [
      { playerId: 'r1', role: 'runner', cell: { x: 4, y: 3 }, dir: 1 },
      { playerId: 'r2', role: 'runner', cell: { x: 2, y: 8 }, dir: 0 },
      { playerId: 'r3', role: 'runner', cell: { x: 8, y: 8 }, dir: 0 },
      { playerId: 't1', role: 'tagger', cell: { x: 5, y: 4 }, dir: 0 },
      { playerId: 't2', role: 'tagger', cell: { x: 2, y: 9 }, dir: 0 },
      { playerId: 't3', role: 'tagger', cell: { x: 8, y: 9 }, dir: 0 },
    ];
    const h = createG3Harness({ placements });
    h.start();
    // The approach cell of exit-r1 is an ordinary floor cell to the tagger.
    h.walk('t1', 1);
    expect(h.player('t1').cell).toEqual({ x: 5, y: 3 });
    expect(h.send('t1', 'INSTALL', { kind: 'trap' })).toMatchObject({ result: 'applied' });
    h.ticks(INSTALL + ARM);
    expect(h.player('t1').ownedEquipment[0]).toMatchObject({ state: 'ARMED' });
    expect(h.state().exits.get('exit-r1')!.active).toBe(true);
    h.walk('t1', 1, 'back');
    expect(h.player('t1').cell).toEqual({ x: 5, y: 4 });
    // r1 steps onto its own approach and is restrained there.
    h.step('r1');
    const trappedAt = h.state().tick!;
    expect(h.player('r1').cell).toEqual({ x: 5, y: 3 });
    expect(h.player('r1').restraintUntilTick).toBe(trappedAt + RESTRAINT);
    // Turning to face the wall is allowed; the challenge is not, until the restraint ends.
    expect(h.send('r1', 'TURN', { direction: 'left' })).toMatchObject({ result: 'applied' });
    h.ticks(G3_TUNING.turnTicks);
    expect(h.player('r1').dir).toBe(0);
    expect(h.send('r1', 'EXIT_START', { exitId: 'exit-r1' })).toMatchObject({
      result: 'rejected',
      code: 'NOT_ALLOWED',
    });
    h.until(trappedAt + RESTRAINT);
    expect(h.player('r1').restraintUntilTick).toBeNull();
    expect(h.send('r1', 'EXIT_START', { exitId: 'exit-r1' })).toMatchObject({ result: 'applied' });
    expect(h.player('r1').challenge).toMatchObject({ challengeId: 'ch-1', exitId: 'exit-r1' });
    expect(h.frame().counts).toEqual({ escaped: 0, captured: 0 });
  });

  it('the seeded priority order is independent of roster order and rotates per tick', () => {
    const a = createPriorityOrder(['r1', 'r2', 'r3'], 7);
    const b = createPriorityOrder(['r3', 'r1', 'r2'], 7);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    const t0 = priorityForTick(a, 10, 10);
    const t1 = priorityForTick(a, 11, 10);
    const t3 = priorityForTick(a, 13, 10);
    expect(t0).toEqual(a);
    expect(t1[0]).toBe(a[1]);
    expect(t3).toEqual(t0);
    // Only candidates the caller left after ACTIVE/restraint/grace filters can be picked.
    expect(selectPriorityCandidate(a, 10, 10, [])).toBeUndefined();
    expect(selectPriorityCandidate(a, 10, 10, [a[2], a[2]])).toBe(a[2]);
    expect(selectPriorityCandidate(a, 10, 10, [a[1], a[2]])).toBe(a[1]);
    // Grace-only entrants filtered out by the caller: nobody is selected, nothing is consumed.
    const graceOnly = new Set<string>();
    expect(selectPriorityCandidate(a, 12, 10, graceOnly)).toBeUndefined();
  });

  it('the match state exposes the per-match priority order for the room', () => {
    const h = createG3Harness();
    expect(h.state().priority).toHaveLength(3);
    expect([...h.state().priority!].sort()).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('G3-C and other undecided items stay out of pass/fail', () => {
  it('no item command exists in the 0.2.0 envelope union and the pending list is recorded, not judged', () => {
    const itemLike = COMMAND_TYPES.filter((t) => /ITEM|PICKUP|USE_/.test(t));
    expect(itemLike).toEqual([]);
    expect(PRODUCT_DECISION_PENDING).toContain('G3-C');
    expect(PRODUCT_DECISION_PENDING).toContain('MP-06');
  });
});

describe('fixture order does not change the authoritative result', () => {
  it('reversed roster order and different command arrival order give the same frame', () => {
    const given = createG3Harness();
    const reversed = createG3Harness({ rosterOrder: 'reversed' });
    given.start();
    reversed.start();
    // Same commands, different arrival order within the tick.
    given.move('t1');
    given.turn('r2', 'right');
    given.move('t3');
    reversed.move('t3');
    reversed.turn('r2', 'right');
    reversed.move('t1');
    given.ticks(MOVE + 2);
    reversed.ticks(MOVE + 2);
    expect(frameDigest(reversed)).toEqual(frameDigest(given));
    expect(frameDigest(given).counts.captured).toBe(2);
  });

  it('placements are the fixture contract the digest depends on', () => {
    expect(DEFAULT_PLACEMENTS.filter((p) => p.role === 'runner')).toHaveLength(3);
    expect(DEFAULT_PLACEMENTS.filter((p) => p.role === 'tagger')).toHaveLength(3);
  });
});

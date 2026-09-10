// F-12 / QA-07 G3 regression on the real module composition: A `matchCore` stepped by B's
// MatchDriver/CommandQueue/MatchContext with six authenticated player ids and protocol 0.2.0
// command envelopes. Covers G3-A (personal end vs. connection loss ordering) on the rules that
// have reached develop, records the rules that have not (escape, trap) as tripwires, and keeps
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
  G3_BLOCKED_ON,
  G3_TUNING,
  PRODUCT_DECISION_PENDING,
  createG3Harness,
  frameDigest,
} from '../fixtures/g3-scenarios.ts';

const MOVE = G3_TUNING.moveTicks;

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

  it(`escape is not landed yet (${G3_BLOCKED_ON.escape}): EXIT_START is rejected INVALID_COMMAND`, () => {
    // Tripwire: when A-33 lands this test fails and the escape/close ordering cases get added.
    const h = createG3Harness();
    h.start();
    h.accept('r2', h.envelope('r2', 'EXIT_START', { exitId: 'exit-r2' }));
    h.tick();
    expect(h.lastOutcome('r2')).toMatchObject({ result: 'rejected', code: 'INVALID_COMMAND' });
    expect(h.frame().counts.escaped).toBe(0);
  });
});

describe('G3-B trap and priority', () => {
  it(`trap rules are not landed yet (${G3_BLOCKED_ON.trap}): INSTALL is rejected INVALID_COMMAND`, () => {
    const h = createG3Harness();
    h.start();
    h.accept('t1', h.envelope('t1', 'INSTALL', { kind: 'trap' }));
    h.tick();
    expect(h.lastOutcome('t1')).toMatchObject({ result: 'rejected', code: 'INVALID_COMMAND' });
    expect(h.player('t1').ownedEquipment).toEqual([]);
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

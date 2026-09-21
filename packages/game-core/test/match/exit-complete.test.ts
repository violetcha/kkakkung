import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/match/core-types.js';
import type { MatchState } from '../../src/match/engine.js';
import { getPlayerSelf } from '../../src/match/engine.js';
import { verifyProgress } from '../../src/match/exits/complete.js';
import { exitOfOwner } from '../../src/match/exits/registry.js';
import { command, player, startedMatch, step } from './match-fixture.js';

/** Places players on chosen cells/dirs without moving through the maze. */
function place(
  state: MatchState,
  placements: Record<string, { x: number; y: number; dir?: 0 | 1 | 2 | 3 }>,
): MatchState {
  const players = new Map(state.players);
  for (const [id, p] of Object.entries(placements)) {
    const record = player(state, id);
    players.set(id, {
      ...record,
      cell: { x: p.x, y: p.y },
      dir: p.dir ?? record.dir,
      action: null,
    });
  }
  return { ...state, players };
}

function idleUntil(state: MatchState, from: number, to: number): MatchState {
  let next = state;
  for (let tick = from; tick <= to; tick += 1) next = step(next, tick).state;
  return next;
}

function ended(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'EXIT_CHALLENGE_ENDED');
}

const APPROACH = { x: 11, y: 22 } as const;

/**
 * r-a runs a challenge on its own exit from tick 100: the 2 second minimum is
 * tick 140 and the 8 second deadline tick 260.
 */
function challengeFrom100(): MatchState {
  const posed = place(startedMatch(99), { 'r-a': { x: APPROACH.x, y: APPROACH.y, dir: 1 } });
  const exit = exitOfOwner(posed.exits, 'r-a')!;
  const start = step(posed, 100, [command('r-a', 'EXIT_START', { exitId: exit.exitId })]);
  expect(start.outcomes[0]).toMatchObject({ result: 'applied' });
  expect(player(start.state, 'r-a').challenge).toMatchObject({
    challengeId: 'ch-1',
    minSuccessTick: 140,
    expiresAtTick: 260,
  });
  return start.state;
}

describe('exit completion, duplicates and capture priority', () => {
  it('refuses a success reported before the 2 second minimum, then accepts it at the minimum', () => {
    const running = idleUntil(challengeFrom100(), 101, 138);
    const early = step(running, 139, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
    ]);
    expect(early.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-a', result: 'rejected', code: 'NOT_READY' }),
    ]);
    // Nothing about the attempt or the round changed.
    expect(player(early.state, 'r-a').status).toBe('ACTIVE');
    expect(player(early.state, 'r-a').challenge).toMatchObject({ challengeId: 'ch-1' });
    expect(early.state.counts).toEqual({ escaped: 0, captured: 0 });
    expect(ended(early.events)).toEqual([]);

    const success = step(early.state, 140, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
    ]);
    expect(success.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-a', result: 'applied', code: null }),
    ]);
    expect(player(success.state, 'r-a').status).toBe('ESCAPED');
    expect(success.state.counts).toEqual({ escaped: 1, captured: 0 });
    expect(getPlayerSelf(success.state, 'r-a')).toEqual({
      playerId: 'r-a',
      role: 'runner',
      status: 'ESCAPED',
    });
    // The challenge ends as escaped and the owner's exit closes once.
    expect(ended(success.events)).toEqual([
      expect.objectContaining({
        audience: ['r-a'],
        payload: { challengeId: 'ch-1', result: 'escaped', reason: null },
      }),
    ]);
    expect(exitOfOwner(success.state.exits, 'r-a')!.active).toBe(false);
    expect(success.mediaIntents).toEqual([
      { type: 'RETIRE_PLAYER', playerId: 'r-a', reason: 'personal-ended' },
    ]);
  });

  it('holds keys reports to exactly the same server constraints as pose', () => {
    const running = idleUntil(challengeFrom100(), 101, 138);
    const early = step(running, 139, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'keys', completed: true }),
    ]);
    expect(early.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_READY' });
    expect(early.state.counts).toEqual({ escaped: 0, captured: 0 });
    const success = step(early.state, 140, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'keys', completed: true }),
    ]);
    expect(success.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(success.state, 'r-a').status).toBe('ESCAPED');
  });

  it('treats a not-done report as a valid report that changes nothing', () => {
    const running = idleUntil(challengeFrom100(), 101, 139);
    const report = step(running, 140, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: false }),
    ]);
    expect(report.outcomes).toEqual([expect.objectContaining({ result: 'applied', code: null })]);
    expect(player(report.state, 'r-a').status).toBe('ACTIVE');
    expect(player(report.state, 'r-a').challenge).toMatchObject({ challengeId: 'ch-1' });
    expect(report.state.counts).toEqual({ escaped: 0, captured: 0 });
    expect(ended(report.events)).toEqual([]);
    // The attempt is still there and can succeed later.
    const later = step(report.state, 141, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
    ]);
    expect(later.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(later.state, 'r-a').status).toBe('ESCAPED');
  });

  it('lets a capture in the same tick win over the reported success', () => {
    // t-a stands next to the approach cell and walks in as the report arrives.
    const running = place(idleUntil(challengeFrom100(), 101, 129), {
      't-a': { x: 11, y: 21, dir: 2 },
    });
    const walking = step(running, 130, [
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const armed = step(idleUntil(walking, 131, 137), 138, [
      command('t-a', 'GRAB_INTENT', {}),
    ]).state;
    const contact = step(armed, 139);
    expect(player(contact.state, 't-a').cell).toEqual(APPROACH);
    expect(player(contact.state, 'r-a').status).toBe('CAPTURED');
    expect(contact.state.counts).toEqual({ escaped: 0, captured: 1 });

    // A completion report of that same tick is canceled, not applied.
    const late = step(armed, 139, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
    ]);
    expect(player(late.state, 'r-a').status).toBe('CAPTURED');
    expect(late.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-a', result: 'canceled', code: 'NOT_ACTIVE' }),
    ]);
    expect(late.state.counts).toEqual({ escaped: 0, captured: 1 });
    // The capture ended the challenge; no escape was recorded.
    expect(player(late.state, 'r-a').challenge).toBeNull();
    expect(ended(late.events)).toEqual([
      expect.objectContaining({
        payload: { challengeId: 'ch-1', result: 'canceled', reason: 'NOT_ACTIVE' },
      }),
    ]);
  });

  it('refuses a foreign id, a duplicate success and a report past the deadline', () => {
    const running = idleUntil(challengeFrom100(), 101, 139);
    const wrongId = step(running, 140, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-9', method: 'pose', completed: true }),
    ]);
    expect(wrongId.outcomes[0]).toMatchObject({ result: 'rejected', code: 'STALE_REQUEST' });
    expect(player(wrongId.state, 'r-a').status).toBe('ACTIVE');
    expect(wrongId.state.counts).toEqual({ escaped: 0, captured: 0 });

    // A first success ends the runner; a repeat of the same id changes nothing.
    const success = step(wrongId.state, 141, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
    ]).state;
    expect(success.counts).toEqual({ escaped: 1, captured: 0 });
    const duplicate = step(success, 142, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
    ]);
    expect(duplicate.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ACTIVE' });
    expect(duplicate.state.counts).toEqual({ escaped: 1, captured: 0 });
    expect(ended(duplicate.events)).toEqual([]);

    // A report at the deadline finds no challenge: the upkeep already failed it.
    const expiring = idleUntil(challengeFrom100(), 101, 259);
    expect(player(expiring, 'r-a').challenge).toMatchObject({ expiresAtTick: 260 });
    const late = step(expiring, 260, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
    ]);
    expect(late.outcomes[0]).toMatchObject({ result: 'rejected', code: 'STALE_REQUEST' });
    expect(player(late.state, 'r-a').status).toBe('ACTIVE');
    expect(late.state.counts).toEqual({ escaped: 0, captured: 0 });
    expect(ended(late.events)).toEqual([
      expect.objectContaining({
        payload: { challengeId: 'ch-1', result: 'failed', reason: 'EXPIRED' },
      }),
    ]);
  });

  it('refuses a malformed method or completed flag without touching the attempt', () => {
    const running = idleUntil(challengeFrom100(), 101, 139);
    const bad = step(running, 140, [
      command('r-a', 'EXIT_PROGRESS', {
        challengeId: 'ch-1',
        method: 'wave' as unknown as 'pose',
        completed: true,
      }),
      command('r-a', 'EXIT_PROGRESS', {
        challengeId: 'ch-1',
        method: 'pose',
        completed: 'yes' as unknown as boolean,
      }),
      command('r-a', 'EXIT_PROGRESS', { challengeId: '', method: 'pose', completed: true }),
    ]);
    expect(bad.outcomes.map((o) => o.code)).toEqual([
      'INVALID_COMMAND',
      'INVALID_COMMAND',
      'INVALID_COMMAND',
    ]);
    expect(player(bad.state, 'r-a').status).toBe('ACTIVE');
    expect(player(bad.state, 'r-a').challenge).toMatchObject({ challengeId: 'ch-1' });
    expect(bad.state.counts).toEqual({ escaped: 0, captured: 0 });
  });

  it('checks the pose position again at the report, not only at the start', () => {
    const running = idleUntil(challengeFrom100(), 101, 139);
    // Something moved the runner off the approach cell without ending the tick.
    const displaced = place(running, { 'r-a': { x: 10, y: 22, dir: 1 } });
    const verdict = verifyProgress(displaced, 'r-a', 'ch-1', 'pose', true, 140);
    expect(verdict).toEqual({ status: 'rejected', code: 'NOT_ALLOWED' });
    // Turned away from the wall, the report is refused just the same.
    const turned = place(running, { 'r-a': { x: APPROACH.x, y: APPROACH.y, dir: 3 } });
    expect(verifyProgress(turned, 'r-a', 'ch-1', 'pose', true, 140)).toEqual({
      status: 'rejected',
      code: 'NOT_ALLOWED',
    });
    // On the pose, the same call reports the escape verdict.
    expect(verifyProgress(running, 'r-a', 'ch-1', 'pose', true, 140)).toMatchObject({
      status: 'escaped',
    });
    // The minimum and the deadline are separate boundaries.
    expect(verifyProgress(running, 'r-a', 'ch-1', 'pose', true, 139)).toEqual({
      status: 'rejected',
      code: 'NOT_READY',
    });
    expect(verifyProgress(running, 'r-a', 'ch-1', 'pose', true, 260)).toEqual({
      status: 'rejected',
      code: 'EXPIRED',
    });
  });
});

import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/match/core-types.js';
import type { MatchState } from '../../src/match/engine.js';
import { getPlayerSelf } from '../../src/match/engine.js';
import { facesExit } from '../../src/match/exits/challenge.js';
import { closeExit, exitOfOwner } from '../../src/match/exits/registry.js';
import type { PlayerRecord } from '../../src/match/state.js';
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

function patch(state: MatchState, id: string, fields: Partial<PlayerRecord>): MatchState {
  const players = new Map(state.players);
  players.set(id, { ...player(state, id), ...fields } as PlayerRecord);
  return { ...state, players };
}

function idleUntil(state: MatchState, from: number, to: number): MatchState {
  let next = state;
  for (let tick = from; tick <= to; tick += 1) next = step(next, tick).state;
  return next;
}

function started(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'EXIT_CHALLENGE');
}

function ended(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'EXIT_CHALLENGE_ENDED');
}

const APPROACH = { x: 11, y: 22 } as const;

/** r-a stands on its own exit's approach cell (11,22) facing the wall (12,22). */
function atOwnExit(startTick = 100): MatchState {
  const state = place(startedMatch(startTick), {
    'r-a': { x: APPROACH.x, y: APPROACH.y, dir: 1 },
  });
  const exit = exitOfOwner(state.exits, 'r-a')!;
  expect(exit.approach).toEqual(APPROACH);
  expect(facesExit(player(state, 'r-a'), exit)).toBe(true);
  return state;
}

function exitId(state: MatchState, ownerId = 'r-a'): string {
  return exitOfOwner(state.exits, ownerId)!.exitId;
}

describe('exit challenge start, locks, cancel and deadline', () => {
  it('locks nothing until the command comes, then issues one challenge', () => {
    const arrived = atOwnExit();
    // Standing on the approach cell alone leaves the runner free.
    const idle = step(arrived, 101);
    expect(player(idle.state, 'r-a').challenge).toBeNull();
    expect(started(idle.events)).toEqual([]);
    const walking = step(idle.state, 102, [command('r-a', 'TURN', { direction: 'left' })]);
    expect(walking.outcomes[0]).toMatchObject({ result: 'applied' });

    // Back on the pose, the explicit command starts the attempt.
    const posed = place(idleUntil(walking.state, 103, 110), {
      'r-a': { x: APPROACH.x, y: APPROACH.y, dir: 1 },
    });
    const id = exitId(posed);
    const start = step(posed, 111, [command('r-a', 'EXIT_START', { exitId: id })]);
    expect(start.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-a', result: 'applied', code: null }),
    ]);
    const challenge = {
      challengeId: 'ch-1',
      exitId: id,
      poseKind: exitOfOwner(posed.exits, 'r-a')!.poseKind,
      startedAtTick: 111,
      // 2 second minimum, 8 second deadline.
      minSuccessTick: 151,
      expiresAtTick: 271,
    };
    expect(player(start.state, 'r-a').challenge).toEqual(challenge);
    expect(getPlayerSelf(start.state, 'r-a')).toMatchObject({ challenge });
    // One personal event to the owner only.
    expect(started(start.events)).toEqual([
      expect.objectContaining({ audience: ['r-a'], payload: challenge }),
    ]);

    // A second start while one runs changes nothing.
    const again = step(start.state, 112, [command('r-a', 'EXIT_START', { exitId: id })]);
    expect(again.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(player(again.state, 'r-a').challenge).toEqual(challenge);
    expect(started(again.events)).toEqual([]);
  });

  it('refuses another runner, a wrong pose, a closed exit and a restrained owner', () => {
    const state = atOwnExit();
    const mine = exitId(state);
    // r-b sharing the approach cell cannot use someone else's exit.
    const other = step(place(state, { 'r-b': { x: 11, y: 21, dir: 2 } }), 101, [
      command('r-b', 'EXIT_START', { exitId: mine }),
    ]);
    expect(other.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(player(other.state, 'r-b').challenge).toBeNull();

    // The owner facing the wrong way, or standing on the wrong cell, is refused.
    const turned = step(place(state, { 'r-a': { x: APPROACH.x, y: APPROACH.y, dir: 0 } }), 101, [
      command('r-a', 'EXIT_START', { exitId: mine }),
    ]);
    expect(turned.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    const away = step(place(state, { 'r-a': { x: 10, y: 22, dir: 1 } }), 101, [
      command('r-a', 'EXIT_START', { exitId: mine }),
    ]);
    expect(away.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });

    // A closed exit and an unknown id are both refused.
    const closed = { ...state, exits: closeExit(state.exits, 'r-a').registry };
    const shut = step(closed, 101, [command('r-a', 'EXIT_START', { exitId: mine })]);
    expect(shut.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    const unknown = step(state, 101, [command('r-a', 'EXIT_START', { exitId: 'exit-none' })]);
    expect(unknown.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });

    // A restrained owner cannot start, and neither can a moving one.
    const bound = step(patch(state, 'r-a', { restraintUntilTick: 140 }), 101, [
      command('r-a', 'EXIT_START', { exitId: mine }),
    ]);
    expect(bound.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    const moving = step(state, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]).state;
    expect(player(moving, 'r-a').action).not.toBeNull();
    const busy = step(moving, 102, [command('r-a', 'EXIT_START', { exitId: mine })]);
    expect(busy.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(player(busy.state, 'r-a').challenge).toBeNull();
  });

  it('locks moving, turning and map exchange while the challenge runs', () => {
    const state = atOwnExit();
    const id = exitId(state);
    const withPeer = place(state, { 'r-b': { x: 11, y: 21, dir: 2 } });
    const start = step(withPeer, 101, [command('r-a', 'EXIT_START', { exitId: id })]).state;
    const locked = step(start, 102, [
      command('r-a', 'MOVE_INTENT', { direction: 'back' }),
      command('r-a', 'TURN', { direction: 'left' }),
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]);
    expect(locked.outcomes.map((o) => [o.result, o.code])).toEqual([
      ['rejected', 'NOT_ALLOWED'],
      ['rejected', 'NOT_ALLOWED'],
      ['rejected', 'NOT_ALLOWED'],
    ]);
    // The pose is untouched and no intent waits behind the lock.
    const held = idleUntil(locked.state, 103, 115);
    expect(player(held, 'r-a')).toMatchObject({
      cell: APPROACH,
      dir: 1,
      action: null,
      heldMove: null,
      nextAction: null,
    });
    expect(player(held, 'r-a').challenge).toMatchObject({ challengeId: 'ch-1' });
    // The peer cannot pull the challenger into an exchange either.
    const fromPeer = step(held, 116, [
      command('r-b', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-a' }),
    ]);
    expect(fromPeer.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(fromPeer.state.exchanges.size).toBe(0);
  });

  it('cancels on the owner request and holds the retry gate for 10 ticks', () => {
    const state = atOwnExit();
    const id = exitId(state);
    const start = step(state, 101, [command('r-a', 'EXIT_START', { exitId: id })]).state;
    // Only the owner of that challengeId may cancel it.
    const stranger = step(place(start, { 'r-b': { x: 11, y: 21, dir: 2 } }), 102, [
      command('r-b', 'EXIT_CANCEL', { challengeId: 'ch-1' }),
    ]);
    expect(stranger.outcomes[0]).toMatchObject({ result: 'rejected', code: 'STALE_REQUEST' });
    expect(player(stranger.state, 'r-a').challenge).toMatchObject({ challengeId: 'ch-1' });

    const canceled = step(stranger.state, 103, [
      command('r-a', 'EXIT_CANCEL', { challengeId: 'ch-1' }),
    ]);
    expect(canceled.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-a', result: 'applied', code: null }),
    ]);
    expect(player(canceled.state, 'r-a').challenge).toBeNull();
    expect(player(canceled.state, 'r-a').nextAttemptTick).toBe(113);
    expect(ended(canceled.events)).toEqual([
      expect.objectContaining({
        audience: ['r-a'],
        payload: { challengeId: 'ch-1', result: 'canceled', reason: 'CANCELED' },
      }),
    ]);
    // Moving is free again right after the cancel.
    const moves = step(canceled.state, 104, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]);
    expect(moves.outcomes[0]).toMatchObject({ result: 'applied' });

    // A retry inside the gate is refused and changes nothing. The runner is
    // put back on the pose with no intent left over from the walk.
    const walked = step(moves.state, 105, [
      command('r-a', 'MOVE_INTENT', { direction: null }),
    ]).state;
    const posed = place(idleUntil(walked, 106, 111), {
      'r-a': { x: APPROACH.x, y: APPROACH.y, dir: 1 },
    });
    const early = step(posed, 112, [command('r-a', 'EXIT_START', { exitId: id })]);
    expect(early.outcomes).toEqual([
      expect.objectContaining({ result: 'rejected', code: 'NOT_ALLOWED' }),
    ]);
    expect(player(early.state, 'r-a').challenge).toBeNull();
    expect(started(early.events)).toEqual([]);
    // At the gate tick a fresh request applies, with the same poseKind.
    const retry = step(early.state, 113, [command('r-a', 'EXIT_START', { exitId: id })]);
    expect(retry.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(retry.state, 'r-a').challenge).toMatchObject({
      challengeId: 'ch-2',
      poseKind: exitOfOwner(state.exits, 'r-a')!.poseKind,
      startedAtTick: 113,
    });
    // A second cancel of the finished id is stale and does not move the gate.
    const stale = step(retry.state, 114, [command('r-a', 'EXIT_CANCEL', { challengeId: 'ch-1' })]);
    expect(stale.outcomes[0]).toMatchObject({ result: 'rejected', code: 'STALE_REQUEST' });
    expect(player(stale.state, 'r-a').challenge).toMatchObject({ challengeId: 'ch-2' });
  });

  it('fails at the 8 second deadline and keeps the exit poseKind for the retry', () => {
    const state = atOwnExit();
    const id = exitId(state);
    const poseKind = exitOfOwner(state.exits, 'r-a')!.poseKind;
    const start = step(state, 101, [command('r-a', 'EXIT_START', { exitId: id })]).state;
    expect(player(start, 'r-a').challenge).toMatchObject({ expiresAtTick: 261 });
    const alive = idleUntil(start, 102, 260);
    expect(player(alive, 'r-a').challenge).toMatchObject({ challengeId: 'ch-1' });

    const expired = step(alive, 261);
    expect(player(expired.state, 'r-a').challenge).toBeNull();
    expect(player(expired.state, 'r-a').nextAttemptTick).toBe(271);
    expect(ended(expired.events)).toEqual([
      expect.objectContaining({
        audience: ['r-a'],
        payload: { challengeId: 'ch-1', result: 'failed', reason: 'EXPIRED' },
      }),
    ]);
    // The automatic end makes no outcome for the request that already applied.
    expect(expired.outcomes).toEqual([]);
    // The registry keeps the pose: only the attempt progress is reset.
    expect(exitOfOwner(expired.state.exits, 'r-a')).toMatchObject({ poseKind, active: true });
    const retry = step(idleUntil(expired.state, 262, 270), 271, [
      command('r-a', 'EXIT_START', { exitId: id }),
    ]);
    expect(retry.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(retry.state, 'r-a').challenge).toMatchObject({ challengeId: 'ch-2', poseKind });
    // No second end event for the challenge that already expired.
    expect(ended(retry.events)).toEqual([]);
  });

  it('ends the challenge when the pose, the exit or the runner is gone', () => {
    const state = atOwnExit();
    const id = exitId(state);
    const start = step(state, 101, [command('r-a', 'EXIT_START', { exitId: id })]).state;

    // Being moved off the approach cell by anything else ends the attempt.
    const displaced = step(place(start, { 'r-a': { x: 10, y: 22, dir: 1 } }), 102);
    expect(player(displaced.state, 'r-a').challenge).toBeNull();
    expect(player(displaced.state, 'r-a').nextAttemptTick).toBe(112);
    expect(ended(displaced.events)).toEqual([
      expect.objectContaining({
        payload: { challengeId: 'ch-1', result: 'canceled', reason: 'NOT_ALLOWED' },
      }),
    ]);

    // A restraint that starts during the attempt ends it too.
    const bound = step(patch(start, 'r-a', { restraintUntilTick: 140 }), 102);
    expect(player(bound.state, 'r-a').challenge).toBeNull();
    expect(ended(bound.events)).toEqual([
      expect.objectContaining({
        payload: { challengeId: 'ch-1', result: 'canceled', reason: 'NOT_ALLOWED' },
      }),
    ]);

    // So does closing the exit itself.
    const shut = step({ ...start, exits: closeExit(start.exits, 'r-a').registry }, 102);
    expect(player(shut.state, 'r-a').challenge).toBeNull();
    expect(ended(shut.events)).toHaveLength(1);
  });
});

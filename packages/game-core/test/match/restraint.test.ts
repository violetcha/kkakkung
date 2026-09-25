import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/match/core-types.js';
import type { MatchState } from '../../src/match/engine.js';
import { getPlayerSelf } from '../../src/match/engine.js';
import {
  expireRestraints,
  isRestrained,
  lockRestrainedActions,
  restraintRemaining,
} from '../../src/match/equipment/restraint.js';
import { trapCandidates } from '../../src/match/equipment/trap-candidates.js';
import type { CompletedMove } from '../../src/match/movement.js';
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

function challengeEnded(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'EXIT_CHALLENGE_ENDED');
}

const CELL = { x: 10, y: 2 } as const;

/** A runner restrained from tick 10 to 40, standing on the open row y=2. */
function restrainedAt10(): MatchState {
  const base = place(startedMatch(1), {
    'r-a': { x: CELL.x, y: CELL.y, dir: 1 },
    'r-b': { x: 11, y: 2, dir: 3 },
  });
  return patch(idleUntil(base, 2, 9), 'r-a', { restraintUntilTick: 40 });
}

describe('restraint duration, action locks and re-restraint immunity', () => {
  it('releases at the end tick and grants immunity for the next 40 ticks', () => {
    const state = idleUntil(restrainedAt10(), 10, 39);
    expect(player(state, 'r-a').restraintUntilTick).toBe(40);
    expect(isRestrained(player(state, 'r-a'), 39)).toBe(true);
    expect(restraintRemaining(player(state, 'r-a'), 39)).toBe(1);

    const released = step(state, 40).state;
    expect(player(released, 'r-a').restraintUntilTick).toBeNull();
    // The immunity starts at the restraint's own end tick, not at the release tick.
    expect(player(released, 'r-a').restraintImmuneUntilTick).toBe(80);
    expect(getPlayerSelf(released, 'r-a')).toMatchObject({
      restraintUntilTick: null,
      restraintImmuneUntilTick: 80,
    });
    expect(restraintRemaining(player(released, 'r-a'), 40)).toBe(0);

    // Moving is possible again on that very tick.
    const moving = step(released, 41, [command('r-a', 'MOVE_INTENT', { direction: 'forward' })]);
    expect(moving.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(moving.state, 'r-a').action).not.toBeNull();
  });

  it('never extends the immunity by processing the same expiry again', () => {
    const released = step(idleUntil(restrainedAt10(), 10, 39), 40).state;
    expect(player(released, 'r-a').restraintImmuneUntilTick).toBe(80);
    // Later ticks find no restraint left, so the window stays where it was.
    const later = idleUntil(released, 41, 79);
    expect(player(later, 'r-a').restraintImmuneUntilTick).toBe(80);
    expect(expireRestraints(later, 79).released).toEqual([]);
    expect(expireRestraints(later, 79).state).toBe(later);
    const after = idleUntil(later, 80, 85);
    expect(player(after, 'r-a').restraintImmuneUntilTick).toBe(80);
    // An immunity that already reaches further is not shortened by a new expiry.
    const longer = patch(restrainedAt10(), 'r-a', { restraintImmuneUntilTick: 200 });
    expect(expireRestraints(longer, 40).released[0]!.immuneUntilTick).toBe(200);
  });

  it('makes the runner immune to a new trap until the window closes', () => {
    const released = step(idleUntil(restrainedAt10(), 10, 39), 40).state;
    const entered: CompletedMove[] = [{ playerId: 'r-a', from: { x: 9, y: 2 }, to: CELL }];
    // A device on that cell would find no candidate while the immunity lasts.
    const armed = patch(released, 't-a', {
      ownedEquipment: Object.freeze([
        Object.freeze({
          equipmentId: 'eq-x',
          state: 'ARMED' as const,
          armedTick: 10,
          kind: 'trap' as const,
          cell: CELL,
        }),
      ]),
    });
    expect(trapCandidates(armed, entered, 79)).toEqual([]);
    // At tick 80 the immunity is over and a new entry counts again.
    expect(trapCandidates(armed, entered, 80)).toHaveLength(1);
  });

  it('rejects a new move but allows a turn while restrained', () => {
    const state = idleUntil(restrainedAt10(), 10, 12);
    const result = step(state, 13, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('r-a', 'TURN', { direction: 'left' }),
    ]);
    expect(result.outcomes.map((o) => [o.result, o.code])).toEqual([
      ['rejected', 'NOT_ALLOWED'],
      ['applied', null],
    ]);
    // The turn really runs and changes the facing.
    const turned = idleUntil(result.state, 14, 19);
    expect(player(turned, 'r-a').dir).toBe(0);
    // The refused move left no held intent that could resume on release.
    expect(player(turned, 'r-a').heldMove).toBeNull();
    expect(player(turned, 'r-a').cell).toEqual(CELL);
  });

  it('does not roll back a cell that was already committed', () => {
    // r-a walks from (9,2) to (10,2); the restraint starts while it stands there.
    const walking = step(place(startedMatch(1), { 'r-a': { x: 9, y: 2, dir: 1 } }), 10, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    // The held intent is released before arrival so the runner stops on (10,2).
    const stopping = step(walking, 15, [command('r-a', 'MOVE_INTENT', { direction: null })]).state;
    const arrived = idleUntil(stopping, 16, 19);
    expect(player(arrived, 'r-a').cell).toEqual(CELL);
    const bound = patch(arrived, 'r-a', { restraintUntilTick: 50 });
    const held = idleUntil(bound, 20, 30);
    // The committed cell stays, and the held intent cannot resume until release.
    expect(player(held, 'r-a').cell).toEqual(CELL);
    expect(player(held, 'r-a').action).toBeNull();
  });

  it('ends a running exchange when the trap restrains its target', () => {
    // An armed trap on (5,4) with the installer moved away.
    const installed = step(place(startedMatch(1), { 't-a': { x: 5, y: 4, dir: 1 } }), 10, [
      command('t-a', 'INSTALL', { kind: 'trap' }),
    ]).state;
    const ready = place(idleUntil(installed, 11, 20), {
      't-a': { x: 8, y: 16, dir: 0 },
      'r-a': { x: 4, y: 4, dir: 1 },
      'r-b': { x: 4, y: 5, dir: 0 },
    });
    const armed = idleUntil(ready, 21, 40);
    // r-a and r-b open an exchange, then r-a steps onto the trap.
    const opened = step(armed, 41, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]).state;
    expect(opened.exchanges.size).toBe(1);
    const walking = step(opened, 42, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const fired = step(idleUntil(walking, 43, 50), 51);
    expect(player(fired.state, 'r-a').restraintUntilTick).toBe(111);
    // No challenge existed, so no personal challenge event is produced.
    expect(challengeEnded(fired.events)).toEqual([]);
    // The exchange session is gone and both slots are clear.
    expect(fired.state.exchanges.size).toBe(0);
    expect(player(fired.state, 'r-a').exchange).toBeNull();
    expect(player(fired.state, 'r-b').exchange).toBeNull();

    // New requests stay refused while the restraint lasts.
    const refused = step(fired.state, 52, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
      command('r-b', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-a' }),
    ]);
    expect(refused.outcomes.map((o) => o.code)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
    expect(refused.state.exchanges.size).toBe(0);
  });

  it('ends the exit challenge of a player the restraint locks', () => {
    // A challenging runner cannot walk onto a device, so this lock is the
    // defensive half of EQ-05: applied wherever a restraint starts.
    const bound = patch(restrainedAt10(), 'r-a', {
      challenge: {
        challengeId: 'ch-1',
        exitId: 'exit-1',
        poseKind: 'left',
        startedAtTick: 5,
        minSuccessTick: 45,
        expiresAtTick: 165,
      },
    });
    const locked = lockRestrainedActions(bound, 'r-a');
    expect(locked.endedChallenge).toMatchObject({ challengeId: 'ch-1' });
    expect(player(locked.state, 'r-a').challenge).toBeNull();
    // Idempotent: a player without a challenge is left untouched.
    const again = lockRestrainedActions(locked.state, 'r-a');
    expect(again.endedChallenge).toBeNull();
    expect(again.state).toBe(locked.state);
  });

  it('captures a restrained runner: neither restraint nor immunity blocks it', () => {
    const bound = idleUntil(restrainedAt10(), 10, 12);
    // t-a arrives on the restrained runner's cell from the east.
    const withTagger = place(bound, { 't-a': { x: 11, y: 2, dir: 3 }, 'r-b': { x: 20, y: 2 } });
    const walking = step(withTagger, 13, [
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const armed = step(idleUntil(walking, 14, 20), 21, [command('t-a', 'GRAB_INTENT', {})]).state;
    const contact = step(armed, 22);
    expect(player(contact.state, 't-a').cell).toEqual(CELL);
    expect(player(contact.state, 'r-a').status).toBe('CAPTURED');

    // The same holds inside the immunity window after a natural release.
    const released = step(idleUntil(restrainedAt10(), 10, 39), 40).state;
    expect(player(released, 'r-a').restraintImmuneUntilTick).toBe(80);
    const immune = place(released, { 't-a': { x: 11, y: 2, dir: 3 }, 'r-b': { x: 20, y: 2 } });
    const chasing = step(immune, 41, [
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const armedAgain = step(idleUntil(chasing, 42, 48), 49, [
      command('t-a', 'GRAB_INTENT', {}),
    ]).state;
    const caught = step(armedAgain, 50);
    expect(player(caught.state, 'r-a').status).toBe('CAPTURED');
  });
});

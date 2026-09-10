import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/match/core-types.js';
import type { MatchState } from '../../src/match/engine.js';
import { getPlayerSelf } from '../../src/match/engine.js';
import { activateTraps } from '../../src/match/equipment/trap-activate.js';
import type { CompletedMove } from '../../src/match/movement.js';
import { priorityForTick } from '../../src/match/priority.js';
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

function markers(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'HUNTER_MARKER');
}

function trapSounds(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'SPATIAL_SOUND' && e.sound.kind === 'trap');
}

function trapOf(state: MatchState, ownerId = 't-a') {
  return player(state, ownerId).ownedEquipment[0]!;
}

const TRAP_CELL = { x: 5, y: 4 } as const;

function entry(playerId: string, from: { x: number; y: number }): CompletedMove {
  return { playerId, from, to: { x: TRAP_CELL.x, y: TRAP_CELL.y } };
}

/**
 * An ARMED trap on (5,4) owned by t-a, who then leaves the cell. r-a waits on
 * (4,4) to the west and r-b on (5,3) to the north, both one step away.
 */
function armedTrapWithRunners(): MatchState {
  const installed = step(place(startedMatch(1), { 't-a': { x: 5, y: 4, dir: 1 } }), 10, [
    command('t-a', 'INSTALL', { kind: 'trap' }),
  ]).state;
  const ready = place(idleUntil(installed, 11, 20), {
    't-a': { x: 8, y: 16, dir: 0 },
    'r-a': { x: 4, y: 4, dir: 1 },
    'r-b': { x: 5, y: 3, dir: 2 },
  });
  const armed = idleUntil(ready, 21, 40);
  expect(trapOf(armed).state).toBe('ARMED');
  return armed;
}

/** The runner the common tick order picks out of `candidates` at `tick`. */
function priorityPick(state: MatchState, tick: number, candidates: readonly string[]): string {
  const order = priorityForTick(state.priority!, tick, state.startTick!);
  const picked = order.find((id) => candidates.includes(id));
  if (!picked) throw new Error('no candidate in the tick order');
  return picked;
}

describe('restraint trap target selection and single shot', () => {
  it('restrains exactly one of two simultaneous entries and spends the device once', () => {
    const armed = armedTrapWithRunners();
    const walking = step(armed, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('r-b', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const fired = step(idleUntil(walking, 42, 49), 50);
    expect(player(fired.state, 'r-a').cell).toEqual(TRAP_CELL);
    expect(player(fired.state, 'r-b').cell).toEqual(TRAP_CELL);

    const chosen = priorityPick(armed, 50, ['r-a', 'r-b']);
    const other = chosen === 'r-a' ? 'r-b' : 'r-a';
    // 30 ticks of restraint on the priority winner only.
    expect(player(fired.state, chosen).restraintUntilTick).toBe(80);
    expect(player(fired.state, other).restraintUntilTick).toBeNull();
    expect(trapOf(fired.state).state).toBe('SPENT');
    expect(markers(fired.events)).toHaveLength(1);
    expect(trapSounds(fired.events)).toHaveLength(1);

    // The target hears about its own restraint through the self projection.
    expect(getPlayerSelf(fired.state, chosen)).toMatchObject({ restraintUntilTick: 80 });
    // The device stays spent and nobody else is restrained afterwards.
    const later = idleUntil(fired.state, 51, 60);
    expect(trapOf(later).state).toBe('SPENT');
    expect(player(later, other).restraintUntilTick).toBeNull();
  });

  it('picks the eligible runner even when an immune one would win the order', () => {
    const armed = armedTrapWithRunners();
    // Make the priority winner immune, so only the other one is a candidate.
    const winner = priorityPick(armed, 50, ['r-a', 'r-b']);
    const other = winner === 'r-a' ? 'r-b' : 'r-a';
    const immune = patch(armed, winner, { restraintImmuneUntilTick: 90 });
    const walking = step(immune, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('r-b', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const fired = step(idleUntil(walking, 42, 49), 50);
    // The filter runs before the choice: the immune runner does not consume the shot.
    expect(player(fired.state, other).restraintUntilTick).toBe(80);
    expect(player(fired.state, winner).restraintUntilTick).toBeNull();
    expect(trapOf(fired.state).state).toBe('SPENT');
    expect(markers(fired.events)).toHaveLength(1);
  });

  it('sends one anonymous marker and one separate sound, then nothing more', () => {
    const armed = armedTrapWithRunners();
    const walking = step(armed, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const fired = step(idleUntil(walking, 42, 49), 50);

    const marker = markers(fired.events)[0];
    if (!marker || marker.type !== 'HUNTER_MARKER') throw new Error('expected a marker');
    expect(marker.payload).toEqual({
      markerId: 'mk-eq-1',
      kind: 'trap',
      point: { x: 5, y: 4 },
      occurredTick: 50,
      showAtTick: 50,
      expiresTick: 90,
    });
    expect([...marker.audience].sort()).toEqual(['t-a', 't-b', 't-c']);
    // The restrained runner is never named in the tagger event.
    expect(JSON.stringify(marker.payload)).not.toContain('r-a');

    const sound = trapSounds(fired.events)[0];
    if (!sound || sound.type !== 'SPATIAL_SOUND') throw new Error('expected a sound');
    expect(sound.sound).toEqual({
      eventId: sound.sound.eventId,
      tick: 50,
      kind: 'trap',
      cell: { x: 5, y: 4 },
    });
    expect(sound.sound.sourcePlayerId).toBeUndefined();
    expect(sound.sound.eventId).not.toBe(marker.eventId);

    let after = fired.state;
    for (const tick of [51, 52, 90, 91]) {
      const result = step(after, tick);
      expect(markers(result.events)).toEqual([]);
      expect(trapSounds(result.events)).toEqual([]);
      after = result.state;
    }
  });

  it('does not come back after the restraint ends or the target leaves the match', () => {
    const armed = armedTrapWithRunners();
    const walking = step(armed, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const fired = step(idleUntil(walking, 42, 49), 50);
    expect(trapOf(fired.state).state).toBe('SPENT');

    // Personal end of the restrained runner leaves the device spent.
    const ended = patch(fired.state, 'r-a', { status: 'CAPTURED', restraintUntilTick: null });
    const afterEnd = idleUntil(ended, 51, 85);
    expect(trapOf(afterEnd).state).toBe('SPENT');

    // A second runner walking onto the same cell is not restrained.
    const second = place(afterEnd, { 'r-b': { x: 4, y: 4, dir: 1 } });
    const walkingAgain = step(second, 86, [
      command('r-b', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const result = step(idleUntil(walkingAgain, 87, 94), 95);
    expect(player(result.state, 'r-b').cell).toEqual(TRAP_CELL);
    expect(player(result.state, 'r-b').restraintUntilTick).toBeNull();
    expect(markers(result.events)).toEqual([]);
    expect(trapSounds(result.events)).toEqual([]);
  });

  it('keeps the device when no candidate remains and never depends on entry order', () => {
    const armed = armedTrapWithRunners();
    // Both entrants are immune: the trap is not spent at all.
    const allImmune = patch(patch(armed, 'r-a', { restraintImmuneUntilTick: 90 }), 'r-b', {
      restraintImmuneUntilTick: 90,
    });
    const walking = step(allImmune, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('r-b', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const quiet = step(idleUntil(walking, 42, 49), 50);
    expect(trapOf(quiet.state).state).toBe('ARMED');
    expect(markers(quiet.events)).toEqual([]);
    expect(trapSounds(quiet.events)).toEqual([]);

    // The same two entries in either order select the same target.
    const onTrap = place(armed, { 'r-a': TRAP_CELL, 'r-b': TRAP_CELL });
    const moves = [entry('r-a', { x: 4, y: 4 }), entry('r-b', { x: 5, y: 3 })];
    const first = activateTraps(onTrap, moves, 50);
    const reversed = activateTraps(onTrap, [...moves].reverse(), 50);
    expect(first.activations.map((a) => a.targetId)).toEqual(
      reversed.activations.map((a) => a.targetId),
    );
    expect(first.activations[0]!.targetId).toBe(priorityPick(armed, 50, ['r-a', 'r-b']));
    expect(first.activations[0]).toMatchObject({
      equipmentId: 'eq-1',
      ownerId: 't-a',
      cell: TRAP_CELL,
      restrainedUntilTick: 80,
    });
  });

  it('commits the spent device and the restraint in the same state', () => {
    const armed = place(armedTrapWithRunners(), { 'r-a': TRAP_CELL });
    const result = activateTraps(armed, [entry('r-a', { x: 4, y: 4 })], 50);
    expect(result.state).not.toBe(armed);
    // One state carries both halves; the source state is untouched.
    expect(player(result.state, 't-a').ownedEquipment[0]!.state).toBe('SPENT');
    expect(player(result.state, 'r-a').restraintUntilTick).toBe(80);
    expect(player(armed, 't-a').ownedEquipment[0]!.state).toBe('ARMED');
    expect(player(armed, 'r-a').restraintUntilTick).toBeNull();
    // A spent device picks nobody again, whatever moves arrive.
    const again = activateTraps(result.state, [entry('r-b', { x: 5, y: 3 })], 51);
    expect(again.activations).toEqual([]);
    expect(again.state).toBe(result.state);
  });
});

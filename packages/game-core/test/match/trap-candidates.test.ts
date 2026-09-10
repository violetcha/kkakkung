import { describe, expect, it } from 'vitest';

import type { MatchState } from '../../src/match/engine.js';
import { isRestraintEligible, trapCandidates } from '../../src/match/equipment/trap-candidates.js';
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

const TRAP_CELL = { x: 5, y: 4 } as const;

/** One completed move onto the trap cell, coming from the west. */
function entry(playerId: string): CompletedMove {
  return { playerId, from: { x: 4, y: 4 }, to: { x: 5, y: 4 } };
}

/** A completed move that never left its cell: turns and blocked steps look like this. */
function stayed(playerId: string): CompletedMove {
  return { playerId, from: TRAP_CELL, to: TRAP_CELL };
}

function trapOf(state: MatchState, ownerId = 't-a') {
  return player(state, ownerId).ownedEquipment[0]!;
}

/**
 * An ARMED trap on (5,4): t-a installs at tick 10, it completes at 20 and arms
 * at 40, then the installer is moved off the cell.
 */
function armedTrap(): MatchState {
  const installed = step(place(startedMatch(1), { 't-a': { x: 5, y: 4, dir: 1 } }), 10, [
    command('t-a', 'INSTALL', { kind: 'trap' }),
  ]).state;
  const armed = idleUntil(installed, 11, 40);
  expect(trapOf(armed).state).toBe('ARMED');
  return place(armed, { 't-a': { x: 8, y: 16, dir: 0 } });
}

describe('restraint trap entry candidates', () => {
  it('collects an ACTIVE runner that newly entered an armed trap cell', () => {
    const state = place(armedTrap(), { 'r-a': TRAP_CELL });
    const found = trapCandidates(state, [entry('r-a')], 50);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ equipmentId: 'eq-1', ownerId: 't-a', cell: TRAP_CELL });
    expect([...found[0]!.candidateIds]).toEqual(['r-a']);
    // Collecting candidates never touches the device.
    expect(trapOf(state).state).toBe('ARMED');
  });

  it('excludes a runner inside its immunity window and includes it on the end tick', () => {
    const base = place(armedTrap(), { 'r-a': TRAP_CELL });
    const immune = patch(base, 'r-a', { restraintImmuneUntilTick: 50 });
    // T49 with immunity until 50: no candidate, the trap stays armed.
    expect(trapCandidates(immune, [entry('r-a')], 49)).toEqual([]);
    expect(trapOf(immune).state).toBe('ARMED');
    // T50 is the tick the immunity has been refreshed away: a new entry counts.
    const atEnd = trapCandidates(immune, [entry('r-a')], 50);
    expect(atEnd).toHaveLength(1);
    expect([...atEnd[0]!.candidateIds]).toEqual(['r-a']);
  });

  it('does not treat standing still through the immunity end as an entry', () => {
    const standing = patch(place(armedTrap(), { 'r-a': TRAP_CELL }), 'r-a', {
      restraintImmuneUntilTick: 50,
    });
    // No move at all, and a move that did not change cell, are both no entry.
    expect(trapCandidates(standing, [], 50)).toEqual([]);
    expect(trapCandidates(standing, [stayed('r-a')], 50)).toEqual([]);
    expect(trapOf(standing).state).toBe('ARMED');
  });

  it('excludes a runner that is still restrained', () => {
    const restrained = patch(place(armedTrap(), { 'r-a': TRAP_CELL }), 'r-a', {
      restraintUntilTick: 60,
    });
    expect(trapCandidates(restrained, [entry('r-a')], 50)).toEqual([]);
    // The tick the restraint ends, the runner is eligible again.
    expect(trapCandidates(restrained, [entry('r-a')], 60)).toHaveLength(1);
  });

  it('keeps no permanent exemption for the runner that stood there while it armed', () => {
    // The device is placed first, then r-a occupies the cell through the arming.
    // The installer leaves first: sharing a cell with a tagger is a capture.
    const placed = step(place(startedMatch(1), { 't-a': { x: 5, y: 4, dir: 1 } }), 10, [
      command('t-a', 'INSTALL', { kind: 'trap' }),
    ]).state;
    const occupied = place(idleUntil(placed, 11, 20), {
      't-a': { x: 8, y: 16, dir: 0 },
      'r-a': TRAP_CELL,
    });
    const armed = idleUntil(occupied, 21, 40);
    expect(trapOf(armed).state).toBe('ARMED');
    expect(player(armed, 'r-a')).toMatchObject({ status: 'ACTIVE', cell: TRAP_CELL });
    // Standing there is still not an entry.
    expect(trapCandidates(armed, [stayed('r-a')], 41)).toEqual([]);
    // Leaving and coming back is re-checked on the current state, so it counts.
    const returned = trapCandidates(armed, [entry('r-a')], 60);
    expect([...returned[0]!.candidateIds]).toEqual(['r-a']);
    // Unless that runner is restrained at the moment of the new entry.
    const bound = patch(armed, 'r-a', { restraintUntilTick: 70 });
    expect(trapCandidates(bound, [entry('r-a')], 60)).toEqual([]);
  });

  it('ignores unarmed and spent devices, taggers, and ended runners', () => {
    const unarmed = step(place(startedMatch(1), { 't-a': { x: 5, y: 4, dir: 1 } }), 10, [
      command('t-a', 'INSTALL', { kind: 'trap' }),
    ]).state;
    const complete = place(idleUntil(unarmed, 11, 20), { 't-a': { x: 8, y: 16, dir: 0 } });
    expect(trapOf(complete).state).toBe('UNARMED');
    expect(trapCandidates(complete, [entry('r-a')], 21)).toEqual([]);

    const armed = armedTrap();
    // A tagger walking in is no candidate.
    expect(trapCandidates(armed, [entry('t-b')], 50)).toEqual([]);
    // Neither is a runner whose personal result was already fixed.
    const ended = patch(armed, 'r-a', { status: 'CAPTURED' });
    expect(trapCandidates(ended, [entry('r-a')], 50)).toEqual([]);
  });

  it('returns every eligible runner of one tick as an unordered set', () => {
    const both = place(armedTrap(), { 'r-a': TRAP_CELL, 'r-b': TRAP_CELL });
    const found = trapCandidates(
      both,
      [entry('r-b'), { playerId: 'r-a', from: { x: 5, y: 5 }, to: TRAP_CELL }],
      50,
    );
    expect(found).toHaveLength(1);
    expect([...found[0]!.candidateIds].sort()).toEqual(['r-a', 'r-b']);
    // A mixed tick keeps only the eligible one.
    const mixed = patch(both, 'r-b', { restraintImmuneUntilTick: 60 });
    const filtered = trapCandidates(mixed, [entry('r-a'), entry('r-b')], 50);
    expect([...filtered[0]!.candidateIds]).toEqual(['r-a']);
  });

  it('applies the same end-tick boundary to both timers', () => {
    const base = place(armedTrap(), { 'r-a': TRAP_CELL });
    const free = player(base, 'r-a');
    expect(isRestraintEligible(free, 0)).toBe(true);
    expect(isRestraintEligible({ ...free, restraintUntilTick: 50 }, 49)).toBe(false);
    expect(isRestraintEligible({ ...free, restraintUntilTick: 50 }, 50)).toBe(true);
    expect(isRestraintEligible({ ...free, restraintImmuneUntilTick: 50 }, 49)).toBe(false);
    expect(isRestraintEligible({ ...free, restraintImmuneUntilTick: 50 }, 50)).toBe(true);
  });
});

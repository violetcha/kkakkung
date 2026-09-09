import { describe, expect, it } from 'vitest';

import { detectCaptures } from '../../src/match/capture.js';
import type { MatchState } from '../../src/match/engine.js';
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

describe('contact and crossing capture', () => {
  it('captures when a tagger and a runner swap cells in the same tick', () => {
    // Open row y=2: runner at (10,2) facing east, tagger at (11,2) facing west.
    const base = place(startedMatch(100), {
      'r-a': { x: 10, y: 2, dir: 1 },
      't-a': { x: 11, y: 2, dir: 3 },
    });
    let result = step(base, 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]);
    let state = result.state;
    for (let tick = 102; tick <= 109; tick += 1) state = step(state, tick).state;
    result = step(state, 110);
    expect(player(result.state, 'r-a').status).toBe('CAPTURED');
    expect(player(result.state, 't-a').cell).toEqual({ x: 10, y: 2 });
    expect(result.state.counts).toEqual({ escaped: 0, captured: 1 });
    expect(result.mediaIntents).toEqual([
      { type: 'RETIRE_PLAYER', playerId: 'r-a', reason: 'personal-ended' },
    ]);
  });

  it('does not capture diagonal or orthogonally adjacent completions', () => {
    const base = place(startedMatch(100), {
      'r-a': { x: 10, y: 2, dir: 1 },
      't-a': { x: 12, y: 3, dir: 3 },
    });
    // Runner ends at (11,2); tagger ends at (11,3): adjacent, not the same cell.
    let state = step(base, 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    for (let tick = 102; tick <= 110; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a')).toMatchObject({ status: 'ACTIVE', cell: { x: 11, y: 2 } });
    expect(player(state, 't-a').cell).toEqual({ x: 11, y: 3 });
    // Diagonal: runner (10,2), tagger (11,3) -> no capture.
    const diagonal = place(startedMatch(100), { 'r-a': { x: 10, y: 2 }, 't-a': { x: 11, y: 3 } });
    expect(detectCaptures(diagonal.players, diagonal.players)).toEqual([]);
  });

  it('captures once when two taggers reach the same runner cell, independent of iteration order', () => {
    const base = place(startedMatch(100), {
      'r-a': { x: 10, y: 2, dir: 0 },
      't-a': { x: 9, y: 2, dir: 1 },
      't-b': { x: 11, y: 2, dir: 3 },
    });
    let state = step(base, 101, [
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('t-b', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    for (let tick = 102; tick <= 109; tick += 1) state = step(state, tick).state;
    const result = step(state, 110);
    expect(player(result.state, 'r-a').status).toBe('CAPTURED');
    expect(result.state.counts.captured).toBe(1);
    expect(result.mediaIntents.filter((m) => m.type === 'RETIRE_PLAYER')).toHaveLength(1);
    // Reversed map order yields the same detection.
    const reversed = new Map([...result.state.players.entries()].reverse());
    expect(detectCaptures(state.players, result.state.players)).toEqual(
      detectCaptures(state.players, reversed),
    );
  });

  it('never captures teammates or through walls', () => {
    // Two taggers on one cell: no capture; runner and tagger separated by wall column x=6.
    const teammates = place(startedMatch(100), { 't-a': { x: 10, y: 2 }, 't-b': { x: 10, y: 2 } });
    expect(detectCaptures(teammates.players, teammates.players)).toEqual([]);
    const wall = place(startedMatch(100), { 'r-a': { x: 5, y: 10 }, 't-a': { x: 7, y: 10 } });
    expect(detectCaptures(wall.players, wall.players)).toEqual([]);
  });

  it("cancels the captured runner's later commands in the same step and rejects afterwards", () => {
    const base = place(startedMatch(100), {
      'r-a': { x: 10, y: 2, dir: 1 },
      't-a': { x: 11, y: 2, dir: 3 },
    });
    let state = step(base, 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    for (let tick = 102; tick <= 109; tick += 1) state = step(state, tick).state;
    const captureTick = step(state, 110, [
      command('r-a', 'TURN', { direction: 'left' }, { requestId: 'late' }),
    ]);
    expect(captureTick.outcomes).toEqual([
      expect.objectContaining({ requestId: 'late', result: 'canceled', code: 'NOT_ACTIVE' }),
    ]);
    const after = step(captureTick.state, 111, [command('r-a', 'TURN', { direction: 'left' })]);
    expect(after.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ACTIVE' });
  });
});

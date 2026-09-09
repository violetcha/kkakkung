import { describe, expect, it } from 'vitest';

import { getFrame, getPlayerSelf, getVisibleSurfaces } from '../../src/match/engine.js';
import { command, createTestMatch, player, startedMatch, step } from './match-fixture.js';

describe('reserved cell movement', () => {
  it('reserves a 9-tick forward move at T=10 style timing and changes the cell only at completion', () => {
    // r-a starts at (2,2) facing north; (2,1) is a passage.
    const start = startedMatch(100);
    const t110 = step(start, 110, [command('r-a', 'MOVE_INTENT', { direction: 'forward' })]);
    expect(t110.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-a', result: 'applied', code: null, tick: 110 }),
    ]);
    const reserved = player(t110.state, 'r-a');
    expect(reserved.cell).toEqual({ x: 2, y: 2 });
    expect(reserved.action).toEqual({
      kind: 'move',
      from: { x: 2, y: 2, dir: 0 },
      to: { x: 2, y: 1, dir: 0 },
      startTick: 110,
      endTick: 119,
    });
    let state = t110.state;
    for (let tick = 111; tick <= 118; tick += 1) {
      state = step(state, tick).state;
      expect(player(state, 'r-a').cell).toEqual({ x: 2, y: 2 });
    }
    // Stop holding before completion so no follow-up move starts.
    const stop = step(state, 119, [command('r-a', 'MOVE_INTENT', { direction: null })]);
    expect(player(stop.state, 'r-a').cell).toEqual({ x: 2, y: 1 });
    expect(player(stop.state, 'r-a').action).toBeNull();
    // The original state is untouched.
    expect(player(start, 'r-a').cell).toEqual({ x: 2, y: 2 });
  });

  it('rejects moves into walls or off the grid without creating an action', () => {
    const start = startedMatch(100);
    // Runner r-a at (2,2) facing north; back = (2,3) passage, but moving west from x=1 is blocked.
    // Move t-b at (16,12) facing north: (16,11) is passage. Use a wall case: t-a at (8,16) facing north,
    // back would be (8,17) passage. Build a wall case with r-b at (29,2): forward (29,1) passage, so
    // use r-c at (16,30) facing north -> back (16,31) is the outer wall.
    const result = step(start, 101, [command('r-c', 'MOVE_INTENT', { direction: 'back' })]);
    expect(result.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-c', result: 'rejected', code: 'NOT_ALLOWED' }),
    ]);
    expect(player(result.state, 'r-c')).toMatchObject({
      cell: { x: 16, y: 30 },
      action: null,
      heldMove: null,
    });
    expect(result.events).toEqual([]);
  });

  it('allows a move into a cell occupied by a teammate and finishes the current step on a null intent', () => {
    const start = startedMatch(100);
    // Put r-a and r-b adjacent: r-a (2,2) faces north; r-b is far. Use taggers t-a (8,16) north -> (8,15).
    // Move t-a to (8,15) then let t-b... simpler: r-a moves north to (2,1); then a second runner cannot be
    // placed there quickly, so assert occupancy via two moves onto the same target cell instead.
    const both = step(start, 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('r-a', 'MOVE_INTENT', { direction: null }, { requestId: 'stop' }),
    ]);
    // The null intent removes the held move but the reserved action completes at 110.
    expect(both.outcomes.map((o) => o.result)).toEqual(['applied', 'applied']);
    expect(player(both.state, 'r-a').action?.endTick).toBe(110);
    expect(player(both.state, 'r-a').heldMove).toBeNull();
    let state = both.state;
    for (let tick = 102; tick <= 110; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a')).toMatchObject({ cell: { x: 2, y: 1 }, action: null });
    // Same-team occupancy: t-a at (8,16) and t-b at (16,12); move t-b west 8 cells is long, so test the
    // rule directly: reserve for t-a a move north to (8,15) while t-a's teammate stands there.
    const occupied = { ...state, players: new Map(state.players) };
    occupied.players.set('t-b', { ...player(state, 't-b'), cell: { x: 8, y: 15 } });
    const teammateMove = step(occupied, 111, [
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]);
    expect(teammateMove.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(teammateMove.state, 't-a').action?.to).toEqual({ x: 8, y: 15, dir: 0 });
  });

  it('keeps moving while the intent is held and chains the next move at the completion tick', () => {
    const start = startedMatch(100);
    // r-a at (2,2) facing north: 'back' moves south to (2,3), then (2,4) while held.
    let state = step(start, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]).state;
    for (let tick = 102; tick <= 110; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a').cell).toEqual({ x: 2, y: 3 });
    expect(player(state, 'r-a').action).toMatchObject({ startTick: 110, endTick: 119 });
    expect(player(state, 'r-a').action?.to).toEqual({ x: 2, y: 4, dir: 0 });
    // A held move against a wall reserves nothing but keeps the intent.
    const north = step(start, 101, [command('r-b', 'MOVE_INTENT', { direction: 'forward' })]).state;
    let blocked = north;
    for (let tick = 102; tick <= 110; tick += 1) blocked = step(blocked, tick).state;
    expect(player(blocked, 'r-b').cell).toEqual({ x: 29, y: 1 });
    expect(player(blocked, 'r-b').action).toBeNull();
    expect(player(blocked, 'r-b').heldMove).toMatchObject({ direction: 'forward' });
  });

  it('emits exactly one footstep SPATIAL_SOUND at the completion tick and none while reserving', () => {
    const start = startedMatch(100);
    let result = step(start, 110, [command('r-a', 'MOVE_INTENT', { direction: 'forward' })]);
    expect(result.events).toEqual([]);
    let state = result.state;
    for (let tick = 111; tick <= 118; tick += 1) {
      result = step(state, tick);
      state = result.state;
      expect(result.events).toEqual([]);
    }
    result = step(state, 119, [command('r-a', 'MOVE_INTENT', { direction: null })]);
    expect(result.events).toEqual([
      {
        type: 'SPATIAL_SOUND',
        sound: {
          eventId: 'match-1/game-1/119/1',
          tick: 119,
          kind: 'footstep',
          cell: { x: 2, y: 1 },
          sourcePlayerId: 'r-a',
        },
      },
    ]);
    // Re-evaluating the same completed action later does not re-emit.
    expect(step(result.state, 120).events).toEqual([]);
  });

  it('rejects commands before START_PLAYING and requires increasing ticks', () => {
    const created = createTestMatch();
    const early = step(created, 5, [command('r-a', 'MOVE_INTENT', { direction: 'forward' })]);
    expect(early.outcomes[0]).toMatchObject({ result: 'rejected', code: 'INVALID_PHASE' });
    expect(getFrame(early.state).phase).toBe('GAME_LOADING');
    expect(() => step(early.state, 5)).toThrow(RangeError);
    const started = step(early.state, 500, [], [{ type: 'START_PLAYING', startTick: 500 }]);
    const frame = getFrame(started.state);
    expect(frame).toMatchObject({ phase: 'PLAYING', tick: 500 });
    expect(started.state.startTick).toBe(500);
    expect(started.state.deadlineTick).toBe(4100);
  });

  it('exposes read-only selectors that do not change state and keep loading null', () => {
    const start = startedMatch(100);
    const before = JSON.stringify([...start.players.values()]);
    const self = getPlayerSelf(start, 'r-a');
    expect(self).toMatchObject({ status: 'ACTIVE', cell: { x: 2, y: 2 }, dir: 0, loading: null });
    expect(getPlayerSelf(start, 'nobody')).toBeNull();
    expect(getVisibleSurfaces(start, 'r-a')).toEqual({ visibleCells: [], visibleWallFaces: [] });
    expect(getFrame(start).participants).toHaveLength(6);
    expect(getFrame(start).gameInstanceId).toBe('game-1');
    expect(JSON.stringify([...start.players.values()])).toBe(before);
  });
});

import { describe, expect, it } from 'vitest';

import { turnDir } from '../../src/match/rotation.js';
import { command, player, startedMatch, step } from './match-fixture.js';

describe('reserved 90 degree rotation', () => {
  it('maps left/right across the 0/3 boundary', () => {
    expect(turnDir(3, 'right')).toBe(0);
    expect(turnDir(0, 'left')).toBe(3);
    expect(turnDir(1, 'left')).toBe(0);
    expect(turnDir(2, 'right')).toBe(3);
  });

  it('turns from dir 3 to dir 0 as a 6-tick action committed at endTick only', () => {
    const start = startedMatch(100);
    // Face r-a west first: left from north = west (3).
    const west = step(start, 101, [command('r-a', 'TURN', { direction: 'left' })]);
    let state = west.state;
    for (let tick = 102; tick <= 107; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a').dir).toBe(3);
    const right = step(state, 110, [command('r-a', 'TURN', { direction: 'right' })]);
    expect(right.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(right.state, 'r-a').action).toEqual({
      kind: 'turn',
      from: { x: 2, y: 2, dir: 3 },
      to: { x: 2, y: 2, dir: 0 },
      startTick: 110,
      endTick: 116,
    });
    state = right.state;
    for (let tick = 111; tick <= 115; tick += 1) {
      state = step(state, tick).state;
      expect(player(state, 'r-a').dir).toBe(3);
    }
    const done = step(state, 116);
    expect(player(done.state, 'r-a')).toMatchObject({ dir: 0, cell: { x: 2, y: 2 }, action: null });
    // Turning makes no footstep sound.
    expect(done.events).toEqual([]);
  });

  it('turns left from north to west without changing the cell', () => {
    const start = startedMatch(100);
    let state = step(start, 101, [command('r-a', 'TURN', { direction: 'left' })]).state;
    for (let tick = 102; tick <= 107; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a')).toMatchObject({ dir: 3, cell: { x: 2, y: 2 } });
  });

  it('does not change the direction of a running move when a TURN arrives; the turn waits in the slot', () => {
    const start = startedMatch(100);
    let result = step(start, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]);
    result = step(result.state, 103, [command('r-a', 'TURN', { direction: 'right' })]);
    expect(result.outcomes[0]).toMatchObject({ result: 'applied' });
    const moving = player(result.state, 'r-a');
    expect(moving.action).toMatchObject({
      kind: 'move',
      from: { dir: 0 },
      to: { x: 2, y: 3, dir: 0 },
    });
    expect(moving.nextAction).toEqual({ direction: 'right', sequence: expect.any(Number) });
    let state = result.state;
    for (let tick = 104; tick <= 110; tick += 1) state = step(state, tick).state;
    // Move completed at 110 and the queued turn started at 110 (held move waits).
    expect(player(state, 'r-a')).toMatchObject({ cell: { x: 2, y: 3 }, dir: 0, nextAction: null });
    expect(player(state, 'r-a').action).toMatchObject({
      kind: 'turn',
      startTick: 110,
      endTick: 116,
    });
    for (let tick = 111; tick <= 116; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a').dir).toBe(1);
    // Held move resumes after the turn, now heading east from (2,3) -> (3,3) backwards? 'back' from east = west (1,3).
    expect(player(state, 'r-a').action).toMatchObject({ kind: 'move', to: { x: 1, y: 3, dir: 1 } });
  });

  it('gives one applied/rejected outcome per request and none for EXPIRE_MOVE', () => {
    const start = startedMatch(100);
    const result = step(
      start,
      101,
      [
        command('r-a', 'TURN', { direction: 'left' }, { requestId: 'a' }),
        command('r-a', 'TURN', { direction: 'right' }, { requestId: 'b' }),
        command('r-c', 'TURN', { direction: 'up' as unknown as 'left' }, { requestId: 'c' }),
      ],
      [{ type: 'EXPIRE_MOVE', playerId: 'r-a', sequence: 999 }],
    );
    expect(result.outcomes.map((o) => [o.requestId, o.result, o.code])).toEqual([
      ['a', 'applied', null],
      ['b', 'applied', null],
      ['c', 'rejected', 'INVALID_COMMAND'],
    ]);
    // Second turn waits in the slot instead of running concurrently.
    expect(player(result.state, 'r-a').action?.kind).toBe('turn');
    expect(player(result.state, 'r-a').nextAction?.direction).toBe('right');
  });
});

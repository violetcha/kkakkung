import { describe, expect, it } from 'vitest';

import { expireMove, holdMove, queueTurn } from '../../src/match/input-buffer.js';
import { command, player, startedMatch, step } from './match-fixture.js';

describe('single-slot input buffer', () => {
  it('keeps at most one waiting turn while 20 TURN commands arrive during a move', () => {
    const start = startedMatch(100);
    let result = step(start, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]);
    const turns = Array.from({ length: 20 }, (_, i) =>
      command('r-a', 'TURN', { direction: i % 2 === 0 ? 'left' : 'right' }, { requestId: `t${i}` }),
    );
    result = step(result.state, 102, turns);
    expect(result.outcomes).toHaveLength(20);
    expect(result.outcomes.every((o) => o.result === 'applied')).toBe(true);
    expect(player(result.state, 'r-a').nextAction).toEqual({
      direction: 'right',
      sequence: expect.any(Number),
    });
    let state = result.state;
    for (let tick = 103; tick <= 110; tick += 1) state = step(state, tick).state;
    // One turn executes after the move; nothing else is queued behind it.
    expect(player(state, 'r-a').action?.kind).toBe('turn');
    expect(player(state, 'r-a').nextAction).toBeNull();
    for (let tick = 111; tick <= 116; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a').dir).toBe(1);
    // Held move resumes as a move, not another turn.
    expect(player(state, 'r-a').action?.kind).toBe('move');
  });

  it('EXPIRE_MOVE during a move lets the current 9 ticks finish and prevents the next step', () => {
    const start = startedMatch(100);
    let result = step(start, 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'back' }, { sequence: 10 }),
    ]);
    result = step(result.state, 105, [], [{ type: 'EXPIRE_MOVE', playerId: 'r-a', sequence: 10 }]);
    expect(player(result.state, 'r-a').heldMove).toBeNull();
    expect(player(result.state, 'r-a').action).not.toBeNull();
    let state = result.state;
    for (let tick = 106; tick <= 110; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a')).toMatchObject({ cell: { x: 2, y: 3 }, action: null });
    const later = step(state, 150);
    expect(player(later.state, 'r-a').action).toBeNull();
  });

  it('an old-sequence expiry does not cancel a newer refresh, and a stale expiry never replays', () => {
    const start = startedMatch(100);
    let result = step(start, 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'back' }, { sequence: 10 }),
    ]);
    result = step(result.state, 102, [
      command('r-a', 'MOVE_INTENT', { direction: 'back' }, { sequence: 12 }),
    ]);
    result = step(result.state, 103, [], [{ type: 'EXPIRE_MOVE', playerId: 'r-a', sequence: 10 }]);
    expect(player(result.state, 'r-a').heldMove).toEqual({ direction: 'back', sequence: 12 });
    result = step(result.state, 104, [], [{ type: 'EXPIRE_MOVE', playerId: 'r-a', sequence: 12 }]);
    expect(player(result.state, 'r-a').heldMove).toBeNull();
    let state = result.state;
    for (let tick = 105; tick <= 150; tick += 1) state = step(state, tick).state;
    // Two seconds later nothing revives the expired intent.
    expect(player(state, 'r-a')).toMatchObject({
      cell: { x: 2, y: 3 },
      action: null,
      heldMove: null,
    });
  });

  it('pure helpers never mutate and ignore older sequences', () => {
    const start = startedMatch(100);
    const p = player(start, 'r-a');
    const held = holdMove(p, 'forward', 5);
    expect(p.heldMove).toBeNull();
    expect(held.heldMove).toEqual({ direction: 'forward', sequence: 5 });
    expect(holdMove(held, 'back', 4)).toBe(held);
    expect(expireMove(held, 4)).toBe(held);
    expect(expireMove(held, 5).heldMove).toBeNull();
    const queued = queueTurn(p, 'left', 3);
    expect(queueTurn(queued, 'right', 2)).toBe(queued);
    expect(queueTurn(queued, 'right', 4).nextAction?.direction).toBe('right');
  });

  it('a stop intent with a queued turn keeps the turn and drops only the held move', () => {
    const start = startedMatch(100);
    let result = step(start, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]);
    result = step(result.state, 102, [
      command('r-a', 'TURN', { direction: 'left' }),
      command('r-a', 'MOVE_INTENT', { direction: null }),
    ]);
    expect(player(result.state, 'r-a')).toMatchObject({
      heldMove: null,
      nextAction: { direction: 'left' },
    });
    let state = result.state;
    for (let tick = 103; tick <= 110; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a').action?.kind).toBe('turn');
    for (let tick = 111; tick <= 116; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a')).toMatchObject({ dir: 3, action: null });
  });
});

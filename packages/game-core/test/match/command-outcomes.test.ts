import { describe, expect, it } from 'vitest';

import type { CoreCommand } from '../../src/match/core-types.js';
import { command, player, startedMatch, step } from './match-fixture.js';

/** A command whose type no handler knows, independent of which are implemented. */
function unsupportedCommand(actorId: string): CoreCommand {
  return {
    ...command(actorId, 'TURN', { direction: 'left' }),
    type: 'NOT_A_COMMAND',
  } as unknown as CoreCommand;
}

describe('command outcomes', () => {
  it('returns exactly one outcome per accepted command with the request identifiers', () => {
    const start = startedMatch(100);
    const move = command(
      'r-a',
      'MOVE_INTENT',
      { direction: 'forward' },
      { requestId: 'req-move', sequence: 5 },
    );
    const wall = command(
      'r-c',
      'MOVE_INTENT',
      { direction: 'back' },
      { requestId: 'req-wall', sequence: 6 },
    );
    const result = step(start, 101, [move, wall]);
    expect(result.outcomes).toEqual([
      {
        matchId: 'match-1',
        requestId: 'req-move',
        sequence: 5,
        tick: 101,
        actorId: 'r-a',
        result: 'applied',
        code: null,
      },
      {
        matchId: 'match-1',
        requestId: 'req-wall',
        sequence: 6,
        tick: 101,
        actorId: 'r-c',
        result: 'rejected',
        code: 'NOT_ALLOWED',
      },
    ]);
    expect(result.outcomes.every((o) => !('stateVersion' in o))).toBe(true);
  });

  it('leaves the game state identical when a command is rejected', () => {
    const start = startedMatch(100);
    const before = JSON.stringify([...start.players.values()]);
    const result = step(start, 101, [command('r-c', 'MOVE_INTENT', { direction: 'back' })]);
    expect(JSON.stringify([...result.state.players.values()])).toBe(before);
    expect(result.events).toEqual([]);
  });

  it('rejects wrong match ids, unknown actors, and unsupported command types', () => {
    const start = startedMatch(100);
    const result = step(start, 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }, { matchId: 'other' }),
      command('ghost', 'MOVE_INTENT', { direction: 'forward' }),
      unsupportedCommand('r-a'),
    ]);
    expect(result.outcomes.map((o) => [o.result, o.code])).toEqual([
      ['rejected', 'WRONG_MATCH'],
      ['rejected', 'NOT_ALLOWED'],
      ['rejected', 'INVALID_COMMAND'],
    ]);
  });

  it('does not create outcomes for internal controls', () => {
    const start = startedMatch(100);
    const result = step(start, 101, [], [{ type: 'EXPIRE_MOVE', playerId: 'r-a', sequence: 1 }]);
    expect(result.outcomes).toEqual([]);
    expect(player(result.state, 'r-a').action).toBeNull();
  });

  it('applied means the intent was accepted, not that the player arrived', () => {
    const start = startedMatch(100);
    const result = step(start, 101, [command('r-a', 'MOVE_INTENT', { direction: 'forward' })]);
    expect(result.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(result.state, 'r-a').cell).toEqual({ x: 2, y: 2 });
  });
});

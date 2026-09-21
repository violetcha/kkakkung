import { describe, expect, it } from 'vitest';
import { toCoreCommand, toMoveCommand, toProductCommand } from '../../src/game/CommandAdapter.js';

const requestId = '10000000-0000-4000-8000-000000000001';
const context = { currentMatchId: 'match-1' };
const move = {
  matchId: 'match-1',
  requestId,
  sequence: 5,
  type: 'MOVE_INTENT',
  payload: { direction: 'forward' },
};

describe('CommandAdapter', () => {
  it('keeps the sandbox move adapter intact', () => {
    expect(toMoveCommand('p1', { seq: 0, x: 1, z: 0 })).toEqual({
      playerId: 'p1',
      seq: 0,
      x: 1,
      z: 0,
    });
    expect(toMoveCommand('p1', { seq: 0, x: 1, z: 0, playerId: 'p2' })).toBeUndefined();
  });

  it('accepts a valid envelope and injects only the authenticated actor', () => {
    const result = toProductCommand(move, context);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted' || result.kind !== 'core') throw new Error('expected core');
    const core = toCoreCommand('session-player-1', result.command);
    expect(core).toEqual({ ...move, actorId: 'session-player-1' });
    const ready = toProductCommand({ ...move, type: 'READY', payload: { ready: true } }, context);
    expect(ready).toMatchObject({ status: 'accepted', kind: 'phase' });
  });

  it('accepts an empty grab intent as a core command', () => {
    const result = toProductCommand({ ...move, type: 'GRAB_INTENT', payload: {} }, context);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted' || result.kind !== 'core') throw new Error('expected core');
    expect(toCoreCommand('tagger-1', result.command)).toEqual({
      ...move,
      type: 'GRAB_INTENT',
      payload: {},
      actorId: 'tagger-1',
    });
  });

  it.each([
    {
      name: 'seq only',
      payload: { seq: 1, dir: 'forward' },
      expected: { sequence: -1, requestId: '' },
    },
    {
      name: 'fractional sequence',
      payload: { ...move, sequence: 1.5 },
      expected: { sequence: -1 },
    },
    { name: 'bad uuid', payload: { ...move, requestId: 'nope' }, expected: { requestId: '' } },
    {
      name: 'extra coordinates',
      payload: { ...move, payload: { direction: 'forward', x: 1, y: 2 } },
      expected: { sequence: 5 },
    },
    { name: 'client team', payload: { ...move, team: 'runners' }, expected: { sequence: 5 } },
    {
      name: 'unknown command',
      payload: { ...move, type: 'USE_ITEM', payload: {} },
      expected: { sequence: 5 },
    },
  ])('rejects $name as INVALID_COMMAND with safe correlation', ({ payload, expected }) => {
    const result = toProductCommand(payload, context);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('INVALID_COMMAND');
    expect(result.correlation).toMatchObject(expected);
  });

  it('rejects payloads over 4096 UTF-8 bytes before parsing', () => {
    const oversized = { ...move, payload: { direction: 'forward' }, matchId: '가'.repeat(1400) };
    const result = toProductCommand(oversized, context);
    expect(result).toMatchObject({ status: 'rejected', code: 'INVALID_COMMAND' });
    const boundary = { ...move, matchId: 'x'.repeat(64) };
    expect(toProductCommand(boundary, { currentMatchId: boundary.matchId }).status).toBe(
      'accepted',
    );
  });

  it('rejects commands for another match with WRONG_MATCH', () => {
    const result = toProductCommand({ ...move, matchId: 'old-match' }, context);
    expect(result).toEqual({
      status: 'rejected',
      code: 'WRONG_MATCH',
      correlation: { matchId: 'old-match', requestId, sequence: 5 },
    });
  });
});

import { describe, expect, it } from 'vitest';

import { getFrame, type MatchState } from '../../src/match/engine.js';
import { terminateRunner } from '../../src/match/participation.js';
import { command, createTestPractice, player, startedMatch, step } from './match-fixture.js';

function ended(state: MatchState, id: string, outcome: 'ESCAPED' | 'CAPTURED'): MatchState {
  return terminateRunner(state, id, outcome, state.tick ?? 0, () => 'evt').state;
}

describe('connection loss policy', () => {
  it('lets the match continue when an already escaped runner disconnects', () => {
    const state = ended(startedMatch(100), 'r-a', 'ESCAPED');
    const result = step(state, 101, [], [{ type: 'CONNECTION_LOST', playerId: 'r-a' }]);
    expect(result.state.phase).toBe('PLAYING');
    expect(result.state.counts).toEqual({ escaped: 1, captured: 0 });
    expect(player(result.state, 'r-a')).toMatchObject({ status: 'ESCAPED', connected: false });
    expect(result.mediaIntents).toEqual([]);
  });

  it('aborts with GAME_CONNECTION_LOST when an active runner or tagger disconnects and never records a win', () => {
    const runner = step(startedMatch(100), 101, [], [{ type: 'CONNECTION_LOST', playerId: 'r-b' }]);
    expect(getFrame(runner.state)).toMatchObject({
      phase: 'ABORTED',
      abortReason: 'GAME_CONNECTION_LOST',
      result: null,
    });
    expect(runner.mediaIntents).toEqual([{ type: 'RETIRE_INSTANCE', reason: 'aborted' }]);
    const tagger = step(startedMatch(100), 101, [], [{ type: 'CONNECTION_LOST', playerId: 't-c' }]);
    expect(tagger.state.phase).toBe('ABORTED');
    // Commands after abort are canceled and the abort reason is kept.
    const after = step(tagger.state, 102, [command('t-a', 'TURN', { direction: 'left' })]);
    expect(after.outcomes[0]).toMatchObject({ result: 'canceled', code: 'ROUND_ENDED' });
    expect(after.state.abortReason).toBe('GAME_CONNECTION_LOST');
  });

  it('fixes a same-tick capture before the disconnection so the loss does not void it', () => {
    const base = startedMatch(100);
    const players = new Map(base.players);
    players.set('r-a', { ...player(base, 'r-a'), cell: { x: 10, y: 2 }, dir: 1 });
    players.set('t-a', { ...player(base, 't-a'), cell: { x: 11, y: 2 }, dir: 3 });
    let state: MatchState = { ...base, players };
    state = step(state, 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    for (let tick = 102; tick <= 109; tick += 1) state = step(state, tick).state;
    const result = step(state, 110, [], [{ type: 'CONNECTION_LOST', playerId: 'r-a' }]);
    expect(player(result.state, 'r-a')).toMatchObject({ status: 'CAPTURED', connected: false });
    expect(result.state.counts.captured).toBe(1);
    expect(result.state.phase).toBe('PLAYING');
  });

  it('keeps a result decided in the same tick when a connection closes afterwards', () => {
    const state = ended(ended(startedMatch(100), 'r-a', 'ESCAPED'), 'r-b', 'ESCAPED');
    const result = step(state, 101, [], [{ type: 'CONNECTION_LOST', playerId: 't-a' }]);
    expect(result.state.phase).toBe('RESULT');
    expect(result.state.result).toEqual({ winner: 'runners', reason: 'two-escaped' });
    expect(result.state.abortReason).toBeNull();
    expect(player(result.state, 't-a').connected).toBe(false);
  });

  it('applies ABORT_MATCH as a separate overload path and ignores unknown players', () => {
    const overload = step(
      startedMatch(100),
      101,
      [],
      [{ type: 'ABORT_MATCH', reason: 'SERVER_TICK_OVERLOAD' }],
    );
    expect(getFrame(overload.state)).toMatchObject({
      phase: 'ABORTED',
      abortReason: 'SERVER_TICK_OVERLOAD',
    });
    expect(overload.state.counts).toEqual({ escaped: 0, captured: 0 });
    const unknown = step(
      startedMatch(100),
      101,
      [],
      [{ type: 'CONNECTION_LOST', playerId: 'ghost' }],
    );
    expect(unknown.state.phase).toBe('PLAYING');
    expect(unknown.state.players.size).toBe(6);
  });

  it('in practice a disconnecting player is retired without aborting the team practice', () => {
    const practice = createTestPractice('runner', ['p1', 'p2']);
    const result = step(practice, 10, [], [{ type: 'CONNECTION_LOST', playerId: 'p1' }]);
    expect(result.state.phase).toBe('TEAM_PRACTICE');
    expect(result.mediaIntents).toEqual([
      { type: 'RETIRE_PLAYER', playerId: 'p1', reason: 'connection-lost' },
    ]);
    expect(player(result.state, 'p1').connected).toBe(false);
  });
});

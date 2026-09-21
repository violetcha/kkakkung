import { describe, expect, it } from 'vitest';

import type { MatchState } from '../../src/match/engine.js';
import { command, createTestPractice, player, startedMatch, step } from './match-fixture.js';

function overlap(state: MatchState, runnerId = 'r-a', taggerId = 't-a'): MatchState {
  const players = new Map(state.players);
  const runner = player(state, runnerId);
  const tagger = player(state, taggerId);
  players.set(runnerId, { ...runner, cell: { x: 10, y: 2 }, action: null });
  players.set(taggerId, { ...tagger, cell: { x: 10, y: 2 }, action: null });
  return { ...state, players };
}

describe('grab intent', () => {
  it('opens a six-tick window starting on the tick after the command', () => {
    const started = overlap(startedMatch(100));
    const armed = step(started, 101, [command('t-a', 'GRAB_INTENT', {})]);

    expect(player(armed.state, 'r-a').status).toBe('ACTIVE');
    expect(player(armed.state, 't-a').grabUntilTick).toBe(108);
    expect(armed.outcomes[0]).toMatchObject({ result: 'applied', code: null });

    const captured = step(armed.state, 102);
    expect(player(captured.state, 'r-a').status).toBe('CAPTURED');
  });

  it('does not capture at the exclusive end tick', () => {
    let state = startedMatch(100);
    state = step(state, 101, [command('t-a', 'GRAB_INTENT', {})]).state;
    for (let tick = 102; tick <= 107; tick += 1) state = step(state, tick).state;

    const expired = step(overlap(state), 108);
    expect(player(expired.state, 'r-a').status).toBe('ACTIVE');
  });

  it('rejects runners and practice-mode actors', () => {
    const game = step(startedMatch(100), 101, [command('r-a', 'GRAB_INTENT', {})]);
    expect(game.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });

    const practice = step(createTestPractice('tagger', ['t-a']), 1, [
      command('t-a', 'GRAB_INTENT', {}),
    ]);
    expect(practice.outcomes[0]).toMatchObject({ result: 'rejected', code: 'INVALID_PHASE' });
  });

  it('refreshes the window when another intent arrives', () => {
    let state = step(startedMatch(100), 101, [command('t-a', 'GRAB_INTENT', {})]).state;
    state = step(state, 105, [command('t-a', 'GRAB_INTENT', {})]).state;

    expect(player(state, 't-a').grabUntilTick).toBe(112);
  });
});

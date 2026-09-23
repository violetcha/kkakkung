import { describe, expect, it } from 'vitest';

import type { MatchState } from '../../src/match/engine.js';
import { getFrame } from '../../src/match/engine.js';
import { evaluateResult } from '../../src/match/result.js';
import { terminateRunner } from '../../src/match/participation.js';
import { command, player, startedMatch, step } from './match-fixture.js';

function ended(state: MatchState, id: string, outcome: 'ESCAPED' | 'CAPTURED'): MatchState {
  return terminateRunner(state, id, outcome, state.tick ?? 0).state;
}

describe('team result and deadline', () => {
  it('runners win immediately with two escaped', () => {
    const state = ended(ended(startedMatch(100), 'r-a', 'ESCAPED'), 'r-b', 'ESCAPED');
    expect(evaluateResult(state, 200, { includeTimeout: false })).toEqual({
      winner: 'runners',
      reason: 'two-escaped',
    });
    const next = step(state, 101);
    expect(getFrame(next.state)).toMatchObject({
      phase: 'RESULT',
      result: { winner: 'runners', reason: 'two-escaped' },
    });
    expect(next.mediaIntents).toEqual([{ type: 'RETIRE_INSTANCE', reason: 'round-ended' }]);
  });

  it('keeps playing with 1 escaped / 1 captured / 1 active until the deadline, then taggers win on timeout', () => {
    const state = ended(ended(startedMatch(100), 'r-a', 'ESCAPED'), 'r-b', 'CAPTURED');
    expect(state.deadlineTick).toBe(3700);
    expect(evaluateResult(state, 3699, { includeTimeout: true })).toBeNull();
    const before = step(state, 3699);
    expect(before.state.phase).toBe('PLAYING');
    const at = step(before.state, 3700, [command('r-c', 'MOVE_INTENT', { direction: 'forward' })]);
    // The command at the deadline tick is still processed before the timeout decision.
    expect(at.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(getFrame(at.state)).toMatchObject({
      phase: 'RESULT',
      result: { winner: 'taggers', reason: 'timeout' },
    });
  });

  it('commits a capture at the deadline before the timeout result', () => {
    const base = startedMatch(100);
    const players = new Map(base.players);
    players.set('r-a', { ...player(base, 'r-a'), cell: { x: 10, y: 2 }, dir: 1 });
    players.set('t-a', { ...player(base, 't-a'), cell: { x: 11, y: 2 }, dir: 3 });
    let state: MatchState = ended({ ...base, players }, 'r-b', 'CAPTURED');
    state = step(state, 3691, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    for (let tick = 3692; tick <= 3698; tick += 1) state = step(state, tick).state;
    state = step(state, 3699, [command('t-a', 'GRAB_INTENT', {})]).state;
    const deadline = step(state, 3700);
    expect(player(deadline.state, 'r-a').status).toBe('CAPTURED');
    expect(deadline.state.result).toEqual({ winner: 'taggers', reason: 'two-captured' });
  });

  it('blocks new input and effects after RESULT and cancels remaining commands with ROUND_ENDED', () => {
    const state = ended(ended(startedMatch(100), 'r-a', 'CAPTURED'), 'r-b', 'CAPTURED');
    const result = step(state, 101, [command('r-c', 'MOVE_INTENT', { direction: 'forward' })]);
    expect(result.state.phase).toBe('RESULT');
    expect(result.outcomes[0]).toMatchObject({ result: 'canceled', code: 'ROUND_ENDED' });
    const later = step(result.state, 102, [command('t-a', 'TURN', { direction: 'left' })]);
    expect(later.outcomes[0]).toMatchObject({ result: 'canceled', code: 'ROUND_ENDED' });
    expect(later.state.result).toEqual(result.state.result);
    expect(later.events).toEqual([]);
    expect(player(later.state, 't-a').action).toBeNull();
  });

  it('treats impossible counts as an invariant violation instead of a draw', () => {
    const state = ended(ended(startedMatch(100), 'r-a', 'ESCAPED'), 'r-b', 'ESCAPED');
    const players = new Map(state.players);
    players.set('r-c', { ...player(state, 'r-c'), status: 'CAPTURED' });
    players.set('t-a', { ...player(state, 't-a'), role: 'runner', status: 'CAPTURED' });
    expect(() => evaluateResult({ ...state, players }, 200, { includeTimeout: false })).toThrow(
      /impossible/,
    );
  });

  it('does not apply timeouts in practice mode', () => {
    const practice = {
      ...startedMatch(100),
      mode: 'practice' as const,
      phase: 'TEAM_PRACTICE' as const,
    };
    expect(evaluateResult(practice, 99_999, { includeTimeout: true })).toBeNull();
  });
});

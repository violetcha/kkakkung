/**
 * 시연 방(showcase)의 판정 정책 `result: 'timeout-only'`.
 *
 * 발표 대본을 다 보여 주기 전에 경기가 끝나면 안 되므로 탈출·포획 수로는 끝내지 않고, 제한시간에
 * 탈출이 포획보다 많으면 도망자, 아니면 술래가 이긴다. 일반 경기는 이 표지가 없어 그대로다.
 */
import { describe, expect, it } from 'vitest';

import { createMatch, getFrame, stepMatch, type MatchState } from '../../src/match/engine.js';
import { evaluateResult } from '../../src/match/result.js';
import { terminateRunner } from '../../src/match/participation.js';
import { fixtureLayout, roster, startedMatch, step, tuning } from './match-fixture.js';

function ended(state: MatchState, id: string, outcome: 'ESCAPED' | 'CAPTURED'): MatchState {
  return terminateRunner(state, id, outcome, state.tick ?? 0).state;
}

function showcaseMatch(startTick = 100): MatchState {
  const created = createMatch({
    matchId: 'match-1',
    gameInstanceId: 'game-showcase',
    seed: 7,
    tuning: tuning(),
    layout: fixtureLayout(),
    players: roster,
    result: 'timeout-only',
  });
  return stepMatch(created, {
    tick: startTick,
    commands: [],
    controls: [{ type: 'START_PLAYING', startTick }],
  }).state;
}

describe('showcase timeout-only result policy', () => {
  it('keeps the round clock and does not end on two escapes or two captures', () => {
    const base = showcaseMatch(100);
    expect(base.resultPolicy).toBe('timeout-only');
    expect(base.deadlineTick).toBe(3700);
    const escaped = ended(ended(base, 'r-a', 'ESCAPED'), 'r-b', 'ESCAPED');
    expect(evaluateResult(escaped, 200, { includeTimeout: true })).toBeNull();
    expect(step(escaped, 101).state.phase).toBe('PLAYING');
    const captured = ended(ended(base, 'r-a', 'CAPTURED'), 'r-b', 'CAPTURED');
    expect(evaluateResult(captured, 200, { includeTimeout: true })).toBeNull();
  });

  it('decides by counts at the deadline: more escapes than captures is a runner win', () => {
    const state = ended(ended(showcaseMatch(100), 'r-a', 'ESCAPED'), 'r-b', 'ESCAPED');
    expect(evaluateResult(state, 3699, { includeTimeout: true })).toBeNull();
    expect(getFrame(step(state, 3700).state)).toMatchObject({
      phase: 'RESULT',
      result: { winner: 'runners', reason: 'timeout' },
    });
  });

  it('gives ties and capture leads to the taggers at the deadline', () => {
    const tie = ended(ended(showcaseMatch(100), 'r-a', 'ESCAPED'), 'r-b', 'CAPTURED');
    expect(step(tie, 3700).state.result).toEqual({ winner: 'taggers', reason: 'timeout' });
    const none = showcaseMatch(100);
    expect(step(none, 3700).state.result).toEqual({ winner: 'taggers', reason: 'timeout' });
  });

  it('leaves an ordinary match on the rules policy', () => {
    const state = startedMatch(100);
    expect(state.resultPolicy).toBe('rules');
    const escaped = ended(ended(state, 'r-a', 'ESCAPED'), 'r-b', 'ESCAPED');
    expect(evaluateResult(escaped, 200, { includeTimeout: false })).toEqual({
      winner: 'runners',
      reason: 'two-escaped',
    });
  });
});

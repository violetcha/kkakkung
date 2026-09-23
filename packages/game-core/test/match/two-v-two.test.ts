/**
 * S15P21C204-350. 시연 방은 실제 넷이 2:2 로 뛴다. 코어의 인원 불변식은 "양 팀 최소 1명, 팀당
 * 최대 3명, 배치·출구·영역이 명단과 일치" 이고, 3:3 일반 경기의 판정은 그대로다.
 *
 * 팀 판정 임계값은 "러너 과반(floor(n/2)+1)" 이다. 러너 셋이면 둘(RL-06 그대로), 러너 둘이면
 * 둘(둘 다 탈출해야 러너 승, 둘 다 포획돼야 술래 승; 하나씩 갈리면 제한시간까지 간다), 러너
 * 하나면 하나다. 시연 방은 `timeout-only` 라 어차피 제한시간에만 판정한다.
 */
import { describe, expect, it } from 'vitest';

import type { CreateMatchInput } from '../../src/match/core-types.js';
import { createMatch, getFrame, stepMatch, type MatchState } from '../../src/match/engine.js';
import { terminateRunner } from '../../src/match/participation.js';
import { evaluateResult } from '../../src/match/result.js';
import type { MatchLayout, RosterEntry } from '../../src/match/types.js';
import { fixtureLayout, roster, step, tuning } from './match-fixture.js';

/** The fixture roster without one tagger and one runner, and the layout stripped the same way. */
const PAIRS: RosterEntry[] = roster.filter((p) => p.playerId !== 't-c' && p.playerId !== 'r-c');

function layoutFor(players: readonly RosterEntry[]): MatchLayout {
  const real = new Set(players.map((p) => p.playerId));
  const layout = fixtureLayout();
  return {
    ...layout,
    players: layout.players.filter((p) => real.has(p.playerId)),
    exits: layout.exits.filter((exit) => real.has(exit.ownerId)),
    territories: layout.territories.filter((t) => real.has(t.playerId)),
  };
}

function create(
  players: readonly RosterEntry[],
  overrides: Partial<CreateMatchInput> = {},
): MatchState {
  return createMatch({
    matchId: 'match-1',
    gameInstanceId: 'game-2v2',
    seed: 7,
    tuning: tuning(),
    layout: layoutFor(players),
    players,
    ...overrides,
  });
}

function started(state: MatchState, startTick = 100): MatchState {
  return stepMatch(state, {
    tick: startTick,
    commands: [],
    controls: [{ type: 'START_PLAYING', startTick }],
  }).state;
}

function ended(state: MatchState, id: string, outcome: 'ESCAPED' | 'CAPTURED'): MatchState {
  return terminateRunner(state, id, outcome, state.tick ?? 0).state;
}

describe('2:2 match creation', () => {
  it('creates a match for two taggers and two runners with their exits and territories', () => {
    const state = create(PAIRS, { result: 'timeout-only' });
    expect(state.order).toEqual(['r-a', 'r-b', 't-a', 't-b']);
    expect(state.exits.size).toBe(2);
    expect([...state.exits.values()].map((e) => e.ownerId).sort()).toEqual(['r-a', 'r-b']);
    expect(state.priority).toHaveLength(2);
    expect([...state.priority!].sort()).toEqual(['r-a', 'r-b']);
    expect(state.resultPolicy).toBe('timeout-only');
    expect(getFrame(state).participants).toHaveLength(4);
  });

  it('refuses an empty team, more than three on a team, and a layout that disagrees with the roster', () => {
    const taggersOnly = roster.filter((p) => p.role === 'tagger');
    expect(() => create(taggersOnly)).toThrow(RangeError);
    const four = [...roster, { playerId: 'r-d', role: 'runner' as const }];
    expect(() => create(four, { layout: fixtureLayout() })).toThrow(RangeError);
    // Placements, exits and territories left over from absent players are not silently ignored.
    const full = fixtureLayout();
    const stripped = layoutFor(PAIRS);
    expect(() => create(PAIRS, { layout: { ...stripped, players: full.players } })).toThrow(
      RangeError,
    );
    expect(() => create(PAIRS, { layout: { ...stripped, exits: full.exits } })).toThrow(RangeError);
    expect(() => create(PAIRS, { layout: { ...stripped, territories: full.territories } })).toThrow(
      RangeError,
    );
    expect(() => create(PAIRS, { layout: { ...stripped, territories: [] } })).toThrow(RangeError);
  });

  it('plays a showcase round to the deadline and decides by counts there', () => {
    const base = started(create(PAIRS, { result: 'timeout-only' }), 100);
    expect(base.deadlineTick).toBe(3700);
    // One escape does not end the round; the deadline gives it to the runners.
    const oneOut = ended(base, 'r-a', 'ESCAPED');
    expect(step(oneOut, 101).state.phase).toBe('PLAYING');
    let state = oneOut;
    for (let tick = 102; tick < 3700; tick += 100) state = step(state, tick).state;
    const decided = step(state, 3700);
    expect(getFrame(decided.state)).toMatchObject({
      phase: 'RESULT',
      counts: { escaped: 1, captured: 0 },
      result: { winner: 'runners', reason: 'timeout' },
    });
    expect(decided.mediaIntents).toEqual([{ type: 'RETIRE_INSTANCE', reason: 'round-ended' }]);
    // Nobody out: the taggers take the deadline.
    expect(step(base, 3700).state.result).toEqual({ winner: 'taggers', reason: 'timeout' });
  });

  it('applies the runner-majority threshold under the ordinary rules policy', () => {
    const base = started(create(PAIRS), 100);
    expect(base.resultPolicy).toBe('rules');
    const both = ended(ended(base, 'r-a', 'ESCAPED'), 'r-b', 'ESCAPED');
    expect(evaluateResult(both, 200, { includeTimeout: false })).toEqual({
      winner: 'runners',
      reason: 'two-escaped',
    });
    const caught = ended(ended(base, 'r-a', 'CAPTURED'), 'r-b', 'CAPTURED');
    expect(evaluateResult(caught, 200, { includeTimeout: false })).toEqual({
      winner: 'taggers',
      reason: 'two-captured',
    });
    // One each is not a majority for anyone: the round runs to the deadline.
    const split = ended(ended(base, 'r-a', 'ESCAPED'), 'r-b', 'CAPTURED');
    expect(evaluateResult(split, 3699, { includeTimeout: true })).toBeNull();
    expect(evaluateResult(split, 3700, { includeTimeout: true })).toEqual({
      winner: 'taggers',
      reason: 'timeout',
    });
  });
});

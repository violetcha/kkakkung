import type { Counts, RoundResult } from './core-types.js';
import { MAX_RUNNERS } from './priority.js';
import type { MatchState } from './state.js';

/** Counts derived from runner statuses; the stored counts must agree with it. */
export function countRunners(state: MatchState): Counts {
  let escaped = 0;
  let captured = 0;
  for (const player of state.players.values()) {
    if (player.role !== 'runner') continue;
    if (player.status === 'ESCAPED') escaped += 1;
    else if (player.status === 'CAPTURED') captured += 1;
  }
  return { escaped, captured };
}

/**
 * Runners in the match, ended or not. The team thresholds scale from this, not from a constant.
 */
export function runnerCount(state: MatchState): number {
  let count = 0;
  for (const player of state.players.values()) if (player.role === 'runner') count += 1;
  return count;
}

/**
 * Team result (RL-06). A strict majority of the match's runners decides: with three runners that
 * is two escaped for the runners or two captured for the taggers, exactly the written rule. With
 * the showcase room's two runners (S15P21C204-350) it is both of them, so one escaped and one
 * captured runs to the deadline; with one runner it is that runner. A runner count `createMatch`
 * cannot produce, counts beyond the runner total, or a majority on both sides are an invariant
 * violation rather than a draw. Timeout applies only in game mode when `tick` reaches
 * deadlineTick and the runners have no majority.
 */
export function evaluateResult(
  state: MatchState,
  tick: number,
  options: Readonly<{ includeTimeout: boolean }>,
): RoundResult | null {
  const counts = countRunners(state);
  const runners = runnerCount(state);
  const majority = Math.floor(runners / 2) + 1;
  if (
    runners === 0 ||
    runners > MAX_RUNNERS ||
    counts.escaped + counts.captured > runners ||
    (counts.escaped >= majority && counts.captured >= majority)
  ) {
    throw new Error(
      `impossible runner counts ${counts.escaped}/${counts.captured} of ${runners} runners`,
    );
  }
  const timedOut =
    options.includeTimeout &&
    state.mode === 'game' &&
    state.deadlineTick !== null &&
    tick >= state.deadlineTick;
  // 시연 방: 탈출·포획으로 일찍 끝내지 않는다. 제한시간에 탈출이 더 많으면 도망자, 아니면 술래다.
  if (state.resultPolicy === 'timeout-only') {
    if (!timedOut) return null;
    return {
      winner: counts.escaped > counts.captured ? 'runners' : 'taggers',
      reason: 'timeout',
    };
  }
  if (counts.escaped >= majority) return { winner: 'runners', reason: 'two-escaped' };
  if (counts.captured >= majority) return { winner: 'taggers', reason: 'two-captured' };
  if (timedOut) return { winner: 'taggers', reason: 'timeout' };
  return null;
}

import type { Counts, RoundResult } from './core-types.js';
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
 * Team result (RL-06). Two escaped runners win for runners, two captured for
 * taggers. `2 + 2` is impossible with three runners and is treated as an
 * invariant violation rather than normalized to a draw. Timeout applies only in
 * game mode when `tick` reaches deadlineTick and fewer than two runners escaped.
 */
export function evaluateResult(
  state: MatchState,
  tick: number,
  options: Readonly<{ includeTimeout: boolean }>,
): RoundResult | null {
  const counts = countRunners(state);
  if (counts.escaped + counts.captured > 3 || (counts.escaped >= 2 && counts.captured >= 2)) {
    throw new Error(`impossible runner counts ${counts.escaped}/${counts.captured}`);
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
  if (counts.escaped >= 2) return { winner: 'runners', reason: 'two-escaped' };
  if (counts.captured >= 2) return { winner: 'taggers', reason: 'two-captured' };
  if (timedOut) return { winner: 'taggers', reason: 'timeout' };
  return null;
}

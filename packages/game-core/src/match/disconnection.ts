import type { AbortReason, MediaIntent } from './core-types.js';
import { isTerminal, type MatchState } from './state.js';

export type DisconnectionResult = Readonly<{
  state: MatchState;
  mediaIntents: readonly MediaIntent[];
}>;

/** Aborts a non-terminal match. A finished match keeps its result. */
export function abortMatch(state: MatchState, reason: AbortReason): DisconnectionResult {
  if (isTerminal(state)) return { state, mediaIntents: [] };
  return {
    state: { ...state, phase: 'ABORTED', abortReason: reason },
    mediaIntents: [{ type: 'RETIRE_INSTANCE', reason: 'aborted' }],
  };
}

/**
 * Connection loss (RL-08), evaluated after this tick's completions, personal
 * ends, and team result. A player whose personal result is already fixed only
 * loses the connected flag; counts, exits, and results stay. An ACTIVE runner
 * or tagger leaving a running match aborts it with GAME_CONNECTION_LOST.
 * Unknown players are ignored; the roster never changes mid-match.
 */
export function applyConnectionLost(state: MatchState, playerId: string): DisconnectionResult {
  const player = state.players.get(playerId);
  if (!player) return { state, mediaIntents: [] };
  const players = new Map(state.players);
  players.set(playerId, { ...player, connected: false });
  const marked: MatchState = { ...state, players };
  if (player.status !== 'ACTIVE' || isTerminal(marked)) return { state: marked, mediaIntents: [] };
  if (marked.mode === 'practice') {
    return {
      state: marked,
      mediaIntents: [{ type: 'RETIRE_PLAYER', playerId, reason: 'connection-lost' }],
    };
  }
  return abortMatch(marked, 'GAME_CONNECTION_LOST');
}

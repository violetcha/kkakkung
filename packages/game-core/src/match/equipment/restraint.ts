import type { ChallengeView } from '../core-types.js';
import type { MatchState, PlayerRecord } from '../state.js';

export type RestraintRelease = Readonly<{
  playerId: string;
  /** The restraint's own end tick, which is also the start of the immunity. */
  releasedAtTick: number;
  immuneUntilTick: number;
}>;

export type RestraintExpiryResult = Readonly<{
  state: MatchState;
  released: readonly RestraintRelease[];
}>;

export type RestraintLockResult = Readonly<{
  state: MatchState;
  /** The exit challenge this restraint ended, or null when there was none. */
  endedChallenge: ChallengeView | null;
}>;

/** Whether the player is inside its restraint window at `tick`. */
export function isRestrained(player: PlayerRecord, tick: number): boolean {
  return player.restraintUntilTick !== null && tick < player.restraintUntilTick;
}

/** Remaining restraint ticks, never negative. */
export function restraintRemaining(player: PlayerRecord, tick: number): number {
  if (player.restraintUntilTick === null) return 0;
  return Math.max(0, player.restraintUntilTick - tick);
}

/**
 * Natural expiry of restraints, applied as the tick's first rule stage (EQ-05).
 * A restraint whose end tick has come is cleared and the re-restraint immunity
 * starts at that same end tick, so the window is exactly 40 ticks no matter
 * which tick processes it. Clearing the restraint in the same step is what
 * keeps a later tick from extending the immunity again, and an immunity that
 * already reaches further is never shortened.
 */
export function expireRestraints(state: MatchState, tick: number): RestraintExpiryResult {
  const released: RestraintRelease[] = [];
  let players: Map<string, PlayerRecord> | null = null;
  for (const id of state.order) {
    const player = state.players.get(id)!;
    const until = player.restraintUntilTick;
    if (until === null || tick < until) continue;
    const immuneUntilTick = Math.max(
      player.restraintImmuneUntilTick ?? 0,
      until + state.tuning.restraintImmunityTicks,
    );
    players ??= new Map(state.players);
    players.set(id, {
      ...player,
      restraintUntilTick: null,
      restraintImmuneUntilTick: immuneUntilTick,
    });
    released.push({ playerId: id, releasedAtTick: until, immuneUntilTick });
  }
  if (!players) return { state, released: [] };
  return { state: { ...state, players }, released };
}

/**
 * Action locks that come with a new restraint (EQ-05). A running action and the
 * cell it already committed stay untouched; the exit challenge of the target
 * ends. Map exchanges of a restrained player are ended by the per-tick session
 * upkeep (KN-06), which reads the same restraint state.
 */
export function lockRestrainedActions(state: MatchState, playerId: string): RestraintLockResult {
  const player = state.players.get(playerId);
  if (!player || player.challenge === null) return { state, endedChallenge: null };
  const players = new Map(state.players);
  players.set(playerId, { ...player, challenge: null });
  return { state: { ...state, players }, endedChallenge: player.challenge };
}

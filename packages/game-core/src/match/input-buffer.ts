import type { PlayerRecord } from './state.js';
import type { TurnDirection } from './rotation.js';
import type { MoveDirection } from './movement.js';

/**
 * Single-slot input buffer (RL-03).
 *
 * - `heldMove` is the latest held movement intent (refreshed at 10Hz by the
 *   client). The server measures its 500ms TTL on a monotonic clock and injects
 *   `EXPIRE_MOVE {playerId, sequence}`; core never reads time.
 * - `nextAction` holds at most one single-shot turn that waits for the running
 *   action. A newer turn replaces it; no queue accumulates.
 * - When an action completes the pending turn is consumed first, then the held
 *   move (if still valid) starts a new move.
 */

/** Replaces the held move; a newer sequence always wins. */
export function holdMove(
  player: PlayerRecord,
  direction: MoveDirection,
  sequence: number,
): PlayerRecord {
  if (player.heldMove && player.heldMove.sequence > sequence) return player;
  return { ...player, heldMove: Object.freeze({ direction, sequence }) };
}

/** Stop intent: clears only the held move. The running action still completes. */
export function releaseMove(player: PlayerRecord): PlayerRecord {
  return player.heldMove === null ? player : { ...player, heldMove: null };
}

/**
 * Expires the held move when its sequence is not newer than the expired one.
 * A refresh that arrived after the expiry decision (higher sequence) survives,
 * and a started action is never rolled back.
 */
export function expireMove(player: PlayerRecord, sequence: number): PlayerRecord {
  if (!player.heldMove || player.heldMove.sequence > sequence) return player;
  return { ...player, heldMove: null };
}

/** Stores a single-shot turn in the one waiting slot, replacing any older turn. */
export function queueTurn(
  player: PlayerRecord,
  direction: TurnDirection,
  sequence: number,
): PlayerRecord {
  if (player.nextAction && player.nextAction.sequence > sequence) return player;
  return { ...player, nextAction: Object.freeze({ direction, sequence }) };
}

export function clearNextAction(player: PlayerRecord): PlayerRecord {
  return player.nextAction === null ? player : { ...player, nextAction: null };
}

/** Removes every pending intent (used when a player ends or is restrained). */
export function clearIntents(player: PlayerRecord): PlayerRecord {
  if (player.nextAction === null && player.heldMove === null) return player;
  return { ...player, nextAction: null, heldMove: null };
}

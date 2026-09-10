import type { CommandCode } from '../core-types.js';
import type { MatchState } from '../state.js';
import { endExchange, pairPresence, type ExchangeSession } from './session.js';

/** Why a session ended: a party's own cancel, the deadline, or lost conditions. */
export type ExchangeEndReason = Extract<
  CommandCode,
  'CANCELED' | 'EXPIRED' | 'NOT_ACTIVE' | 'NOT_ALLOWED'
>;

export type EndedExchange = Readonly<{ session: ExchangeSession; reason: ExchangeEndReason }>;

export type ExchangeSweepResult = Readonly<{ state: MatchState; ended: readonly EndedExchange[] }>;

export type ExchangeCancelResult =
  | Readonly<{ status: 'canceled'; session: ExchangeSession }>
  | Readonly<{ status: 'rejected'; code: CommandCode }>;

/**
 * The reason this session can no longer live at `tick`, or null while it holds.
 * The deadline is checked first so an expired session never reports a distance
 * or lock reason instead.
 */
export function endReasonOf(
  state: MatchState,
  session: ExchangeSession,
  tick: number,
): ExchangeEndReason | null {
  if (tick >= session.expiresAtTick) return 'EXPIRED';
  const from = state.players.get(session.fromPlayerId);
  const to = state.players.get(session.toPlayerId);
  if (!from || !to) return 'NOT_ALLOWED';
  const code = pairPresence(state, from, to, tick);
  if (!code) return null;
  return code === 'NOT_ACTIVE' ? 'NOT_ACTIVE' : 'NOT_ALLOWED';
}

/**
 * Ends every session whose conditions are gone: distance, personal end,
 * restraint or exit challenge, and the 2 second deadline. Each session and both
 * of its slots go at once, so no half-cleared ghost session survives, and an
 * already applied EXCHANGE_REQUEST is never settled a second time.
 */
export function sweepExchanges(state: MatchState, tick: number): ExchangeSweepResult {
  if (state.exchanges.size === 0) return { state, ended: [] };
  const ended: EndedExchange[] = [];
  let next = state;
  // Iteration follows insertion order, so the ended list is deterministic.
  for (const session of state.exchanges.values()) {
    const reason = endReasonOf(next, session, tick);
    if (!reason) continue;
    next = endExchange(next, session);
    ended.push({ session, reason });
  }
  return { state: next, ended };
}

/**
 * Explicit EXCHANGE_CANCEL (KN-06). Either party may end a live session; a
 * completed or unknown id is stale and a passed deadline is EXPIRED, both
 * without changing state. Cancelling never touches knowledge.
 */
export function cancelExchange(
  state: MatchState,
  actorId: string,
  exchangeId: string,
  tick: number,
): ExchangeCancelResult {
  const session = state.exchanges.get(exchangeId);
  if (!session) return { status: 'rejected', code: 'STALE_REQUEST' };
  if (session.fromPlayerId !== actorId && session.toPlayerId !== actorId) {
    return { status: 'rejected', code: 'NOT_ALLOWED' };
  }
  // The sweep of this same tick removes the expired session and reports it.
  if (tick >= session.expiresAtTick) return { status: 'rejected', code: 'EXPIRED' };
  return { status: 'canceled', session };
}

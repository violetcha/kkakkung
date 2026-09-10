import type { CommandCode, ExchangeView } from '../core-types.js';
import type { ExitRegistry } from '../exits/registry.js';
import { isWalkable } from '../map/validate-template.js';
import type { KnowledgeRecord, MatchState, PlayerRecord } from '../state.js';
import type { Cell } from '../types.js';

/**
 * Server-internal map exchange session (KN-05). Clients only ever receive the
 * per-recipient ExchangeView built from it, never this record.
 */
export type ExchangeSession = Readonly<{
  exchangeId: string;
  fromPlayerId: string;
  toPlayerId: string;
  requestedTick: number;
  expiresAtTick: number;
}>;

/** Open sessions keyed by exchangeId. */
export type ExchangeSessions = ReadonlyMap<string, ExchangeSession>;

export type ExchangeAcceptResult =
  | Readonly<{ status: 'verified'; session: ExchangeSession }>
  | Readonly<{ status: 'rejected'; code: CommandCode }>;

/** Same cell or an orthogonally adjacent passage cell; diagonals never qualify. */
export function inExchangeRange(state: MatchState, a: Cell, b: Cell): boolean {
  const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  if (distance > 1) return false;
  const topology = state.layout.topology;
  // Passage cells are the only placements, and adjacent passages share no wall
  // cell, so orthogonal adjacency already means a wall-free step.
  return isWalkable(topology, a) && isWalkable(topology, b);
}

function hasExtra<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  for (const value of a) if (!b.has(value)) return true;
  return false;
}

/** Discovered exit ids narrowed to the exits that are still active. */
export function activeDiscoveredExits(
  record: KnowledgeRecord,
  registry: ExitRegistry,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const exitId of record.discoveredExits) {
    if (registry.get(exitId)?.active) ids.add(exitId);
  }
  return ids;
}

/**
 * Whether either side holds terrain or active-exit knowledge the other lacks.
 * Only the union that KN-07 would merge counts: positions, movement history,
 * and closed exits never make an exchange worthwhile.
 */
export function hasNewInformation(
  a: KnowledgeRecord,
  b: KnowledgeRecord,
  registry: ExitRegistry,
): boolean {
  if (hasExtra(a.floors, b.floors) || hasExtra(b.floors, a.floors)) return true;
  if (hasExtra(a.walls, b.walls) || hasExtra(b.walls, a.walls)) return true;
  const exitsA = activeDiscoveredExits(a, registry);
  const exitsB = activeDiscoveredExits(b, registry);
  return hasExtra(exitsA, exitsB) || hasExtra(exitsB, exitsA);
}

/** A restrained runner or one inside an exit challenge cannot exchange maps. */
function isLocked(player: PlayerRecord, tick: number): boolean {
  if (player.restraintUntilTick !== null && tick < player.restraintUntilTick) return true;
  return player.challenge !== null;
}

/**
 * Conditions that must hold while a session lives: ACTIVE runners, in range,
 * neither restrained nor challenging an exit. Knowledge is deliberately not
 * part of this: a pair whose knowledge became equal keeps the session until an
 * accept decides it (KN-07), it is not swept away silently.
 */
export function pairPresence(
  state: MatchState,
  from: PlayerRecord,
  to: PlayerRecord,
  tick: number,
): CommandCode | null {
  if (from.role !== 'runner' || to.role !== 'runner') return 'NOT_ALLOWED';
  if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') return 'NOT_ACTIVE';
  if (!inExchangeRange(state, from.cell, to.cell)) return 'NOT_ALLOWED';
  if (isLocked(from, tick) || isLocked(to, tick)) return 'NOT_ALLOWED';
  return null;
}

/**
 * Conditions both parties must satisfy when a request is approved and again
 * when it is accepted: the presence conditions plus knowledge to gain.
 */
export function pairEligibility(
  state: MatchState,
  from: PlayerRecord,
  to: PlayerRecord,
  tick: number,
): CommandCode | null {
  const presence = pairPresence(state, from, to, tick);
  if (presence) return presence;
  const knowledgeFrom = state.knowledge.get(from.playerId);
  const knowledgeTo = state.knowledge.get(to.playerId);
  if (!knowledgeFrom || !knowledgeTo) return 'NOT_ALLOWED';
  if (!hasNewInformation(knowledgeFrom, knowledgeTo, state.exits)) return 'NOT_ALLOWED';
  return null;
}

/** Request eligibility: the pair conditions plus one free session slot on each side. */
export function requestEligibility(
  state: MatchState,
  actor: PlayerRecord,
  target: PlayerRecord,
  tick: number,
): CommandCode | null {
  if (actor.playerId === target.playerId) return 'NOT_ALLOWED';
  // A single slot per player: the pair approved first keeps it, and a third
  // request ends as NOT_ALLOWED instead of waiting in a queue (KN-06).
  if (actor.exchange !== null || target.exchange !== null) return 'NOT_ALLOWED';
  return pairEligibility(state, actor, target, tick);
}

export function exchangeViewFor(session: ExchangeSession, playerId: string): ExchangeView {
  return Object.freeze({
    exchangeId: session.exchangeId,
    fromPlayerId: session.fromPlayerId,
    toPlayerId: session.toPlayerId,
    direction: playerId === session.fromPlayerId ? 'outgoing' : 'incoming',
    expiresAtTick: session.expiresAtTick,
  });
}

/**
 * Reserves both slots for a new session. The request alone moves no knowledge
 * and leaves no tagger trace; `expiresAtTick` is the server tick T + 40 (2s).
 */
export function openExchange(
  state: MatchState,
  actor: PlayerRecord,
  target: PlayerRecord,
  tick: number,
): Readonly<{ state: MatchState; session: ExchangeSession }> {
  const exchangeSeq = state.exchangeSeq + 1;
  const session: ExchangeSession = Object.freeze({
    exchangeId: `xch-${exchangeSeq}`,
    fromPlayerId: actor.playerId,
    toPlayerId: target.playerId,
    requestedTick: tick,
    expiresAtTick: tick + state.tuning.exchangeExpiryTicks,
  });
  const players = new Map(state.players);
  players.set(actor.playerId, { ...actor, exchange: exchangeViewFor(session, actor.playerId) });
  players.set(target.playerId, { ...target, exchange: exchangeViewFor(session, target.playerId) });
  const exchanges = new Map(state.exchanges);
  exchanges.set(session.exchangeId, session);
  return { state: { ...state, players, exchanges, exchangeSeq }, session };
}

/**
 * Removes a session and both slots at once, so no half-cleared ghost session
 * survives. Repeated calls change nothing.
 */
export function endExchange(state: MatchState, session: ExchangeSession): MatchState {
  const exchanges = new Map(state.exchanges);
  const removed = exchanges.delete(session.exchangeId);
  const players = new Map(state.players);
  let touched = false;
  for (const playerId of [session.fromPlayerId, session.toPlayerId]) {
    const player = players.get(playerId);
    if (!player || player.exchange?.exchangeId !== session.exchangeId) continue;
    players.set(playerId, { ...player, exchange: null });
    touched = true;
  }
  if (!removed && !touched) return state;
  return { ...state, players, exchanges };
}

/**
 * Accept authorization (KN-05): only the recipient of that exchangeId, before
 * the deadline, with the pair conditions still true. A verified result is the
 * pair KN-07 merges; the id can never be accepted twice.
 */
export function verifyAccept(
  state: MatchState,
  actorId: string,
  exchangeId: string,
  tick: number,
): ExchangeAcceptResult {
  const session = state.exchanges.get(exchangeId);
  if (!session) return { status: 'rejected', code: 'STALE_REQUEST' };
  if (session.toPlayerId !== actorId) return { status: 'rejected', code: 'NOT_ALLOWED' };
  // The session itself is removed by the per-tick sweep (KN-06), not here.
  if (tick >= session.expiresAtTick) return { status: 'rejected', code: 'EXPIRED' };
  const from = state.players.get(session.fromPlayerId);
  const to = state.players.get(session.toPlayerId);
  if (!from || !to) return { status: 'rejected', code: 'NOT_ALLOWED' };
  const code = pairEligibility(state, from, to, tick);
  if (code) return { status: 'rejected', code };
  return { status: 'verified', session };
}

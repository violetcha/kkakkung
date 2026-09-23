import type { DomainEvent, MediaIntent } from './core-types.js';
import { closeExit } from './exits/registry.js';
import { countRunners } from './result.js';
import type { KnowledgeRecord, MatchState, PlayerRecord } from './state.js';

export type TerminationOutcome = 'ESCAPED' | 'CAPTURED';

type PrivateEvent = Exclude<DomainEvent, { type: 'SPATIAL_SOUND' }>;
type WithoutEventId<E> = E extends unknown ? Omit<E, 'eventId'> : never;
/**
 * S15P21C204-351. A personal event before the engine assigns its `eventId`. This module builds
 * its next state from the `state` it was handed, so an id minted through a callback that also
 * advanced the engine's `eventSeq` was lost when the engine adopted the returned state, and the
 * tick's next event reused the number. The engine now numbers the drafts after the state swap.
 */
export type EventDraft = WithoutEventId<PrivateEvent>;

export type TerminationResult = Readonly<{
  state: MatchState;
  /** True when this call changed the player from ACTIVE; false for repeats. */
  changed: boolean;
  events: readonly EventDraft[];
  mediaIntents: readonly MediaIntent[];
}>;

/**
 * Personal end of a runner (RL-07). Applies only to ACTIVE players: status and
 * counts are fixed once, the character leaves the active set (action, intents,
 * exchange, challenge cleared), the owner's exit closes, and every runner that
 * had discovered that exit sees a mapVersion bump. Match records stay; only the
 * RETIRE_PLAYER media intent is emitted (remote retirement is confirmed elsewhere).
 */
export function terminateRunner(
  state: MatchState,
  playerId: string,
  outcome: TerminationOutcome,
  tick: number,
): TerminationResult {
  const player = state.players.get(playerId);
  if (!player || player.role !== 'runner' || player.status !== 'ACTIVE') {
    return { state, changed: false, events: [], mediaIntents: [] };
  }
  const events: EventDraft[] = [];
  if (player.challenge) {
    events.push({
      tick,
      audience: [playerId],
      type: 'EXIT_CHALLENGE_ENDED',
      payload: {
        challengeId: player.challenge.challengeId,
        result: outcome === 'ESCAPED' ? 'escaped' : 'canceled',
        reason: outcome === 'ESCAPED' ? null : 'NOT_ACTIVE',
      },
    });
  }
  const ended: PlayerRecord = {
    ...player,
    status: outcome,
    action: null,
    nextAction: null,
    heldMove: null,
    exchange: null,
    challenge: null,
    installation: null,
  };
  const players = new Map(state.players);
  players.set(playerId, ended);

  const closed = closeExit(state.exits, playerId);
  let knowledge = state.knowledge;
  if (closed.closedExitId) {
    const next = new Map<string, KnowledgeRecord>();
    let touched = false;
    for (const [id, record] of state.knowledge) {
      if (record.discoveredExits.has(closed.closedExitId)) {
        next.set(id, { ...record, mapVersion: record.mapVersion + 1 });
        touched = true;
      } else next.set(id, record);
    }
    if (touched) knowledge = next;
  }

  const withPlayers: MatchState = { ...state, players, exits: closed.registry, knowledge };
  const nextState: MatchState = { ...withPlayers, counts: countRunners(withPlayers) };
  return {
    state: nextState,
    changed: true,
    events,
    mediaIntents: [{ type: 'RETIRE_PLAYER', playerId, reason: 'personal-ended' }],
  };
}

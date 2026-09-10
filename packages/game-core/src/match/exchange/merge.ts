import { activeDiscovered } from '../knowledge/exits.js';
import { unionKeys } from '../knowledge/terrain.js';
import type { KnowledgeRecord, MatchState } from '../state.js';
import type { Cell } from '../types.js';
import type { ExchangeSession } from './session.js';

export type MergedParty = Readonly<{
  playerId: string;
  mapVersion: number;
  /** True when this side actually gained public knowledge from the merge. */
  changed: boolean;
}>;

export type ExchangeMergeResult =
  | Readonly<{
      status: 'merged';
      state: MatchState;
      parties: readonly [MergedParty, MergedParty];
      /** The two authoritative cells at the success tick, material for KN-08. */
      cells: readonly [Cell, Cell];
    }>
  | Readonly<{ status: 'unchanged' }>;

/** Whether the merged union holds anything this record does not already know. */
function gains(
  record: KnowledgeRecord,
  floors: ReadonlySet<number>,
  walls: ReadonlySet<number>,
  exits: ReadonlySet<string>,
): boolean {
  // Terrain unions only grow, so a size difference is a real gain.
  if (floors.size > record.floors.size || walls.size > record.walls.size) return true;
  for (const exitId of exits) if (!record.discoveredExits.has(exitId)) return true;
  return false;
}

/**
 * Gives one side its own copy of the union. Every side gets fresh Sets, so a
 * later observation by one player never shows up in the other's memory.
 * mapVersion rises only when this side's public knowledge really changed:
 * dropping an already closed exit id changes no public result.
 */
function mergedRecord(
  record: KnowledgeRecord,
  floors: ReadonlySet<number>,
  walls: ReadonlySet<number>,
  exits: ReadonlySet<string>,
  changed: boolean,
): KnowledgeRecord {
  return {
    floors: new Set(floors),
    walls: new Set(walls),
    discoveredExits: new Set(exits),
    mapVersion: changed ? record.mapVersion + 1 : record.mapVersion,
  };
}

/**
 * Map merge of an accepted exchange (KN-07). Unions the two terrain memories
 * and the discovered exit ids, filtering the exit union through the active
 * registry so a closed exit is never restored. Positions, movement history,
 * and tagger observations are not part of the merge. Returns `unchanged` when
 * both sides already knew everything, so the caller can end the session
 * without touching knowledge or leaving a trace.
 */
export function mergeKnowledge(state: MatchState, session: ExchangeSession): ExchangeMergeResult {
  const from = state.players.get(session.fromPlayerId);
  const to = state.players.get(session.toPlayerId);
  if (!from || !to) return { status: 'unchanged' };
  const recordFrom = state.knowledge.get(from.playerId);
  const recordTo = state.knowledge.get(to.playerId);
  if (!recordFrom || !recordTo) return { status: 'unchanged' };

  const floors = unionKeys(recordFrom.floors, recordTo.floors);
  const walls = unionKeys(recordFrom.walls, recordTo.walls);
  const exits = activeDiscovered(recordFrom, state.exits);
  for (const exitId of activeDiscovered(recordTo, state.exits)) exits.add(exitId);

  const changedFrom = gains(recordFrom, floors, walls, exits);
  const changedTo = gains(recordTo, floors, walls, exits);
  if (!changedFrom && !changedTo) return { status: 'unchanged' };

  const knowledge = new Map(state.knowledge);
  knowledge.set(from.playerId, mergedRecord(recordFrom, floors, walls, exits, changedFrom));
  knowledge.set(to.playerId, mergedRecord(recordTo, floors, walls, exits, changedTo));
  return {
    status: 'merged',
    state: { ...state, knowledge },
    parties: [
      {
        playerId: from.playerId,
        mapVersion: knowledge.get(from.playerId)!.mapVersion,
        changed: changedFrom,
      },
      {
        playerId: to.playerId,
        mapVersion: knowledge.get(to.playerId)!.mapVersion,
        changed: changedTo,
      },
    ],
    cells: [
      { x: from.cell.x, y: from.cell.y },
      { x: to.cell.x, y: to.cell.y },
    ],
  };
}

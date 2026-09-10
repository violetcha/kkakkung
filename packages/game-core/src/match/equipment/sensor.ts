import { sameCell } from '../map/validate-template.js';
import type { CompletedMove } from '../movement.js';
import type { MatchState } from '../state.js';
import type { Cell } from '../types.js';

export type SensorTrigger = Readonly<{
  equipmentId: string;
  ownerId: string;
  /** The approach cell the runners entered: the only position ever published. */
  cell: Cell;
  /**
   * Candidates that entered on this tick, sorted by id. Internal only: neither
   * the representative nor the list reaches a tagger event.
   */
  candidateIds: readonly string[];
}>;

/** New entry means a completed move that changed cell and ended on the sensor cell. */
function newEntries(
  state: MatchState,
  moves: readonly CompletedMove[],
  cell: Cell,
): readonly string[] {
  const entered: string[] = [];
  for (const move of moves) {
    if (sameCell(move.from, move.to) || !sameCell(move.to, cell)) continue;
    const player = state.players.get(move.playerId);
    // Re-checked after the capture stage: an ended runner is no candidate.
    if (!player || player.role !== 'runner' || player.status !== 'ACTIVE') continue;
    entered.push(move.playerId);
  }
  return entered.sort();
}

/**
 * Sensors that fire on this tick (EQ-02). A sensor fires when at least one
 * ACTIVE runner newly entered its approach cell: standing there when the device
 * armed is not an entry, and restraint immunity is no exemption from detection.
 * Only ARMED devices are considered, so each one fires at most once.
 */
export function sensorTriggers(
  state: MatchState,
  moves: readonly CompletedMove[],
): readonly SensorTrigger[] {
  if (moves.length === 0) return [];
  const triggers: SensorTrigger[] = [];
  for (const ownerId of state.order) {
    for (const owned of state.players.get(ownerId)!.ownedEquipment) {
      if (owned.kind !== 'sensor' || owned.state !== 'ARMED') continue;
      const candidateIds = newEntries(state, moves, owned.cell);
      if (candidateIds.length === 0) continue;
      triggers.push({
        equipmentId: owned.equipmentId,
        ownerId,
        cell: owned.cell,
        candidateIds,
      });
    }
  }
  return triggers;
}

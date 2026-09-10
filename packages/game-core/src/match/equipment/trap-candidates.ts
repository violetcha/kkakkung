import { sameCell } from '../map/validate-template.js';
import type { CompletedMove } from '../movement.js';
import type { MatchState, PlayerRecord } from '../state.js';
import type { Cell } from '../types.js';

export type TrapCandidates = Readonly<{
  equipmentId: string;
  ownerId: string;
  cell: Cell;
  /**
   * Runners eligible for a new restraint on this tick. A Set, so the consumer
   * (EQ-04) cannot depend on collection order for its target choice.
   */
  candidateIds: ReadonlySet<string>;
}>;

/**
 * Whether a runner may be restrained again at `tick`. Both boundaries are
 * exclusive on the far end: a restraint or immunity whose end tick equals the
 * current tick has already been refreshed in the tick's first stage, so the
 * runner counts as free again.
 */
export function isRestraintEligible(player: PlayerRecord, tick: number): boolean {
  if (player.restraintUntilTick !== null && tick < player.restraintUntilTick) return false;
  if (player.restraintImmuneUntilTick !== null && tick < player.restraintImmuneUntilTick) {
    return false;
  }
  return true;
}

/**
 * Runners that newly entered a trap cell on this tick (EQ-03). Only ARMED
 * traps are inspected and only moves that actually changed cell count, so
 * standing on the device - including the tick an immunity runs out - is never
 * an entry. Occupying the cell while the trap was installed or armed creates no
 * permanent exemption: leaving and entering again is re-checked on the state of
 * that moment. This function returns candidates only; choosing the target and
 * spending the device belong to EQ-04.
 */
export function trapCandidates(
  state: MatchState,
  moves: readonly CompletedMove[],
  tick: number,
): readonly TrapCandidates[] {
  if (moves.length === 0) return [];
  const found: TrapCandidates[] = [];
  for (const ownerId of state.order) {
    for (const owned of state.players.get(ownerId)!.ownedEquipment) {
      if (owned.kind !== 'trap' || owned.state !== 'ARMED') continue;
      const candidateIds = new Set<string>();
      for (const move of moves) {
        if (sameCell(move.from, move.to) || !sameCell(move.to, owned.cell)) continue;
        const player = state.players.get(move.playerId);
        // Re-checked after the capture stage: an ended runner is no candidate.
        if (!player || player.role !== 'runner' || player.status !== 'ACTIVE') continue;
        if (!isRestraintEligible(player, tick)) continue;
        candidateIds.add(move.playerId);
      }
      if (candidateIds.size === 0) continue;
      found.push({ equipmentId: owned.equipmentId, ownerId, cell: owned.cell, candidateIds });
    }
  }
  return found;
}

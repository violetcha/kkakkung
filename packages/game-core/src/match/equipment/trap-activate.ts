import { selectPriorityCandidate } from '../priority.js';
import type { CompletedMove } from '../movement.js';
import type { MatchState, PlayerRecord } from '../state.js';
import type { Cell } from '../types.js';
import { trapCandidates } from './trap-candidates.js';

export type TrapActivation = Readonly<{
  equipmentId: string;
  ownerId: string;
  /** The trap's floor cell: the only position published to the taggers. */
  cell: Cell;
  /** Internal only. The chosen runner never appears in a tagger event. */
  targetId: string;
  restrainedUntilTick: number;
}>;

export type TrapActivationResult = Readonly<{
  state: MatchState;
  activations: readonly TrapActivation[];
}>;

/**
 * Trap activation (EQ-04). Every eligible candidate of EQ-03 goes through the
 * common per-tick priority (RL-05) and exactly one is restrained: the filter
 * runs before the choice, so a candidate is never lost to an immune runner
 * winning the order first. The device becomes SPENT and the target's restraint
 * is written in the same state, so a spent device can never pick anyone again
 * and the collection order of candidates cannot change the result.
 */
export function activateTraps(
  state: MatchState,
  moves: readonly CompletedMove[],
  tick: number,
): TrapActivationResult {
  if (!state.priority || state.startTick === null) return { state, activations: [] };
  const found = trapCandidates(state, moves, tick);
  if (found.length === 0) return { state, activations: [] };
  const activations: TrapActivation[] = [];
  const players = new Map(state.players);
  const restrainedUntilTick = tick + state.tuning.restraintTicks;
  for (const trap of found) {
    const targetId = selectPriorityCandidate(
      state.priority,
      tick,
      state.startTick,
      trap.candidateIds,
    );
    if (targetId === undefined) continue;
    const owner = players.get(trap.ownerId);
    const target = players.get(targetId);
    if (!owner || !target) continue;
    const device = owner.ownedEquipment.find((e) => e.equipmentId === trap.equipmentId);
    if (!device || device.state !== 'ARMED') continue;
    const spent: PlayerRecord = {
      ...owner,
      ownedEquipment: Object.freeze(
        owner.ownedEquipment.map((e) =>
          e.equipmentId === trap.equipmentId ? Object.freeze({ ...e, state: 'SPENT' as const }) : e,
        ),
      ),
    };
    players.set(trap.ownerId, spent);
    // The restraint lives on the player, not on the device.
    players.set(targetId, { ...target, restraintUntilTick: restrainedUntilTick });
    activations.push({
      equipmentId: trap.equipmentId,
      ownerId: trap.ownerId,
      cell: trap.cell,
      targetId,
      restrainedUntilTick,
    });
  }
  if (activations.length === 0) return { state, activations: [] };
  return { state: { ...state, players }, activations };
}

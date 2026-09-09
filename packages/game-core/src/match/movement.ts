import type { Action } from './core-types.js';
import { DIR_VECTORS, isWalkable } from './map/validate-template.js';
import type { PlayerRecord } from './state.js';
import type { Cell, Dir, Topology } from './types.js';

export type MoveDirection = 'forward' | 'back';

/** Target cell for one step in the facing direction (or its reverse), or null when blocked. */
export function moveTarget(
  topology: Topology,
  cell: Cell,
  dir: Dir,
  direction: MoveDirection,
): Cell | null {
  const vector = DIR_VECTORS[dir];
  const sign = direction === 'forward' ? 1 : -1;
  const target = { x: cell.x + vector.dx * sign, y: cell.y + vector.dy * sign };
  return isWalkable(topology, target) ? target : null;
}

/** A player can start a new action only when ACTIVE, idle, and not restrained. */
export function canStartAction(player: PlayerRecord, tick: number): boolean {
  if (player.status !== 'ACTIVE' || player.action !== null) return false;
  if (player.restraintUntilTick !== null && tick < player.restraintUntilTick) return false;
  return true;
}

/**
 * Reserves a one-cell move as a `moveTicks` action starting at `tick`. The
 * current cell stays until completion. Returns null when the target is a wall
 * or outside the grid; same-team occupancy never blocks a move.
 */
export function reserveMove(
  topology: Topology,
  player: PlayerRecord,
  direction: MoveDirection,
  tick: number,
  moveTicks: number,
): PlayerRecord | null {
  const target = moveTarget(topology, player.cell, player.dir, direction);
  if (!target) return null;
  const action: Action = Object.freeze({
    kind: 'move',
    from: Object.freeze({ x: player.cell.x, y: player.cell.y, dir: player.dir }),
    to: Object.freeze({ x: target.x, y: target.y, dir: player.dir }),
    startTick: tick,
    endTick: tick + moveTicks,
  });
  return { ...player, action };
}

export type CompletedMove = Readonly<{ playerId: string; from: Cell; to: Cell }>;

export type CompletionResult = Readonly<{
  players: readonly PlayerRecord[];
  completedMoves: readonly CompletedMove[];
}>;

/**
 * Completes every action whose endTick has been reached, computed from the
 * previous state only (no player reads another's freshly updated cell). Each
 * action completes exactly once because completion clears it.
 */
export function completeActions(players: Iterable<PlayerRecord>, tick: number): CompletionResult {
  const updated: PlayerRecord[] = [];
  const completedMoves: CompletedMove[] = [];
  for (const player of players) {
    const action = player.action;
    if (!action || action.endTick > tick) continue;
    if (action.kind === 'move') {
      completedMoves.push({
        playerId: player.playerId,
        from: player.cell,
        to: { x: action.to.x, y: action.to.y },
      });
    }
    updated.push({
      ...player,
      cell: { x: action.to.x, y: action.to.y },
      dir: action.to.dir,
      action: null,
    });
  }
  return { players: updated, completedMoves };
}

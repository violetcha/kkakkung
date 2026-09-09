import type { Action } from './core-types.js';
import type { PlayerRecord } from './state.js';
import type { Dir } from './types.js';

export type TurnDirection = 'left' | 'right';

/** Left is -1 (mod 4), right is +1. 3 -> 0 on a right turn is a plain 90 degree step. */
export function turnDir(dir: Dir, direction: TurnDirection): Dir {
  return ((dir + (direction === 'right' ? 1 : 3)) % 4) as Dir;
}

/**
 * Reserves a 90 degree turn as a `turnTicks` action on the same cell. The
 * logical direction commits only at endTick; a turn never runs concurrently
 * with a move because both occupy the single `action` slot.
 */
export function reserveTurn(
  player: PlayerRecord,
  direction: TurnDirection,
  tick: number,
  turnTicks: number,
): PlayerRecord {
  const action: Action = Object.freeze({
    kind: 'turn',
    from: Object.freeze({ x: player.cell.x, y: player.cell.y, dir: player.dir }),
    to: Object.freeze({ x: player.cell.x, y: player.cell.y, dir: turnDir(player.dir, direction) }),
    startTick: tick,
    endTick: tick + turnTicks,
  });
  return { ...player, action };
}

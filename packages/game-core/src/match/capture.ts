import { sameCell } from './map/validate-template.js';
import { moveTarget } from './movement.js';
import type { PlayerRecord } from './state.js';
import type { Topology } from './types.js';

/**
 * Contact and crossing capture (RL-04). Computed once per tick from the cells
 * before completion (`before`) and after all completions (`after`); no player is
 * evaluated against another player's partially updated position.
 *
 * A runner is captured when, after completion, a tagger with an active grab window
 * shares its cell, when the runner and that tagger swapped cells in the same tick,
 * or when the runner is one walkable cell directly in front of the tagger. Side,
 * diagonal, behind, or wall-separated players never capture; teammates never capture.
 * Each runner appears at most once regardless of how many taggers touched it.
 */
export function detectCaptures(
  before: ReadonlyMap<string, PlayerRecord>,
  after: ReadonlyMap<string, PlayerRecord>,
  topology: Topology,
  tick: number,
): readonly string[] {
  const taggers: PlayerRecord[] = [];
  const runners: PlayerRecord[] = [];
  for (const player of after.values()) {
    if (player.status !== 'ACTIVE') continue;
    if (player.role === 'tagger') {
      if (player.grabUntilTick !== null && tick < player.grabUntilTick) taggers.push(player);
    } else {
      runners.push(player);
    }
  }
  const captured = new Set<string>();
  for (const runner of runners) {
    const runnerBefore = before.get(runner.playerId);
    for (const tagger of taggers) {
      const taggerBefore = before.get(tagger.playerId);
      const contact = sameCell(runner.cell, tagger.cell);
      const crossed =
        runnerBefore !== undefined &&
        taggerBefore !== undefined &&
        sameCell(runner.cell, taggerBefore.cell) &&
        sameCell(tagger.cell, runnerBefore.cell);
      const front = moveTarget(topology, tagger.cell, tagger.dir, 'forward');
      const inReach = front !== null && sameCell(runner.cell, front);
      if (contact || crossed || inReach) {
        captured.add(runner.playerId);
        break;
      }
    }
  }
  return [...captured].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

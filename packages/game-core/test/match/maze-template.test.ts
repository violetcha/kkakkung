import { describe, expect, it } from 'vitest';

import { analyzeTemplate } from '../../src/match/map/validate-connectivity.js';
import { approachOf, isWalkable, passageNeighbors } from '../../src/match/map/validate-template.js';
import type { Cell } from '../../src/match/types.js';
import { certifiedTemplate } from './helpers.js';

/**
 * S15P21C204-267. Structural promises of the corridor maze that the generic validators do not
 * make: corridors are exactly one cell wide, there are no dead ends, and the whole passage graph
 * is one biconnected core. A regenerated file that breaks any of these is not maze-v1 any more.
 */
const template = certifiedTemplate('maze-v1');
const { topology } = template;
const isJunction = (cell: Cell) => cell.x % 2 === 1 && cell.y % 2 === 1;

function passages(): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < topology.height; y += 1) {
    for (let x = 0; x < topology.width; x += 1) {
      if (isWalkable(topology, { x, y })) cells.push({ x, y });
    }
  }
  return cells;
}

describe('maze-v1 corridor structure', () => {
  it('is a 31×31 odd lattice: junctions at odd coordinates, connectors between them', () => {
    expect(topology.width).toBe(31);
    expect(topology.height).toBe(31);
    for (const cell of passages()) {
      // An even/even cell is always a pillar, so no 2×2 block of floor can exist.
      expect(cell.x % 2 === 1 || cell.y % 2 === 1, `${cell.x},${cell.y}`).toBe(true);
    }
    for (let y = 1; y < 30; y += 2) {
      for (let x = 1; x < 30; x += 2) expect(isWalkable(topology, { x, y })).toBe(true);
    }
  });

  it('has corridors one cell wide everywhere', () => {
    for (const cell of passages()) {
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
      ] as const) {
        const block = [
          cell,
          { x: cell.x + dx, y: cell.y },
          { x: cell.x, y: cell.y + dy },
          { x: cell.x + dx, y: cell.y + dy },
        ];
        expect(
          block.every((c) => isWalkable(topology, c)),
          `block at ${cell.x},${cell.y}`,
        ).toBe(false);
      }
    }
  });

  it('has no dead ends and no articulation points: every passage is in the single core', () => {
    for (const cell of passages()) {
      expect(passageNeighbors(topology, cell).length, `${cell.x},${cell.y}`).toBeGreaterThanOrEqual(
        2,
      );
    }
    const { graph, biconnected } = analyzeTemplate(template);
    expect(biconnected.articulationPoints.size).toBe(0);
    expect(biconnected.coreIndex).toBeGreaterThanOrEqual(0);
    expect(biconnected.components[biconnected.coreIndex]!.size).toBe(graph.nodes.length);
  });

  it('keeps enough loops to be a braid, not a single ring', () => {
    const cells = passages();
    const edges = cells.reduce((sum, cell) => sum + passageNeighbors(topology, cell).length, 0) / 2;
    const cycles = edges - cells.length + 1;
    expect(cycles).toBeGreaterThanOrEqual(12);
  });
});

describe('maze-v1 placement data', () => {
  it('spawns only on junctions, in three disjoint tagger bands and three runner corners', () => {
    const seen = new Set<string>();
    for (const region of [...template.taggerRegions, ...template.runnerSpawnRegions]) {
      expect(region.spawnCandidates.length).toBeGreaterThanOrEqual(12);
      for (const cell of region.spawnCandidates) expect(isJunction(cell)).toBe(true);
      for (const cell of region.cells) {
        const key = `${cell.x},${cell.y}`;
        expect(seen.has(key), `region overlap at ${key}`).toBe(false);
        seen.add(key);
      }
    }
    expect(template.taggerRegions.map((r) => r.regionId).sort()).toEqual([
      'tagger-center',
      'tagger-east',
      'tagger-west',
    ]);
    expect(template.runnerSpawnRegions.map((r) => r.regionId).sort()).toEqual([
      'runner-northeast',
      'runner-northwest',
      'runner-south',
    ]);
  });

  it('offers exits only on faces whose approach is a junction, so an exit never plugs a corridor', () => {
    expect(template.exitCandidates.length).toBeGreaterThanOrEqual(200);
    for (const face of template.exitCandidates) {
      expect(isWalkable(topology, face)).toBe(false);
      expect(isJunction(approachOf(face)), `${face.x},${face.y},${face.side}`).toBe(true);
    }
  });
});

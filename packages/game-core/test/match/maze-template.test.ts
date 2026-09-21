import { describe, expect, it } from 'vitest';

import { analyzeTemplate } from '../../src/match/map/validate-connectivity.js';
import { approachOf, isWalkable, passageNeighbors } from '../../src/match/map/validate-template.js';
import type { Cell, Topology } from '../../src/match/types.js';
import { certifiedTemplate } from './helpers.js';

/**
 * S15P21C204-267. Structural promises of the corridor maze that the generic validators do not
 * make: corridors are exactly one cell wide, there are no dead ends, and the whole passage graph
 * is one biconnected core. A regenerated file that breaks any of these is not the same maze any
 * more.
 *
 * S15P21C204-321 added the two smaller grids the lobby can pick. The promises hold at every size;
 * only the counts that follow from the grid differ, and those are written per maze so a shrunken
 * map cannot quietly pass a floor meant for the big one.
 */
const MAZES = [
  { id: 'maze-s-v1', size: 15, minCycles: 6, minSpawn: 2, minExits: 50 },
  { id: 'maze-m-v1', size: 23, minCycles: 10, minSpawn: 4, minExits: 150 },
  { id: 'maze-v1', size: 31, minCycles: 12, minSpawn: 12, minExits: 200 },
] as const;

const isJunction = (cell: Cell) => cell.x % 2 === 1 && cell.y % 2 === 1;

function passages(topology: Topology): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < topology.height; y += 1) {
    for (let x = 0; x < topology.width; x += 1) {
      if (isWalkable(topology, { x, y })) cells.push({ x, y });
    }
  }
  return cells;
}

describe.each(MAZES)('$id corridor structure', ({ id, size, minCycles }) => {
  const template = certifiedTemplate(id);
  const { topology } = template;

  it('is an odd lattice: junctions at odd coordinates, connectors between them', () => {
    expect(topology.width).toBe(size);
    expect(topology.height).toBe(size);
    for (const cell of passages(topology)) {
      // An even/even cell is always a pillar, so no 2×2 block of floor can exist.
      expect(cell.x % 2 === 1 || cell.y % 2 === 1, `${cell.x},${cell.y}`).toBe(true);
    }
    for (let y = 1; y < size - 1; y += 2) {
      for (let x = 1; x < size - 1; x += 2) expect(isWalkable(topology, { x, y })).toBe(true);
    }
  });

  it('has corridors one cell wide everywhere', () => {
    for (const cell of passages(topology)) {
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
    for (const cell of passages(topology)) {
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
    const cells = passages(topology);
    const edges = cells.reduce((sum, cell) => sum + passageNeighbors(topology, cell).length, 0) / 2;
    const cycles = edges - cells.length + 1;
    expect(cycles).toBeGreaterThanOrEqual(minCycles);
  });
});

describe.each(MAZES)('$id placement data', ({ id, minSpawn, minExits }) => {
  const template = certifiedTemplate(id);
  const { topology } = template;

  it('spawns only on junctions, in three disjoint tagger bands and three runner corners', () => {
    const seen = new Set<string>();
    for (const region of [...template.taggerRegions, ...template.runnerSpawnRegions]) {
      expect(region.spawnCandidates.length, region.regionId).toBeGreaterThanOrEqual(minSpawn);
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
    expect(template.exitCandidates.length).toBeGreaterThanOrEqual(minExits);
    for (const face of template.exitCandidates) {
      expect(isWalkable(topology, face)).toBe(false);
      expect(isJunction(approachOf(face)), `${face.x},${face.y},${face.side}`).toBe(true);
    }
  });
});

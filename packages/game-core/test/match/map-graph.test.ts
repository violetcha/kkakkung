import { describe, expect, it } from 'vitest';

import {
  UNREACHABLE,
  biconnectedComponents,
  buildGraph,
  distance,
  distanceMatrix,
  facesPassage,
  hasMinPassageNeighbors,
  isConnected,
  isInCore,
} from '../../src/match/map/graph.js';
import { validateConnectivity } from '../../src/match/map/validate-connectivity.js';
import type { Topology } from '../../src/match/types.js';
import { masterTemplate } from './helpers.js';

function topologyFromRows(rows: readonly string[]): Topology {
  const height = rows.length;
  const width = rows[0]!.length;
  const walkable: boolean[] = [];
  for (const row of rows) for (const ch of row) walkable.push(ch === '.');
  return { topologyVersion: 'test', width, height, walkable };
}

describe('passage graph distances', () => {
  const rows = [
    '########',
    '#......#',
    '#.####.#',
    '#.#..#.#',
    '#.#..#.#',
    '#.####.#',
    '#......#',
    '########',
  ];
  const graph = buildGraph(topologyFromRows(rows));

  it('connects only orthogonal passage neighbors and counts moves, not cells', () => {
    expect(distance(graph, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(1);
    expect(distance(graph, { x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
    // Around the ring from top-left to bottom-right: 5 + 5 moves either way.
    expect(distance(graph, { x: 1, y: 1 }, { x: 6, y: 6 })).toBe(10);
    // No diagonal shortcut across the corner.
    expect(distance(graph, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(UNREACHABLE);
  });

  it('reports the island in the middle as unreachable and the graph as disconnected', () => {
    expect(isConnected(graph)).toBe(false);
    expect(distance(graph, { x: 1, y: 1 }, { x: 3, y: 3 })).toBe(UNREACHABLE);
    expect(distance(graph, { x: 1, y: 1 }, { x: 0, y: 0 })).toBe(UNREACHABLE);
    const matrix = distanceMatrix(graph, [
      { x: 1, y: 1 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
    expect(matrix[0]).toEqual([0, UNREACHABLE, UNREACHABLE]);
    expect(matrix[1]).toEqual([UNREACHABLE, 0, 2]);
  });
});

describe('biconnected core', () => {
  it('marks a dead-end branch behind an articulation point as outside the core', () => {
    // Open room x=1..6, y=1..5 with a single-width corridor spur (7,3)..(10,3) that dead-ends.
    const stubRows = [
      '############',
      '#......#####',
      '#......#####',
      '#..........#',
      '#......#####',
      '#......#####',
      '############',
    ];
    const topology = topologyFromRows(stubRows);
    const graph = buildGraph(topology);
    expect(isConnected(graph)).toBe(true);
    const analysis = biconnectedComponents(graph);
    expect(isInCore(graph, analysis, { x: 8, y: 3 })).toBe(false);
    expect(isInCore(graph, analysis, { x: 10, y: 3 })).toBe(false);
    expect(isInCore(graph, analysis, { x: 2, y: 2 })).toBe(true);
    // The junction cell is an articulation point and still belongs to the core.
    expect(isInCore(graph, analysis, { x: 6, y: 3 })).toBe(true);
    expect(analysis.articulationPoints.has(3 * 12 + 6)).toBe(true);
    expect(analysis.articulationPoints.has(3 * 12 + 8)).toBe(true);
    expect(analysis.components[analysis.coreIndex]!.size).toBe(30);
  });

  it('treats the master as one connected core with all candidates and approaches inside it', () => {
    const template = masterTemplate();
    const report = validateConnectivity(template);
    expect(report.connected).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.passageCount).toBe(report.coreSize);
    expect(report.articulationCount).toBe(0);
  });

  it('fails the core check when an exit approach sits behind a dead-end branch', () => {
    const template = masterTemplate();
    // Carve a dead-end corridor into the west inner wall at (6,10): make (6,10) a passage
    // reached only from (7,10)? That would join two open areas. Instead build a synthetic
    // template: a pocket cell (30,29) whose only neighbor is (30,30)... use topology edit.
    const walkable = [...template.topology.walkable];
    const w = template.topology.width;
    // Close (29,29),(29,30),(30,28) so that (30,29) and (30,30) form a dead-end spur
    // hanging off (30,29)->? Simpler: isolate (30,30) so its only neighbor is (30,29),
    // and (30,29)'s only other neighbor is (29,29).
    walkable[30 * w + 29] = false; // (29,30) wall
    walkable[28 * w + 30] = false; // (30,28) wall
    const spurTopology = { ...template.topology, walkable };
    const spurTemplate = {
      ...template,
      topology: spurTopology,
      exitCandidates: [
        ...template.exitCandidates,
        // wall (29,30) with east face -> approach (30,30), which is a dead end.
        { x: 29, y: 30, side: 1 as const },
      ],
    };
    const report = validateConnectivity(spurTemplate);
    expect(report.connected).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({
      code: 'EXIT_APPROACH_NOT_CORE',
      face: { x: 29, y: 30, side: 1 },
    });
  });

  it('flags a template with a disconnected island', () => {
    const template = masterTemplate();
    const walkable = [...template.topology.walkable];
    const w = template.topology.width;
    // Wall off (2,2) from all four sides -> single-cell island.
    for (const [x, y] of [
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
    ] as const) {
      walkable[y * w + x] = false;
    }
    const report = validateConnectivity({
      ...template,
      topology: { ...template.topology, walkable },
    });
    expect(report.connected).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('DISCONNECTED');
  });
});

describe('start predicates', () => {
  const rows = ['#######', '#.....#', '#.###.#', '#.#...#', '#.....#', '#######'];
  const topology = topologyFromRows(rows);

  it('separates the neighbor count from the initial facing check', () => {
    // (1,3) has neighbors (1,2) and (1,4): two neighbors, but east is a wall.
    expect(hasMinPassageNeighbors(topology, { x: 1, y: 3 }, 2)).toBe(true);
    expect(facesPassage(topology, { x: 1, y: 3 }, 1)).toBe(false);
    expect(facesPassage(topology, { x: 1, y: 3 }, 0)).toBe(true);
    expect(facesPassage(topology, { x: 1, y: 3 }, 2)).toBe(true);
    // (3,3) is a corridor cell with neighbors east/west only? (3,2) wall, (3,4) passage.
    expect(hasMinPassageNeighbors(topology, { x: 3, y: 3 }, 3)).toBe(false);
  });
});

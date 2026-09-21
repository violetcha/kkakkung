import { describe, expect, it } from 'vitest';

import { getVisibleEntities, getVisibleSurfaces } from '../../src/match/engine.js';
import { segmentClear } from '../../src/match/vision/raycast.js';
import { cameraFor, computeVisibility } from '../../src/match/vision/visibility.js';
import type { Topology } from '../../src/match/types.js';
import { command, player, startedMatch, step } from './match-fixture.js';

function topologyFromRows(rows: readonly string[]): Topology {
  const walkable: boolean[] = [];
  for (const row of rows) for (const ch of row) walkable.push(ch === '.');
  return { topologyVersion: 'test', width: rows[0]!.length, height: rows.length, walkable };
}

const has = (list: readonly { x: number; y: number }[], x: number, y: number) =>
  list.some((c) => c.x === x && c.y === y);
const hasFace = (
  list: readonly { x: number; y: number; side: number }[],
  x: number,
  y: number,
  side: number,
) => list.some((f) => f.x === x && f.y === y && f.side === side);

describe('wall face observation', () => {
  it('standing south of a wall facing north reveals only that south face, not the north face or cells behind', () => {
    // Row 2 is a solid inner wall between two corridors.
    const topology = topologyFromRows([
      '#########',
      '#.......#',
      '#########',
      '#.......#',
      '#########',
    ]);
    const surfaces = computeVisibility(topology, { x: 4.5, y: 3.5, heading: { x: 0, y: -1 } });
    expect(hasFace(surfaces.visibleWallFaces, 4, 2, 2)).toBe(true); // south face of wall (4,2)
    expect(hasFace(surfaces.visibleWallFaces, 4, 2, 0)).toBe(false); // north face is behind the wall
    expect(has(surfaces.visibleCells, 4, 1)).toBe(false); // corridor behind the wall
    expect(has(surfaces.visibleCells, 4, 3)).toBe(true); // own cell
    expect(surfaces.visibleWallFaces.every((f) => f.y === 2 || f.y === 4)).toBe(true);
  });

  it('applies the 40 degree horizontal boundary within the five cell range', () => {
    const topology = topologyFromRows(
      Array.from({ length: 12 }, (_, y) => (y === 0 || y === 11 ? '############' : '#..........#')),
    );
    const surfaces = computeVisibility(topology, { x: 5.5, y: 8.5, heading: { x: 0, y: -1 } });
    // Straight ahead: 5 cells (y=7..3) visible; (5,3) sits at exactly 5.0 and (5,2) is past it.
    expect(has(surfaces.visibleCells, 5, 3)).toBe(true);
    expect(has(surfaces.visibleCells, 5, 2)).toBe(false);
    // (7,6): center offset (2, -2.5) -> ~38.7 degrees from the heading -> visible.
    expect(has(surfaces.visibleCells, 7, 6)).toBe(true);
    // (8,7): center offset (3, -1.5) -> ~63 degrees -> outside the cone; even its corners are > 40.
    expect(has(surfaces.visibleCells, 8, 7)).toBe(false);
    // Nothing behind the camera.
    expect(has(surfaces.visibleCells, 5, 10)).toBe(false);
  });

  it('shows only the cells and faces that pass a sample while turning around a corner, deterministically', () => {
    const topology = topologyFromRows([
      '########',
      '#......#',
      '#.####.#',
      '#.#....#',
      '#.######',
      '########',
    ]);
    // Camera at (1,3) mid-turn from north toward east (45 degrees).
    const cam = { x: 1.5, y: 3.5, heading: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } };
    const a = computeVisibility(topology, cam);
    const b = computeVisibility(topology, cam);
    expect(a).toEqual(b);
    // The corridor going north (1,2),(1,1) is partially inside the cone; the wall (2,3) east face is hidden behind (2,3) itself.
    expect(has(a.visibleCells, 1, 2)).toBe(true);
    expect(has(a.visibleCells, 3, 3)).toBe(false); // behind wall (2,3)
    expect(hasFace(a.visibleWallFaces, 2, 3, 3)).toBe(true); // west face of wall (2,3) faces the camera
    expect(hasFace(a.visibleWallFaces, 2, 3, 1)).toBe(false); // its east face never
  });

  it('does not leak through a diagonal gap between two walls', () => {
    const topology = topologyFromRows(['#######', '#..#..#', '#.#...#', '#.....#', '#######']);
    // From (1,1) looking toward (4,2): the ray passes the vertex shared by walls (3,1) and (2,2).
    expect(segmentClear(topology, { x: 1.5, y: 1.5 }, { x: 3.5, y: 3.5 })).toBe(false);
    // A straight clear ray still passes.
    expect(segmentClear(topology, { x: 1.5, y: 3.5 }, { x: 5.5, y: 3.5 })).toBe(true);
  });
});

describe('camera interpolation', () => {
  it('interpolates position along a move and heading along a turn', () => {
    const start = startedMatch(100);
    const moving = step(start, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]).state;
    const p = player(moving, 'r-a');
    expect(cameraFor(p, 101)).toEqual({ x: 2.5, y: 2.5, heading: { x: 0, y: -1 } });
    const mid = cameraFor(p, 105.5);
    expect(mid.y).toBeCloseTo(3.0, 5);
    expect(cameraFor(p, 110).y).toBeCloseTo(3.5, 5);
    const turning = step(start, 101, [command('r-a', 'TURN', { direction: 'right' })]).state;
    const halfway = cameraFor(player(turning, 'r-a'), 104);
    expect(halfway.heading.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(halfway.heading.y).toBeCloseTo(-Math.SQRT1_2, 5);
    // 3 -> 0 sweeps 90 degrees, never 270.
    const west = {
      ...player(start, 'r-a'),
      dir: 3 as const,
      action: {
        kind: 'turn' as const,
        from: { x: 2, y: 2, dir: 3 as const },
        to: { x: 2, y: 2, dir: 0 as const },
        startTick: 100,
        endTick: 106,
      },
    };
    const sweep = cameraFor(west, 103);
    expect(sweep.heading.x).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(sweep.heading.y).toBeCloseTo(-Math.SQRT1_2, 5);
  });
});

describe('engine integration', () => {
  it('stores per-player masks each tick and filters visible players through the same mask', () => {
    const start = startedMatch(100);
    const own = getVisibleSurfaces(start, 'r-a');
    expect(has(own.visibleCells, 2, 2)).toBe(true);
    expect(has(own.visibleCells, 2, 1)).toBe(true); // north of (2,2)
    expect(hasFace(own.visibleWallFaces, 2, 0, 2)).toBe(true); // outer wall south face ahead
    expect(getVisibleEntities(start, 'r-a')).toEqual([]);
    // Put t-a right in front of r-a and confirm the entity carries a wall-free player shape.
    const players = new Map(start.players);
    players.set('t-a', { ...player(start, 't-a'), cell: { x: 2, y: 1 }, dir: 2 });
    const near = step({ ...start, players }, 101);
    const entities = getVisibleEntities(near.state, 'r-a');
    expect(entities).toEqual([
      { id: 't-a', kind: 'player', cell: { x: 2, y: 1 }, dir: 2, action: null, role: 'tagger' },
    ]);
    // A player around the corner and behind a wall is not listed.
    players.set('t-a', { ...player(start, 't-a'), cell: { x: 7, y: 5 }, dir: 2 });
    const far = step({ ...start, players }, 101);
    expect(getVisibleEntities(far.state, 'r-a')).toEqual([]);
    // Ended players expose no mask.
    const gone = new Map(start.players);
    gone.set('r-b', { ...player(start, 'r-b'), status: 'CAPTURED' });
    expect(getVisibleSurfaces(step({ ...start, players: gone }, 101).state, 'r-b')).toEqual({
      visibleCells: [],
      visibleWallFaces: [],
    });
  });
});

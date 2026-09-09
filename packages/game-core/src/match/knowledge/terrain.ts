import type { KnownTerrain, VisibleSurfaces } from '../core-types.js';
import { DIR_VECTORS, isInside, isWalkable } from '../map/validate-template.js';
import type { KnowledgeRecord } from '../state.js';
import type { Cell, Dir, Topology, WallFace } from '../types.js';

export function floorKey(topology: Topology, cell: Cell): number {
  return cell.y * topology.width + cell.x;
}

export function wallKey(topology: Topology, face: WallFace): number {
  return (face.y * topology.width + face.x) * 4 + face.side;
}

function cellOfFloorKey(topology: Topology, key: number): Cell {
  return { x: key % topology.width, y: Math.floor(key / topology.width) };
}

function faceOfWallKey(topology: Topology, key: number): WallFace {
  const cellKey = Math.floor(key / 4);
  return {
    x: cellKey % topology.width,
    y: Math.floor(cellKey / topology.width),
    side: (key % 4) as Dir,
  };
}

export const EMPTY_KNOWLEDGE: KnowledgeRecord = Object.freeze({
  floors: new Set<number>(),
  walls: new Set<number>(),
  discoveredExits: new Set<string>(),
  mapVersion: 1,
});

/** Wall faces that border the given passage cells, oriented toward those cells. */
export function borderingFaces(topology: Topology, cells: readonly Cell[]): WallFace[] {
  const faces: WallFace[] = [];
  for (const cell of cells) {
    for (const side of [0, 1, 2, 3] as const) {
      const v = DIR_VECTORS[side];
      const wall = { x: cell.x + v.dx, y: cell.y + v.dy };
      if (!isInside(topology, wall) || isWalkable(topology, wall)) continue;
      // The face of `wall` that touches `cell` points back toward the cell.
      faces.push({ x: wall.x, y: wall.y, side: ((side + 2) % 4) as Dir });
    }
  }
  return faces;
}

/**
 * Initial terrain memory (KN-02). Runners know only their own cell; taggers
 * know the floors and bordering wall faces of their territory. Neither contains
 * other players, exits, or equipment. The first real sight is merged separately.
 */
export function initialTerrain(
  topology: Topology,
  ownCell: Cell,
  territory: readonly Cell[] | null,
): KnowledgeRecord {
  const floors = new Set<number>([floorKey(topology, ownCell)]);
  const walls = new Set<number>();
  if (territory) {
    for (const cell of territory) floors.add(floorKey(topology, cell));
    for (const face of borderingFaces(topology, territory)) walls.add(wallKey(topology, face));
  }
  return { floors, walls, discoveredExits: new Set(), mapVersion: 1 };
}

/**
 * Unions one tick of actual observation into the memory. Returns the same
 * record when nothing new was seen so mapVersion only grows on real change.
 */
export function observeTerrain(
  topology: Topology,
  record: KnowledgeRecord,
  surfaces: VisibleSurfaces,
): KnowledgeRecord {
  let floors: Set<number> | null = null;
  let walls: Set<number> | null = null;
  for (const cell of surfaces.visibleCells) {
    const key = floorKey(topology, cell);
    if (record.floors.has(key) || floors?.has(key)) continue;
    floors ??= new Set(record.floors);
    floors.add(key);
  }
  for (const face of surfaces.visibleWallFaces) {
    const key = wallKey(topology, face);
    if (record.walls.has(key) || walls?.has(key)) continue;
    walls ??= new Set(record.walls);
    walls.add(key);
  }
  if (!floors && !walls) return record;
  return {
    floors: floors ?? record.floors,
    walls: walls ?? record.walls,
    discoveredExits: record.discoveredExits,
    mapVersion: record.mapVersion + 1,
  };
}

/** Sorted public terrain list: floors first (y, x), then wall faces (y, x, side). */
export function knownTerrainOf(topology: Topology, record: KnowledgeRecord): KnownTerrain[] {
  const floors = [...record.floors]
    .sort((a, b) => a - b)
    .map((key) => ({
      ...cellOfFloorKey(topology, key),
      kind: 'floor' as const,
    }));
  const walls = [...record.walls]
    .sort((a, b) => a - b)
    .map((key) => ({
      ...faceOfWallKey(topology, key),
      kind: 'wall' as const,
    }));
  return [...floors, ...walls];
}

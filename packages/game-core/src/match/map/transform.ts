import type {
  Cell,
  Dir,
  LayoutTemplate,
  MapTemplateResult,
  MapVariantsResult,
  SpawnRegion,
  Topology,
  WallFace,
} from '../types.js';
import {
  PASSAGE_CHAR,
  WALL_CHAR,
  compareCells,
  compareWallFaces,
  validateTemplate,
} from './validate-template.js';

/**
 * D4 symmetry group of the square grid. `rN` is N clockwise quarter turns;
 * `mrN` mirrors east/west first and then rotates N quarter turns.
 */
export type TransformId = 'r0' | 'r1' | 'r2' | 'r3' | 'mr0' | 'mr1' | 'mr2' | 'mr3';

export const TRANSFORM_IDS: readonly TransformId[] = Object.freeze([
  'r0',
  'r1',
  'r2',
  'r3',
  'mr0',
  'mr1',
  'mr2',
  'mr3',
]);

function decompose(id: TransformId): { mirror: boolean; quarterTurns: number } {
  const mirror = id.startsWith('m');
  const quarterTurns = Number(id.slice(id.indexOf('r') + 1));
  return { mirror, quarterTurns };
}

/** Quarter turn clockwise on screen: (x,y) -> (size-1-y, x). North becomes east. */
export function rotateCell90(cell: Cell, size: number): Cell {
  return { x: size - 1 - cell.y, y: cell.x };
}

export function rotateDir90(dir: Dir): Dir {
  return ((dir + 1) % 4) as Dir;
}

/** Mirror east/west: (x,y) -> (size-1-x, y). East and west swap; north/south stay. */
export function mirrorCell(cell: Cell, size: number): Cell {
  return { x: size - 1 - cell.x, y: cell.y };
}

export function mirrorDir(dir: Dir): Dir {
  return dir === 1 ? 3 : dir === 3 ? 1 : dir;
}

export function transformCell(cell: Cell, size: number, id: TransformId): Cell {
  const { mirror, quarterTurns } = decompose(id);
  let current = mirror ? mirrorCell(cell, size) : cell;
  for (let i = 0; i < quarterTurns; i += 1) current = rotateCell90(current, size);
  return current;
}

export function transformDir(dir: Dir, id: TransformId): Dir {
  const { mirror, quarterTurns } = decompose(id);
  let current = mirror ? mirrorDir(dir) : dir;
  for (let i = 0; i < quarterTurns; i += 1) current = rotateDir90(current);
  return current;
}

export function transformFace(face: WallFace, size: number, id: TransformId): WallFace {
  const cell = transformCell(face, size, id);
  return { x: cell.x, y: cell.y, side: transformDir(face.side, id) };
}

function transformTopology(topology: Topology, id: TransformId): boolean[] {
  const size = topology.width;
  const walkable = new Array<boolean>(size * size).fill(false);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!topology.walkable[y * size + x]) continue;
      const moved = transformCell({ x, y }, size, id);
      walkable[moved.y * size + moved.x] = true;
    }
  }
  return walkable;
}

function transformRegion(region: SpawnRegion, size: number, id: TransformId): SpawnRegion {
  return {
    regionId: region.regionId,
    cells: region.cells.map((cell) => transformCell(cell, size, id)).sort(compareCells),
    spawnCandidates: region.spawnCandidates
      .map((cell) => transformCell(cell, size, id))
      .sort(compareCells),
  };
}

/** Rows form of a topology, used to re-run the structural validator on variants. */
export function rowsFromTopology(topology: Topology): string[] {
  const rows: string[] = [];
  for (let y = 0; y < topology.height; y += 1) {
    let row = '';
    for (let x = 0; x < topology.width; x += 1) {
      row += topology.walkable[y * topology.width + x] ? PASSAGE_CHAR : WALL_CHAR;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Applies one D4 transform to terrain, regions, candidates, and exit faces
 * together. templateId/templateVersion/templateHash are preserved; only the
 * variantId and the variant part of topologyVersion change. The result is
 * revalidated structurally so an illegal face or broken outer ring becomes an
 * invalid result instead of a silently dropped variant.
 */
export function transformTemplate(template: LayoutTemplate, id: TransformId): MapTemplateResult {
  if (template.topology.width !== template.topology.height) {
    return { status: 'invalid', code: 'INVALID_TEMPLATE', path: ['topology', 'width'] };
  }
  const size = template.topology.width;
  const source = {
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    templateHash: template.templateHash,
    variantId: id,
  };
  const raw = {
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    width: size,
    height: size,
    rows: rowsFromTopology({
      ...template.topology,
      walkable: transformTopology(template.topology, id),
    }),
    taggerRegions: template.taggerRegions.map((region) => transformRegion(region, size, id)),
    runnerSpawnRegions: template.runnerSpawnRegions.map((region) =>
      transformRegion(region, size, id),
    ),
    exitCandidates: template.exitCandidates
      .map((face) => transformFace(face, size, id))
      .sort(compareWallFaces),
  };
  return validateTemplate(raw, source);
}

function regionSignature(region: SpawnRegion): string {
  const cells = [...region.cells]
    .sort(compareCells)
    .map((c) => `${c.x},${c.y}`)
    .join(';');
  const spawns = [...region.spawnCandidates]
    .sort(compareCells)
    .map((c) => `${c.x},${c.y}`)
    .join(';');
  return `${cells}|${spawns}`;
}

/**
 * Geometry-only signature: terrain, sorted region structures, and sorted exit
 * faces. Region identifiers and array order do not influence it, so symmetric
 * variants that place the same cells and faces collapse to one signature.
 */
export function canonicalSignature(template: LayoutTemplate): string {
  const terrain = rowsFromTopology(template.topology).join('/');
  const taggers = template.taggerRegions.map(regionSignature).sort().join('#');
  const runners = template.runnerSpawnRegions.map(regionSignature).sort().join('#');
  const exits = [...template.exitCandidates]
    .sort(compareWallFaces)
    .map((f) => `${f.x},${f.y},${f.side}`)
    .join(';');
  return `${terrain}\n${taggers}\n${runners}\n${exits}`;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * MapPreparationPort.createTemplateVariants: up to eight validated variants,
 * deduplicated by canonical signature (the lexicographically smallest variantId
 * represents each symmetric group) and sorted by variantId. Any transform that
 * fails structural validation makes the whole result invalid; nothing is
 * dropped to force success.
 */
export function createTemplateVariants(template: LayoutTemplate): MapVariantsResult {
  const bySignature = new Map<string, LayoutTemplate>();
  for (const id of TRANSFORM_IDS) {
    const result = transformTemplate(template, id);
    if (result.status !== 'valid') {
      return { status: 'invalid', code: result.code, path: [id, ...result.path] };
    }
    const signature = canonicalSignature(result.template);
    const existing = bySignature.get(signature);
    if (!existing || compareIds(result.template.variantId, existing.variantId) < 0) {
      bySignature.set(signature, result.template);
    }
  }
  const variants = [...bySignature.values()].sort((a, b) => compareIds(a.variantId, b.variantId));
  if (variants.length === 0) return { status: 'invalid', code: 'INVALID_TEMPLATE', path: [] };
  return { status: 'valid', variants: Object.freeze(variants) };
}

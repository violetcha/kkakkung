import type {
  Cell,
  Dir,
  LayoutTemplate,
  MapSource,
  MapTemplateResult,
  SpawnRegion,
  Topology,
  WallFace,
} from '../types.js';
import type { TemplateFailure, TemplateIssue, TemplateIssueCode } from './types.js';

export const DIR_VECTORS: Readonly<Record<Dir, Readonly<{ dx: number; dy: number }>>> = {
  0: { dx: 0, dy: -1 },
  1: { dx: 1, dy: 0 },
  2: { dx: 0, dy: 1 },
  3: { dx: -1, dy: 0 },
};

export const MIN_TEMPLATE_SIZE = 8;
export const MAX_TEMPLATE_SIZE = 32;
export const WALL_CHAR = '#';
export const PASSAGE_CHAR = '.';
/** variantId of an untransformed template. */
export const BASE_VARIANT_ID = 'r0';

export type Path = readonly (string | number)[];

export function isDir(value: unknown): value is Dir {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function cellKey(cell: Cell): number {
  return cell.y * MAX_TEMPLATE_SIZE + cell.x;
}

export function compareCells(a: Cell, b: Cell): number {
  return a.y - b.y || a.x - b.x;
}

export function compareWallFaces(a: WallFace, b: WallFace): number {
  return compareCells(a, b) || a.side - b.side;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function sameFace(a: WallFace, b: WallFace): boolean {
  return sameCell(a, b) && a.side === b.side;
}

export function approachOf(face: WallFace): Cell {
  const vector = DIR_VECTORS[face.side];
  return { x: face.x + vector.dx, y: face.y + vector.dy };
}

export function isInside(topology: Topology, cell: Cell): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < topology.width && cell.y < topology.height;
}

export function isWalkable(topology: Topology, cell: Cell): boolean {
  return isInside(topology, cell) && topology.walkable[cell.y * topology.width + cell.x] === true;
}

export function passageNeighbors(topology: Topology, cell: Cell): readonly Cell[] {
  const result: Cell[] = [];
  for (const side of [0, 1, 2, 3] as const) {
    const vector = DIR_VECTORS[side];
    const next = { x: cell.x + vector.dx, y: cell.y + vector.dy };
    if (isWalkable(topology, next)) result.push(next);
  }
  return result;
}

/** topologyVersion is the fixed combination of the source id, version, and variant. */
export function topologyVersionOf(source: MapSource): string {
  return `${source.templateId}@${source.templateVersion}#${source.variantId}`;
}

function freezeCell(cell: Cell): Cell {
  return Object.freeze({ x: cell.x, y: cell.y });
}

function freezeFace(face: WallFace): WallFace {
  return Object.freeze({ x: face.x, y: face.y, side: face.side });
}

export function freezeRegion(region: SpawnRegion): SpawnRegion {
  return Object.freeze({
    regionId: region.regionId,
    cells: Object.freeze([...region.cells].sort(compareCells).map(freezeCell)),
    spawnCandidates: Object.freeze([...region.spawnCandidates].sort(compareCells).map(freezeCell)),
  });
}

export function freezeTopology(topology: Topology): Topology {
  return Object.freeze({
    topologyVersion: topology.topologyVersion,
    width: topology.width,
    height: topology.height,
    walkable: Object.freeze([...topology.walkable]),
  });
}

export function freezeTemplate(template: LayoutTemplate): LayoutTemplate {
  return Object.freeze({
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    templateHash: template.templateHash,
    variantId: template.variantId,
    topology: freezeTopology(template.topology),
    taggerRegions: Object.freeze(
      template.taggerRegions.map(freezeRegion) as [SpawnRegion, SpawnRegion, SpawnRegion],
    ),
    runnerSpawnRegions: Object.freeze(
      template.runnerSpawnRegions.map(freezeRegion) as [SpawnRegion, SpawnRegion, SpawnRegion],
    ),
    exitCandidates: Object.freeze(
      [...template.exitCandidates].sort(compareWallFaces).map(freezeFace),
    ),
  });
}

const SOURCE_CODES: ReadonlySet<TemplateIssueCode> = new Set(['MISSING_FIELD', 'SOURCE_MISMATCH']);

class Issues {
  readonly list: TemplateIssue[] = [];
  add(code: TemplateIssueCode, path: Path, message: string): void {
    this.list.push(Object.freeze({ code, path: Object.freeze([...path]), message }));
  }
  fail(): TemplateFailure {
    const first = this.list[0];
    const sourceProblem = this.list.every((issue) => SOURCE_CODES.has(issue.code));
    return Object.freeze({
      status: 'invalid',
      code: sourceProblem ? 'INVALID_MAP_SOURCE' : 'INVALID_TEMPLATE',
      path: first ? first.path : Object.freeze([]),
      issues: Object.freeze(this.list),
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCell(value: unknown, path: Path, issues: Issues): Cell | null {
  if (!isRecord(value)) {
    issues.add('INVALID_TYPE', path, 'cell must be an object with integer x and y');
    return null;
  }
  const { x, y } = value;
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    issues.add('INVALID_TYPE', path, 'cell x and y must be integers');
    return null;
  }
  return { x: x as number, y: y as number };
}

function readCells(value: unknown, path: Path, issues: Issues): Cell[] | null {
  if (!Array.isArray(value)) {
    issues.add('INVALID_TYPE', path, 'expected an array of cells');
    return null;
  }
  const cells: Cell[] = [];
  value.forEach((item, index) => {
    const cell = readCell(item, [...path, index], issues);
    if (cell) cells.push(cell);
  });
  return cells;
}

function readTopology(
  raw: Record<string, unknown>,
  source: MapSource,
  issues: Issues,
): Topology | null {
  const { width, height, rows } = raw;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    issues.add('INVALID_TYPE', ['width'], 'width and height must be integers');
    return null;
  }
  const w = width as number;
  const h = height as number;
  if (
    w < MIN_TEMPLATE_SIZE ||
    w > MAX_TEMPLATE_SIZE ||
    h < MIN_TEMPLATE_SIZE ||
    h > MAX_TEMPLATE_SIZE
  ) {
    issues.add(
      'INVALID_SIZE',
      ['width'],
      `size must be within ${MIN_TEMPLATE_SIZE}..${MAX_TEMPLATE_SIZE}`,
    );
    return null;
  }
  if (!Array.isArray(rows) || rows.length !== h) {
    issues.add('ROW_LENGTH', ['rows'], `rows must contain exactly ${h} strings`);
    return null;
  }
  const walkable: boolean[] = new Array<boolean>(w * h).fill(false);
  let structural = false;
  rows.forEach((row, y) => {
    if (typeof row !== 'string' || row.length !== w) {
      issues.add('ROW_LENGTH', ['rows', y], `row must be a string of length ${w}`);
      structural = true;
      return;
    }
    for (let x = 0; x < w; x += 1) {
      const ch = row[x];
      if (ch !== WALL_CHAR && ch !== PASSAGE_CHAR) {
        issues.add('INVALID_CELL', ['rows', y, x], 'cell must be # (wall) or . (passage)');
        structural = true;
        continue;
      }
      const outer = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (outer && ch !== WALL_CHAR) {
        issues.add('OUTER_WALL', ['rows', y, x], 'outer ring must be wall');
        structural = true;
      }
      walkable[y * w + x] = ch === PASSAGE_CHAR;
    }
  });
  if (structural) return null;
  return { topologyVersion: topologyVersionOf(source), width: w, height: h, walkable };
}

function readRegions(
  value: unknown,
  key: string,
  topology: Topology,
  minNeighbors: number,
  issues: Issues,
): SpawnRegion[] | null {
  if (!Array.isArray(value)) {
    issues.add('INVALID_TYPE', [key], 'expected an array of regions');
    return null;
  }
  if (value.length !== 3) issues.add('REGION_COUNT', [key], 'exactly three regions are required');
  const regions: SpawnRegion[] = [];
  const ids = new Set<string>();
  const occupied = new Map<number, string>();
  value.forEach((item, index) => {
    const base: Path = [key, index];
    if (!isRecord(item)) {
      issues.add('INVALID_TYPE', base, 'region must be an object');
      return;
    }
    const regionId = item.regionId;
    if (typeof regionId !== 'string' || regionId.length === 0) {
      issues.add('INVALID_TYPE', [...base, 'regionId'], 'regionId must be a non-empty string');
      return;
    }
    if (ids.has(regionId)) {
      issues.add('DUPLICATE_ID', [...base, 'regionId'], `duplicate regionId ${regionId}`);
    }
    ids.add(regionId);
    const cells = readCells(item.cells, [...base, 'cells'], issues);
    const candidates = readCells(item.spawnCandidates, [...base, 'spawnCandidates'], issues);
    if (!cells || !candidates) return;
    if (cells.length === 0) issues.add('REGION_EMPTY', [...base, 'cells'], 'region has no cells');
    if (candidates.length === 0) {
      issues.add('REGION_EMPTY', [...base, 'spawnCandidates'], 'region has no spawn candidates');
    }
    const cellKeys = new Set<number>();
    cells.forEach((cell, cellIndex) => {
      const p: Path = [...base, 'cells', cellIndex];
      if (!isInside(topology, cell)) {
        issues.add('OUT_OF_RANGE', p, 'cell outside the grid');
        return;
      }
      if (!isWalkable(topology, cell)) issues.add('REGION_NOT_PASSAGE', p, 'region cell is a wall');
      const k = cellKey(cell);
      if (cellKeys.has(k)) issues.add('DUPLICATE_CANDIDATE', p, 'duplicate region cell');
      cellKeys.add(k);
      const owner = occupied.get(k);
      if (owner !== undefined && owner !== regionId) {
        issues.add('REGION_OVERLAP', p, `cell also belongs to region ${owner}`);
      }
      occupied.set(k, regionId);
    });
    const candidateKeys = new Set<number>();
    candidates.forEach((cell, candidateIndex) => {
      const p: Path = [...base, 'spawnCandidates', candidateIndex];
      if (!isInside(topology, cell)) {
        issues.add('OUT_OF_RANGE', p, 'spawn candidate outside the grid');
        return;
      }
      const k = cellKey(cell);
      if (candidateKeys.has(k)) issues.add('DUPLICATE_CANDIDATE', p, 'duplicate spawn candidate');
      candidateKeys.add(k);
      if (!cellKeys.has(k)) {
        issues.add('SPAWN_OUTSIDE_REGION', p, 'spawn candidate outside its region');
      }
      if (!isWalkable(topology, cell)) {
        issues.add('SPAWN_NOT_PASSAGE', p, 'spawn candidate is a wall');
        return;
      }
      if (passageNeighbors(topology, cell).length < minNeighbors) {
        issues.add(
          'SPAWN_NEIGHBORS',
          p,
          `spawn candidate needs at least ${minNeighbors} passage neighbors`,
        );
      }
    });
    regions.push({ regionId, cells, spawnCandidates: candidates });
  });
  return regions;
}

function readExits(value: unknown, topology: Topology, issues: Issues): WallFace[] | null {
  if (!Array.isArray(value)) {
    issues.add('INVALID_TYPE', ['exitCandidates'], 'expected an array of wall faces');
    return null;
  }
  if (value.length === 0) issues.add('REGION_EMPTY', ['exitCandidates'], 'no exit candidates');
  const faces: WallFace[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const p: Path = ['exitCandidates', index];
    const cell = readCell(item, p, issues);
    if (!cell) return;
    const side = (item as Record<string, unknown>).side;
    if (!isDir(side)) {
      issues.add('INVALID_TYPE', [...p, 'side'], 'side must be 0..3');
      return;
    }
    const face: WallFace = { x: cell.x, y: cell.y, side };
    if (!isInside(topology, face)) {
      issues.add('OUT_OF_RANGE', p, 'wall face outside the grid');
      return;
    }
    const key = `${face.x},${face.y},${face.side}`;
    if (seen.has(key)) issues.add('DUPLICATE_CANDIDATE', p, 'duplicate exit candidate');
    seen.add(key);
    if (isWalkable(topology, face)) {
      issues.add('EXIT_NOT_WALL', p, 'exit wall cell is a passage');
      return;
    }
    const outer =
      face.x === 0 ||
      face.y === 0 ||
      face.x === topology.width - 1 ||
      face.y === topology.height - 1;
    if (outer) {
      issues.add('EXIT_OUTER', p, 'exit must be on an inner wall');
      return;
    }
    if (!isWalkable(topology, approachOf(face))) {
      issues.add('EXIT_APPROACH_BLOCKED', p, 'approach cell in front of the face is not a passage');
      return;
    }
    faces.push(face);
  });
  return faces;
}

/**
 * MapPreparationPort.validateTemplate: validates already-parsed template JSON
 * against the loader-provided source. Returns `{status:'valid', template}` with
 * an immutable LayoutTemplate, or `{status:'invalid', code, path}` (plus the
 * detailed `issues`). The input is never mutated or corrected. Structural
 * validity is not placement certification (MP-03..05).
 */
export function validateTemplate(
  raw: unknown,
  source: MapSource,
  options: Readonly<{ minSpawnNeighbors?: number }> = {},
): MapTemplateResult {
  const issues = new Issues();
  const minNeighbors = options.minSpawnNeighbors ?? 2;
  for (const field of ['templateId', 'templateVersion', 'templateHash', 'variantId'] as const) {
    if (typeof source[field] !== 'string' || source[field].length === 0) {
      issues.add('MISSING_FIELD', ['source', field], `${field} is required`);
    }
  }
  if (issues.list.length > 0) return issues.fail();
  if (!isRecord(raw)) {
    issues.add('INVALID_TYPE', [], 'template must be an object');
    return issues.fail();
  }
  if (raw.templateId !== undefined && raw.templateId !== source.templateId) {
    issues.add('SOURCE_MISMATCH', ['templateId'], 'templateId differs from the loader source');
  }
  if (raw.templateVersion !== undefined && raw.templateVersion !== source.templateVersion) {
    issues.add(
      'SOURCE_MISMATCH',
      ['templateVersion'],
      'templateVersion differs from the loader source',
    );
  }
  if (issues.list.length > 0) return issues.fail();
  const topology = readTopology(raw, source, issues);
  if (!topology) return issues.fail();
  const taggerRegions = readRegions(
    raw.taggerRegions,
    'taggerRegions',
    topology,
    minNeighbors,
    issues,
  );
  const runnerRegions = readRegions(
    raw.runnerSpawnRegions,
    'runnerSpawnRegions',
    topology,
    minNeighbors,
    issues,
  );
  const exits = readExits(raw.exitCandidates, topology, issues);
  if (issues.list.length > 0 || !taggerRegions || !runnerRegions || !exits) return issues.fail();
  return {
    status: 'valid',
    template: freezeTemplate({
      templateId: source.templateId,
      templateVersion: source.templateVersion,
      templateHash: source.templateHash,
      variantId: source.variantId,
      topology,
      taggerRegions: taggerRegions as [SpawnRegion, SpawnRegion, SpawnRegion],
      runnerSpawnRegions: runnerRegions as [SpawnRegion, SpawnRegion, SpawnRegion],
      exitCandidates: exits,
    }),
  };
}

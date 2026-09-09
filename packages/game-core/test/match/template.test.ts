import { describe, expect, it } from 'vitest';

import type { TemplateFailure } from '../../src/match/map/types.js';
import {
  approachOf,
  isWalkable,
  passageNeighbors,
  validateTemplate,
} from '../../src/match/map/validate-template.js';
import { validateTuning } from '../../src/match/tuning.js';
import type { MapTemplateResult } from '../../src/match/types.js';
import { clone, loadMaster, loadTuning } from './helpers.js';

type Raw = Record<string, unknown> & {
  rows: string[];
  taggerRegions: {
    regionId: string;
    cells: { x: number; y: number }[];
    spawnCandidates: { x: number; y: number }[];
  }[];
  runnerSpawnRegions: {
    regionId: string;
    cells: { x: number; y: number }[];
    spawnCandidates: { x: number; y: number }[];
  }[];
  exitCandidates: { x: number; y: number; side: number }[];
};

function master(): { raw: Raw; source: ReturnType<typeof loadMaster>['source'] } {
  const { raw, source } = loadMaster();
  return { raw: raw as Raw, source };
}

function codesOf(result: MapTemplateResult): string[] {
  return result.status === 'valid' ? [] : (result as TemplateFailure).issues.map((i) => i.code);
}

describe('master-v1 template', () => {
  it('normalizes the static master into a frozen LayoutTemplate without mutating the input', () => {
    const { raw, source } = master();
    const snapshot = JSON.stringify(raw);
    const result = validateTemplate(raw, source);
    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    const template = result.template;
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(Object.isFrozen(template)).toBe(true);
    expect(Object.isFrozen(template.topology.walkable)).toBe(true);
    expect(Object.isFrozen(template.taggerRegions[0].cells)).toBe(true);
    expect(template.templateId).toBe('master-v1');
    expect(template.templateVersion).toBe('1');
    expect(template.templateHash).toBe(source.templateHash);
    expect(template.variantId).toBe('r0');
    expect(template.topology.topologyVersion).toBe('master-v1@1#r0');
    expect(template.topology.width).toBe(32);
    expect(template.topology.height).toBe(32);
    expect(template.topology.walkable).toHaveLength(1024);
    expect(template.taggerRegions.map((r) => r.regionId)).toEqual([
      'tagger-west',
      'tagger-center',
      'tagger-east',
    ]);
    expect(template.runnerSpawnRegions.map((r) => r.regionId)).toEqual([
      'runner-northwest',
      'runner-northeast',
      'runner-south',
    ]);
    for (const region of [...template.taggerRegions, ...template.runnerSpawnRegions]) {
      expect(region.cells.length).toBeGreaterThan(0);
      expect(region.spawnCandidates.length).toBeGreaterThan(0);
      const keys = new Set(region.cells.map((c) => `${c.x},${c.y}`));
      for (const candidate of region.spawnCandidates) {
        expect(keys.has(`${candidate.x},${candidate.y}`)).toBe(true);
        expect(isWalkable(template.topology, candidate)).toBe(true);
        expect(passageNeighbors(template.topology, candidate).length).toBeGreaterThanOrEqual(2);
      }
    }
    expect(template.exitCandidates.length).toBeGreaterThan(0);
    for (const face of template.exitCandidates) {
      expect(isWalkable(template.topology, face)).toBe(false);
      expect(isWalkable(template.topology, approachOf(face))).toBe(true);
      expect(face.x).toBeGreaterThan(0);
      expect(face.x).toBeLessThan(31);
    }
  });

  it('keeps the documented master pattern: outer ring walls and inner walls with gaps', () => {
    const { raw } = master();
    expect(raw.rows[0]).toBe('#'.repeat(32));
    expect(raw.rows[31]).toBe('#'.repeat(32));
    for (let y = 3; y <= 28; y += 1) {
      for (const x of [6, 12, 18, 24]) {
        const expected = [7, 15, 23].includes(y) ? '.' : '#';
        expect(raw.rows[y]?.[x]).toBe(expected);
      }
    }
    expect(raw.rows[2]).toBe(`#${'.'.repeat(30)}#`);
  });

  it('produces identical normalized output for identical input', () => {
    const { raw, source } = master();
    const a = validateTemplate(raw, source);
    const b = validateTemplate(clone(raw), { ...source });
    expect(a).toEqual(b);
  });

  it('reports source problems as INVALID_MAP_SOURCE and template mismatches with a path', () => {
    const { raw, source } = master();
    const bad = validateTemplate(raw, { ...source, templateVersion: '2' });
    expect(bad).toMatchObject({
      status: 'invalid',
      code: 'INVALID_MAP_SOURCE',
      path: ['templateVersion'],
    });
    const missing = validateTemplate(raw, { ...source, templateHash: '' });
    expect(missing).toMatchObject({
      status: 'invalid',
      code: 'INVALID_MAP_SOURCE',
      path: ['source', 'templateHash'],
    });
  });
});

describe('structural rejection', () => {
  it('rejects a 31 column row with its location and no correction', () => {
    const { raw, source } = master();
    const broken = clone(raw);
    broken.rows[5] = broken.rows[5]!.slice(0, 31);
    const result = validateTemplate(broken, source);
    expect(result).toMatchObject({
      status: 'invalid',
      code: 'INVALID_TEMPLATE',
      path: ['rows', 5],
    });
    expect((result as TemplateFailure).issues).toEqual([
      { code: 'ROW_LENGTH', path: ['rows', 5], message: expect.any(String) },
    ]);
    expect(broken.rows[5]).toHaveLength(31);
  });

  it('rejects candidates at x=32 and outside their region', () => {
    const { raw, source } = master();
    const broken = clone(raw);
    broken.taggerRegions[0]!.spawnCandidates.push({ x: 32, y: 15 });
    broken.taggerRegions[1]!.spawnCandidates.push({ x: 2, y: 2 });
    const codes = codesOf(validateTemplate(broken, source));
    expect(codes).toContain('OUT_OF_RANGE');
    expect(codes).toContain('SPAWN_OUTSIDE_REGION');
  });

  it('rejects wall spawn candidates and candidates with fewer than two neighbors', () => {
    const { raw, source } = master();
    const broken = clone(raw);
    broken.taggerRegions[0]!.cells.push({ x: 12, y: 12 });
    broken.taggerRegions[0]!.spawnCandidates.push({ x: 12, y: 12 });
    const codes = codesOf(validateTemplate(broken, source));
    expect(codes).toContain('REGION_NOT_PASSAGE');
    expect(codes).toContain('SPAWN_NOT_PASSAGE');

    const deadEnd = clone(raw);
    const rows = deadEnd.rows;
    const put = (x: number, y: number, ch: string) =>
      (rows[y] = rows[y]!.slice(0, x) + ch + rows[y]!.slice(x + 1));
    put(1, 2, '#');
    put(2, 1, '#');
    put(3, 2, '#');
    expect(codesOf(validateTemplate(deadEnd, source))).toContain('SPAWN_NEIGHBORS');
  });

  it('rejects duplicate regionId, wrong region count, empty regions, and overlapping tagger regions', () => {
    const { raw, source } = master();
    const duplicate = clone(raw);
    duplicate.taggerRegions[1]!.regionId = duplicate.taggerRegions[0]!.regionId;
    expect(codesOf(validateTemplate(duplicate, source))).toContain('DUPLICATE_ID');

    const two = clone(raw);
    two.taggerRegions.pop();
    expect(codesOf(validateTemplate(two, source))).toContain('REGION_COUNT');

    const empty = clone(raw);
    empty.runnerSpawnRegions[0]!.spawnCandidates = [];
    expect(codesOf(validateTemplate(empty, source))).toContain('REGION_EMPTY');

    const overlap = clone(raw);
    const shared = overlap.taggerRegions[0]!.cells[0]!;
    overlap.taggerRegions[1]!.cells.push({ ...shared });
    expect(codesOf(validateTemplate(overlap, source))).toContain('REGION_OVERLAP');
  });

  it('rejects exit candidates on the outer wall, on passages, or facing a wall', () => {
    const { raw, source } = master();
    const outer = clone(raw);
    outer.exitCandidates.push({ x: 5, y: 0, side: 2 });
    expect(codesOf(validateTemplate(outer, source))).toContain('EXIT_OUTER');

    const passage = clone(raw);
    passage.exitCandidates.push({ x: 2, y: 2, side: 0 });
    expect(codesOf(validateTemplate(passage, source))).toContain('EXIT_NOT_WALL');

    const blocked = clone(raw);
    blocked.exitCandidates.push({ x: 6, y: 10, side: 0 });
    expect(codesOf(validateTemplate(blocked, source))).toContain('EXIT_APPROACH_BLOCKED');

    const badSide = clone(raw);
    badSide.exitCandidates.push({ x: 6, y: 10, side: 4 });
    expect(codesOf(validateTemplate(badSide, source))).toContain('INVALID_TYPE');
  });

  it('rejects an open outer ring and unknown cell characters', () => {
    const { raw, source } = master();
    const open = clone(raw);
    open.rows[0] = `#.${'#'.repeat(30)}`;
    expect(codesOf(validateTemplate(open, source))).toContain('OUTER_WALL');
    const weird = clone(raw);
    weird.rows[4] = `#x${weird.rows[4]!.slice(2)}`;
    expect(codesOf(validateTemplate(weird, source))).toContain('INVALID_CELL');
  });

  it('rejects non-object input and flat candidate lists without regions, never throwing', () => {
    const { source } = master();
    expect(validateTemplate(null, source)).toMatchObject({
      status: 'invalid',
      code: 'INVALID_TEMPLATE',
    });
    expect(validateTemplate('rows', source).status).toBe('invalid');
    const { raw } = master();
    const flat = clone(raw) as Record<string, unknown>;
    flat.taggerRegions = raw.taggerRegions.flatMap((r) => r.spawnCandidates);
    expect(codesOf(validateTemplate(flat, source))).toContain('INVALID_TYPE');
  });
});

describe('tuning data', () => {
  it('validates mvp-v1 tuning and rejects changed constants', () => {
    const raw = loadTuning();
    const result = validateTuning(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.tuningVersion).toBe('mvp-v1');
    expect(result.template.match.moveTicks).toBe(9);
    expect(result.template.match.turnTicks).toBe(6);
    expect(result.template.match.roundTicks).toBe(3600);
    expect(result.template.selection).toEqual({
      maxAttempts: 256,
      onlineMapBudgetMs: 100,
      attemptsPerBatch: 8,
    });
    expect(result.template.layout.maxExitRatio).toBe(1.3);
    const changed = clone(raw) as { match: Record<string, number> };
    changed.match.moveTicks = 8;
    expect(validateTuning(changed).ok).toBe(false);
  });
});

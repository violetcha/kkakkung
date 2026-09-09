import { describe, expect, it } from 'vitest';

import {
  TRANSFORM_IDS,
  canonicalSignature,
  createTemplateVariants,
  transformCell,
  transformDir,
  transformFace,
  transformTemplate,
} from '../../src/match/map/transform.js';
import { approachOf, isWalkable, validateTemplate } from '../../src/match/map/validate-template.js';
import type { LayoutTemplate } from '../../src/match/types.js';
import { clone, loadMaster, masterTemplate } from './helpers.js';

describe('D4 coordinate transforms', () => {
  it('rotates (2,5) facing north to (26,2) facing east and moves the approach cell with it', () => {
    expect(transformCell({ x: 2, y: 5 }, 32, 'r1')).toEqual({ x: 26, y: 2 });
    expect(transformDir(0, 'r1')).toBe(1);
    const face = { x: 6, y: 10, side: 1 as const };
    const rotated = transformFace(face, 32, 'r1');
    expect(rotated).toEqual({ x: 21, y: 6, side: 2 });
    expect(approachOf(rotated)).toEqual(transformCell(approachOf(face), 32, 'r1'));
  });

  it('mirror swaps east and west only and four turns or two mirrors restore the input', () => {
    expect(transformDir(1, 'mr0')).toBe(3);
    expect(transformDir(3, 'mr0')).toBe(1);
    expect(transformDir(0, 'mr0')).toBe(0);
    expect(transformDir(2, 'mr0')).toBe(2);
    const cell = { x: 7, y: 20 };
    let current = cell;
    for (let i = 0; i < 4; i += 1) current = transformCell(current, 32, 'r1');
    expect(current).toEqual(cell);
    expect(transformCell(transformCell(cell, 32, 'mr0'), 32, 'mr0')).toEqual(cell);
    for (const dir of [0, 1, 2, 3] as const) {
      let d = dir;
      for (let i = 0; i < 4; i += 1) d = transformDir(d, 'r1');
      expect(d).toBe(dir);
      expect(transformDir(transformDir(dir, 'mr0'), 'mr0')).toBe(dir);
    }
    // mrN is mirror first, then N quarter turns.
    expect(transformCell({ x: 2, y: 5 }, 32, 'mr1')).toEqual(
      transformCell(transformCell({ x: 2, y: 5 }, 32, 'mr0'), 32, 'r1'),
    );
  });
});

describe('template variants', () => {
  const template = masterTemplate();

  it('rotating the master four times yields the normalized original', () => {
    let current: LayoutTemplate = template;
    for (let i = 0; i < 4; i += 1) {
      const result = transformTemplate(current, 'r1');
      expect(result.status).toBe('valid');
      if (result.status !== 'valid') return;
      current = result.template;
    }
    const identity = transformTemplate(template, 'r0');
    expect(identity.status).toBe('valid');
    if (identity.status !== 'valid') return;
    expect(canonicalSignature(current)).toBe(canonicalSignature(identity.template));
    expect(current.topology.walkable).toEqual(template.topology.walkable);
    expect(current.exitCandidates).toEqual(template.exitCandidates);
  });

  it('moves regions, candidates, and exit faces consistently for every transform', () => {
    for (const id of TRANSFORM_IDS) {
      const result = transformTemplate(template, id);
      expect(result.status).toBe('valid');
      if (result.status !== 'valid') return;
      const variant = result.template;
      expect(variant.variantId).toBe(id);
      expect(variant.templateId).toBe(template.templateId);
      expect(variant.templateVersion).toBe(template.templateVersion);
      expect(variant.templateHash).toBe(template.templateHash);
      expect(variant.topology.topologyVersion).toBe(`master-v1@1#${id}`);
      const regions = [...variant.taggerRegions, ...variant.runnerSpawnRegions];
      const originals = [...template.taggerRegions, ...template.runnerSpawnRegions];
      regions.forEach((region, index) => {
        expect(region.regionId).toBe(originals[index]!.regionId);
        const keys = new Set(region.cells.map((c) => `${c.x},${c.y}`));
        for (const candidate of region.spawnCandidates) {
          expect(keys.has(`${candidate.x},${candidate.y}`)).toBe(true);
          expect(isWalkable(variant.topology, candidate)).toBe(true);
        }
        expect(region.cells).toHaveLength(originals[index]!.cells.length);
        expect(region.spawnCandidates).toHaveLength(originals[index]!.spawnCandidates.length);
      });
      expect(variant.exitCandidates).toHaveLength(template.exitCandidates.length);
      for (const face of variant.exitCandidates) {
        expect(isWalkable(variant.topology, face)).toBe(false);
        expect(isWalkable(variant.topology, approachOf(face))).toBe(true);
      }
    }
  });

  it('keeps asymmetric wall references and returns all eight distinct variants sorted by id', () => {
    const variants = createTemplateVariants(template);
    expect(variants.status).toBe('valid');
    if (variants.status !== 'valid') return;
    const ids = variants.variants.map((v) => v.variantId);
    expect(ids).toEqual(['mr0', 'mr1', 'mr2', 'mr3', 'r0', 'r1', 'r2', 'r3']);
    const signatures = new Set(variants.variants.map(canonicalSignature));
    expect(signatures.size).toBe(8);
  });

  it('collapses a mirror-symmetric template and keeps the smallest variantId of each group', () => {
    const { raw, source } = loadMaster();
    const symmetric = clone(raw) as Record<string, unknown> & {
      rows: string[];
      taggerRegions: unknown[];
      runnerSpawnRegions: unknown[];
      exitCandidates: unknown[];
    };
    symmetric.rows = Array.from({ length: 32 }, (_, y) =>
      y === 0 || y === 31 ? '#'.repeat(32) : `#${'.'.repeat(30)}#`,
    );
    for (const y of [15, 16]) {
      symmetric.rows[y] = `${symmetric.rows[y]!.slice(0, 15)}##${symmetric.rows[y]!.slice(17)}`;
    }
    const cellsOf = (x0: number, y0: number, x1: number, y1: number) => {
      const cells: { x: number; y: number }[] = [];
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) cells.push({ x, y });
      return cells;
    };
    const region = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
      regionId: id,
      cells: cellsOf(x0, y0, x1, y1),
      spawnCandidates: cellsOf(x0, y0, x1, y1),
    });
    symmetric.taggerRegions = [
      region('t-center', 15, 12, 16, 13),
      region('t-left', 10, 12, 12, 14),
      region('t-right', 19, 12, 21, 14),
    ];
    symmetric.runnerSpawnRegions = [
      region('r-center', 15, 28, 16, 29),
      region('r-left', 1, 1, 3, 3),
      region('r-right', 28, 1, 30, 3),
    ];
    symmetric.exitCandidates = [
      { x: 15, y: 15, side: 0 },
      { x: 15, y: 15, side: 3 },
      { x: 16, y: 15, side: 0 },
      { x: 16, y: 15, side: 1 },
      { x: 16, y: 16, side: 1 },
      { x: 16, y: 16, side: 2 },
      { x: 15, y: 16, side: 2 },
      { x: 15, y: 16, side: 3 },
    ];
    const validated = validateTemplate(symmetric, source);
    expect(validated.status).toBe('valid');
    if (validated.status !== 'valid') return;
    const variants = createTemplateVariants(validated.template);
    expect(variants.status).toBe('valid');
    if (variants.status !== 'valid') return;
    const ids = variants.variants.map((v) => v.variantId);
    expect(ids.length).toBeLessThan(8);
    // r0 and mr0 are identical here; the lexicographically smaller 'mr0' represents the group.
    expect(ids).toContain('mr0');
    expect(ids).not.toContain('r0');
    for (const variant of variants.variants) expect(variant.exitCandidates).toHaveLength(8);
  });

  it('reports a broken transform as invalid instead of dropping it', () => {
    const rectangular = {
      ...masterTemplate(),
      topology: { ...masterTemplate().topology, height: 16 },
    } as LayoutTemplate;
    expect(transformTemplate(rectangular, 'r1')).toMatchObject({
      status: 'invalid',
      code: 'INVALID_TEMPLATE',
    });
    expect(createTemplateVariants(rectangular)).toMatchObject({
      status: 'invalid',
      code: 'INVALID_TEMPLATE',
      path: ['r0', 'topology', 'width'],
    });
  });
});

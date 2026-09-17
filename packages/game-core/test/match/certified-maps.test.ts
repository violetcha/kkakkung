import { describe, expect, it } from 'vitest';

import { createTemplateVariants } from '../../src/match/map/transform.js';
import { certifyFallback } from '../../src/match/map/select-with-fallback.js';
import { validateConnectivity } from '../../src/match/map/validate-connectivity.js';
import { selectLayout } from '../../src/match/map/select-layout.js';
import { validateTuning } from '../../src/match/tuning.js';
import type { FallbackLayout, RosterEntry } from '../../src/match/types.js';
import {
  CERTIFIED_TEMPLATE_IDS,
  certifiedTemplate,
  loadFallbackFile,
  loadTemplateFile,
  loadTuning,
} from './helpers.js';

/**
 * Certification of the real server data: every validated variant of every shipped template must
 * be connected with a single core, carry a stored fallback with the same source fields, and that
 * fallback must pass the full layout rules for a real roster. Intended for `pnpm test:maps`
 * (root script owned by F). S15P21C204-267 added the corridor maze beside the open grid.
 */
const tuning = validateTuning(loadTuning());
if (!tuning.ok) throw new Error('tuning invalid');
const constraints = tuning.template.layout;

const roster: RosterEntry[] = [
  { playerId: 'p-tagger-c', role: 'tagger' },
  { playerId: 'p-tagger-a', role: 'tagger' },
  { playerId: 'p-tagger-b', role: 'tagger' },
  { playerId: 'p-runner-z', role: 'runner' },
  { playerId: 'p-runner-x', role: 'runner' },
  { playerId: 'p-runner-y', role: 'runner' },
];

type FallbackFile = {
  templateId: string;
  templateVersion: string;
  templateHash: string;
  fallbacks: FallbackLayout[];
};

describe.each(CERTIFIED_TEMPLATE_IDS)('%s certification', (templateId) => {
  const template = certifiedTemplate(templateId);
  const variants = createTemplateVariants(template);
  const file = loadFallbackFile(templateId) as FallbackFile;

  it('stores the SHA-256 of the current template file bytes', () => {
    const { source } = loadTemplateFile(templateId);
    expect(file.templateHash).toBe(source.templateHash);
    expect(file.templateId).toBe(templateId);
    expect(file.templateVersion).toBe('1');
  });

  it('has exactly one fallback per validated variant with matching source fields', () => {
    expect(variants.status).toBe('valid');
    if (variants.status !== 'valid') return;
    expect(file.fallbacks.map((f) => f.variantId).sort()).toEqual(
      variants.variants.map((v) => v.variantId).sort(),
    );
    for (const fallback of file.fallbacks) {
      expect(fallback.templateHash).toBe(file.templateHash);
      expect(fallback.templateId).toBe(template.templateId);
      expect(fallback.templateVersion).toBe(template.templateVersion);
      expect(fallback.layout.players.map((p) => p.playerId).sort()).toEqual([
        'runner-1',
        'runner-2',
        'runner-3',
        'tagger-1',
        'tagger-2',
        'tagger-3',
      ]);
    }
  });

  it('every variant is connected with one core and its fallback certifies for a real roster', () => {
    if (variants.status !== 'valid') return;
    for (const variant of variants.variants) {
      const report = validateConnectivity(variant, {
        minSpawnNeighbors: constraints.minSpawnNeighbors,
      });
      expect(report.ok, `${variant.variantId} connectivity`).toBe(true);
      const fallback = file.fallbacks.find((f) => f.variantId === variant.variantId)!;
      const certified = certifyFallback(
        { template: variant, players: roster, seed: 1, maxAttempts: 0, fallback },
        constraints,
      );
      expect(certified.status, `${variant.variantId} fallback`).toBe('selected');
      // A fallback of another variant is rejected for this variant.
      const other = file.fallbacks.find((f) => f.variantId !== variant.variantId)!;
      expect(
        certifyFallback(
          { template: variant, players: roster, seed: 1, maxAttempts: 0, fallback: other },
          constraints,
        ).status,
      ).toBe('unavailable');
    }
  });

  it('online selection succeeds within the configured attempt budget for several seeds', () => {
    if (variants.status !== 'valid') return;
    for (const variant of variants.variants) {
      for (const seed of [1, 2, 3]) {
        const result = selectLayout(
          variant,
          roster,
          seed,
          tuning.template.selection.maxAttempts,
          constraints,
        );
        expect(result.ok, `${variant.variantId} seed ${seed}`).toBe(true);
      }
    }
  });
});

it('the two templates are different terrain under the same rules', () => {
  const master = certifiedTemplate('master-v1');
  const maze = certifiedTemplate('maze-v1');
  expect(master.topology.width).toBe(32);
  expect(maze.topology.width).toBe(31);
  expect(loadTemplateFile('master-v1').source.templateHash).not.toBe(
    loadTemplateFile('maze-v1').source.templateHash,
  );
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { LayoutTemplate, MapSource } from '../../src/match/types.js';
import { validateTemplate } from '../../src/match/map/validate-template.js';

const serverRoot = new URL('../../../../server/', import.meta.url);

/** Mirrors the loader contract: hash is the SHA-256 of the original file bytes. */
export function loadServerJson(relativePath: string): { raw: unknown; hash: string } {
  const bytes = readFileSync(new URL(relativePath, serverRoot));
  return {
    raw: JSON.parse(bytes.toString('utf8')) as unknown,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Certified product templates: each ships `content/maps/<id>.json` and `<id>-fallback.json`. */
export const CERTIFIED_TEMPLATE_IDS = ['master-v1', 'maze-v1', 'maze-m-v1', 'maze-s-v1'] as const;
export type CertifiedTemplateId = (typeof CERTIFIED_TEMPLATE_IDS)[number];

export function loadTemplateFile(templateId: CertifiedTemplateId): {
  raw: Record<string, unknown>;
  source: MapSource;
} {
  const { raw, hash } = loadServerJson(`content/maps/${templateId}.json`);
  return {
    raw: raw as Record<string, unknown>,
    source: {
      templateId,
      templateVersion: '1',
      templateHash: hash,
      variantId: 'r0',
    },
  };
}

export function certifiedTemplate(templateId: CertifiedTemplateId): LayoutTemplate {
  const { raw, source } = loadTemplateFile(templateId);
  const result = validateTemplate(raw, source);
  if (result.status !== 'valid') throw new Error(JSON.stringify(result));
  return result.template;
}

export function loadFallbackFile(templateId: CertifiedTemplateId): unknown {
  return loadServerJson(`content/placements/${templateId}-fallback.json`).raw;
}

export function loadMaster(): { raw: Record<string, unknown>; source: MapSource } {
  return loadTemplateFile('master-v1');
}

export function masterTemplate(): LayoutTemplate {
  return certifiedTemplate('master-v1');
}

export function loadPractice(): unknown {
  return loadServerJson('content/maps/practice-v1.json').raw;
}

export function loadTuning(): unknown {
  return loadServerJson('config/tuning/mvp-v1.json').raw;
}

export function loadFallback(): unknown {
  return loadFallbackFile('master-v1');
}

/** Deep structural clone for mutation tests without touching the original. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

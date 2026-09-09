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

export function loadMaster(): { raw: Record<string, unknown>; source: MapSource } {
  const { raw, hash } = loadServerJson('content/maps/master-v1.json');
  return {
    raw: raw as Record<string, unknown>,
    source: {
      templateId: 'master-v1',
      templateVersion: '1',
      templateHash: hash,
      variantId: 'r0',
    },
  };
}

export function masterTemplate(): LayoutTemplate {
  const { raw, source } = loadMaster();
  const result = validateTemplate(raw, source);
  if (result.status !== 'valid') throw new Error(JSON.stringify(result));
  return result.template;
}

export function loadPractice(): unknown {
  return loadServerJson('content/maps/practice-v1.json').raw;
}

export function loadTuning(): unknown {
  return loadServerJson('config/tuning/mvp-v1.json').raw;
}

export function loadFallback(): unknown {
  return loadServerJson('content/placements/master-v1-fallback.json').raw;
}

/** Deep structural clone for mutation tests without touching the original. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

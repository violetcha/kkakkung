/**
 * S15P21C204-383. The tuning file's selection budget reaches the server's layout loader. It used
 * to be validated and then ignored: the loader kept its own 100ms / 256 / 8, so raising
 * `attemptsPerBatch` past 8 made every batch look invalid and every non-first-batch match lose
 * its layout.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/env.js';
import { loadProductProfile } from '../../src/game/ProductProfileLoader.js';
import { TEST_OPS_TOKEN } from './test-harness.js';

describe('product layout budget', () => {
  it('carries the tuning selection budget into the product profile', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SERVER_PROFILE: 'product',
      SERVICE_AUDIENCE: 'public',
      TRUST_PROXY_HOPS: '1',
      MEDIA_MODE: 'disabled',
      OPS_TOKEN: TEST_OPS_TOKEN,
      INVITE_MAX_TTL_MS: '600000',
      SESSION_ATTEMPT_WINDOW_MS: '60000',
      SESSION_ATTEMPTS_PER_INVITE: '20',
      SESSION_ATTEMPTS_PER_IP: '100',
      ROOM_IDLE_TTL_MS: '600000',
    });
    const profile = await loadProductProfile(config);
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const tuning = JSON.parse(await readFile(resolve(root, config.tuningPath), 'utf8'));
    expect(profile.layouts?.budget).toEqual(tuning.selection);
  });
});

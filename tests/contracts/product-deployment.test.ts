import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProductDeployment } from '../../server/src/config/ProductDeployment.js';
import { productCloudFixture } from '../../server/test/media/product-cloud-fixture.js';

describe('read-only product deployment preparation (synthetic evidence)', () => {
  it('rejects incomplete configuration without disclosing values', async () => {
    const result = await checkProductDeployment({
      env: { LIVEKIT_API_SECRET: 'never-print-this' },
      baseUrl: 'https://team.example',
      evidenceDir: '.',
      nowEpochMs: Date.now(),
    });
    expect(result).toEqual({ status: 'BLOCKED', failures: ['PRODUCT_ENV_INVALID'] });
  });
  it.each(['attested', 'continuous'] as const)(
    'validates %s preparation without consuming bootstrap markers',
    async (operatingMode) => {
      const f = await productCloudFixture(operatingMode);
      try {
        const c = f.config;
        const window = c.publicWindow;
        const env = {
          LIVEKIT_HTTP_URL: c.httpUrl,
          LIVEKIT_WS_URL: c.wsUrl,
          LIVEKIT_API_KEY: c.apiKey,
          LIVEKIT_API_SECRET: c.apiSecret,
          LIVEKIT_PROJECT_ALIAS: c.projectAlias,
          SERVICE_NAMESPACE: c.namespace,
          OPS_TOKEN: 'synthetic-operator',
          OPS_OPERATING_MODE: operatingMode,
          ...(window && !('mode' in window)
            ? {
                OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS: String(window.opensAtEpochMs),
                OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS: String(window.closesAtEpochMs),
                OPS_OFFICIAL_BUDGET_MAX_AGE_MS: '3600000',
              }
            : {}),
          OPS_OPERATION_TIMEOUT_MS: '1000',
          MEDIA_MAX_NORMAL_API_CALLS_PER_60S: '600',
          MEDIA_MAX_TOTAL_API_CALLS_PER_60S: '900',
          INVITE_MAX_TTL_MS: '600000',
          SESSION_ATTEMPT_WINDOW_MS: '60000',
          SESSION_ATTEMPTS_PER_INVITE: '20',
          SESSION_ATTEMPTS_PER_IP: '20',
          ROOM_IDLE_TTL_MS: '600000',
          MAX_ROOMS: '10',
          MAX_SLOTS: '60',
        };
        const input = {
          env,
          baseUrl: 'https://team.example',
          evidenceDir: c.opsDataDir,
          nowEpochMs: Date.now(),
        };
        const before = await readdir(c.opsDataDir);
        expect(await checkProductDeployment(input)).toEqual({ status: 'PREPARED', failures: [] });
        expect(await readdir(c.opsDataDir)).toEqual(before);
        if (window && !('mode' in window))
          expect(
            (await checkProductDeployment({ ...input, nowEpochMs: window.closesAtEpochMs })).status,
          ).toBe('BLOCKED');
        else {
          expect(before).not.toContain('official-usage-input.json');
          expect(
            (await checkProductDeployment({ ...input, nowEpochMs: Date.now() + 30 * 86400000 }))
              .status,
          ).toBe('PREPARED');
        }
        expect(
          (await checkProductDeployment({ ...input, env: { ...env, SERVICE_NAMESPACE: 'other' } }))
            .status,
        ).toBe('BLOCKED');
        const withoutCapacity = Object.fromEntries(
          Object.entries(env).filter(([key]) => key !== 'MAX_ROOMS' && key !== 'MAX_SLOTS'),
        );
        expect(await checkProductDeployment({ ...input, env: withoutCapacity })).toEqual({
          status: 'BLOCKED',
          failures: ['PRODUCT_CAPACITY_MISSING'],
        });
        expect(
          await checkProductDeployment({ ...input, env: { ...env, MAX_SLOTS: '54' } }),
        ).toEqual({ status: 'BLOCKED', failures: ['PRODUCT_ENV_INVALID'] });
        expect(
          await checkProductDeployment({
            ...input,
            env: { ...env, MAX_ROOMS: '11', MAX_SLOTS: '66' },
          }),
        ).toEqual({ status: 'BLOCKED', failures: ['PRODUCT_ENV_INVALID'] });
        await writeFile(join(c.opsDataDir, 'official-usage-input.json'), '{}');
        if (operatingMode === 'attested')
          expect((await checkProductDeployment(input)).failures).toContain(
            'OFFICIAL_USAGE_INVALID',
          );
        else expect((await checkProductDeployment(input)).status).toBe('PREPARED');
      } finally {
        await f.close();
      }
    },
  );
});

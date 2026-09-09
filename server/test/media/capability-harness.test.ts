import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import type { CloudPreflight } from '../../../tests/cloud/CloudPreflight.js';
import { requireCloudPreflight } from '../../../tests/cloud/CloudPreflight.js';
import {
  capabilityReport,
  confirmIdentityCleanup,
  CREDENTIALS,
  emptyEvidence,
  validateCapabilityPlan,
  type CapabilityEvidence,
} from './cloud/capability-evidence.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const env = {
  LIVEKIT_HTTP_URL: 'https://synthetic.invalid',
  LIVEKIT_WS_URL: 'wss://synthetic.invalid',
  LIVEKIT_API_KEY: 'synthetic-key',
  LIVEKIT_API_SECRET: 'synthetic-secret',
  LIVEKIT_PROJECT_ALIAS: 'synthetic',
  SERVICE_NAMESPACE: 'synthetic',
};
const plan: CloudPreflight = {
  projectAlias: 'synthetic',
  namespace: 'synthetic',
  sourceCommit: 'fixture',
  lockfileHash: 'fixture',
  checkedAtEpochMs: 1,
  expiresAtEpochMs: 999_999_999_999_999,
  remainingMinutes: 100,
  remainingBytes: 1_000_000_000,
  allowedCases: ['MC-01'],
  budgetReservation: {
    reservationId: 'synthetic-reservation',
    participantMinutes: 20,
    bytes: 120_000_000,
  },
  credentialEnvNames: CREDENTIALS,
  deviceManifest: { path: 'synthetic-device.json', mode: 'synthetic' },
  evidenceDir: '.local/qa/MC-01',
  maxRooms: 1,
  maxParticipants: 5,
  maxDurationSeconds: 90,
  cleanupAllowanceSeconds: 30,
};
const complete = (): CapabilityEvidence =>
  ({
    ...Object.fromEntries(Object.keys(emptyEvidence()).map((key) => [key, true])),
    clockOffsetUpperBoundMs: 1200,
  }) as CapabilityEvidence;

describe('MC-01 harness safety (synthetic local inputs, no Cloud proof)', () => {
  it('continues bounded cleanup after one identity fails and never confirms partial cleanup', async () => {
    const cleanup = vi.fn(async (identity: string) => {
      if (identity === 'second') throw new Error('synthetic-network-failure');
    });
    expect(await confirmIdentityCleanup(['first', 'second', 'third'], cleanup)).toBe(false);
    expect(cleanup.mock.calls.map(([identity]) => identity)).toEqual(['first', 'second', 'third']);
    expect(await confirmIdentityCleanup(['first', 'third'], cleanup)).toBe(true);
  });
  it('rejects direct execution before reading credentials or starting a browser', () => {
    expect(() => requireCloudPreflight('MC-01', {})).toThrow('RUN_CLOUD_TESTS=1 not set');
    const result = spawnSync(
      process.execPath,
      [
        'scripts/run-cloud-check.mjs',
        '--case',
        'MC-01',
        '--preflight',
        `.local/qa/missing-${randomUUID()}.json`,
        '--evidence',
        '.local/qa/MC-01',
      ],
      { cwd: root, encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('preflight file not found');
    expect(result.stdout).not.toContain('STARTING');
    expect(result.stderr).not.toContain('has not been handed over');
  });
  it.each(CREDENTIALS)('requires F to explicitly list and provide %s', (name) => {
    expect(() => validateCapabilityPlan(plan, { ...env, [name]: '' })).toThrow('MC01_REQUIRED_ENV');
    expect(() =>
      validateCapabilityPlan(
        { ...plan, credentialEnvNames: CREDENTIALS.filter((key) => key !== name) },
        env,
      ),
    ).toThrow('MC01_REQUIRED_ENV');
  });
  it.each([
    { SERVICE_NAMESPACE: 'other' },
    { LIVEKIT_PROJECT_ALIAS: 'other' },
    { LIVEKIT_HTTP_URL: 'http://synthetic.invalid' },
    { LIVEKIT_WS_URL: 'wss://other.invalid' },
    { LIVEKIT_HTTP_URL: 'https://synthetic.invalid/?secret=hidden' },
  ])('rejects a mismatched/unsafe environment before any network operation: %o', (patch) => {
    expect(() => validateCapabilityPlan(plan, { ...env, ...patch })).toThrow('MC01_');
  });
  it.each([
    { maxParticipants: 4 },
    { maxDurationSeconds: 301 },
    { cleanupAllowanceSeconds: 1 },
    { budgetReservation: { ...plan.budgetReservation, bytes: 1 } },
    { budgetReservation: { ...plan.budgetReservation, participantMinutes: 1 } },
  ])('rejects inadequate bounded reservations: %o', (patch) => {
    expect(() => validateCapabilityPlan({ ...plan, ...patch }, env)).toThrow('MC01_');
  });
  it('accepts the explicit synthetic plan without performing IO', () => {
    expect(validateCapabilityPlan(plan, env).httpUrl).toBe(env.LIVEKIT_HTTP_URL);
  });
  it.each(Object.keys(emptyEvidence()).filter((key) => key !== 'clockOffsetUpperBoundMs'))(
    'cannot mark SUPPORTED without %s',
    (key) => {
      const evidence = { ...complete(), [key]: false };
      expect(capabilityReport(plan, 'synthetic-room', evidence, 1000).status).toBe('BLOCKED');
    },
  );
  it.each([null, -1, NaN, Infinity, 55_000])(
    'cannot mark SUPPORTED for unverified/out-of-window clock %s',
    (offset) => {
      expect(
        capabilityReport(
          plan,
          'synthetic-room',
          { ...complete(), clockOffsetUpperBoundMs: offset },
          1000,
        ).status,
      ).toBe('BLOCKED');
    },
  );
  it('assembles the strict report only after every independent proof, including cleanup', () => {
    const report = capabilityReport(plan, 'synthetic-room', complete(), 1000);
    expect(report).toMatchObject({
      status: 'SUPPORTED',
      grantProfile: { canSubscribe: false },
      revocationProfile: { mode: 'explicit-cutoff', bufferSeconds: 5 },
    });
    expect(JSON.stringify(report)).not.toContain(env.LIVEKIT_API_SECRET);
    // Synthetic parser result intentionally remains memory-only, never a runtime capability file.
  });
  it('builds the real browser probe and starts inert without credentials or remote connections', async () => {
    const server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL('./cloud/', import.meta.url)),
      cacheDir: fileURLToPath(new URL('../../../.local/qa/mc01-local-vite/', import.meta.url)),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
    });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=no-user-gesture-required'],
      });
      const page = await browser.newPage();
      const external: string[] = [];
      page.on('request', (request) => {
        if (!request.url().startsWith(server.resolvedUrls!.local[0]!))
          external.push(new URL(request.url()).host);
      });
      await page.goto(`${server.resolvedUrls!.local[0]}capability.html`);
      await page.waitForFunction(() => !!window.capabilityProbe, undefined, { timeout: 15_000 });
      expect(await page.evaluate(() => window.capabilityProbe.measure())).toMatchObject({
        connected: false,
        refreshReceived: false,
        publications: 0,
        subscribed: 0,
        marker: null,
        frequency: null,
        bytesReceived: 0,
      });
      expect(
        await page.evaluate(() => window.capabilityProbe.reconnect('refreshed')),
      ).toMatchObject({ outcome: 'unconfirmed' });
      expect(external).toEqual([]);
    } finally {
      await browser?.close();
      await server.close();
    }
  }, 30_000);
});

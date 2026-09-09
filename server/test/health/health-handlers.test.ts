import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../../src/config/env.js';
import {
  createHealthHandlers,
  type HealthHandlersOptions,
} from '../../src/health/HealthHandlers.js';
import type { Readiness } from '../../src/media/types.js';

const closes: (() => Promise<void>)[] = [];
const healthy: Readiness = {
  state: 'READY',
  reasonCodes: [],
  historyComplete: true,
  unresolvedCount: 0,
};
const locked: Readiness = {
  state: 'LOCKED',
  reasonCodes: ['JOURNAL_WRITE_FAILED'],
  historyComplete: true,
  unresolvedCount: 1,
};

afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

/** Local HTTP consumer of the E exports; the real application is assembled by B. */
async function fixture(options: Partial<HealthHandlersOptions> = {}) {
  const getReadiness = vi.fn(options.getReadiness ?? (() => healthy));
  const isInitialized = vi.fn(options.isInitialized ?? (() => true));
  const handlers = createHealthHandlers({ getReadiness, isInitialized });
  const app = express();
  app.get('/health/live', handlers.live);
  app.get('/health/ready', handlers.ready);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closes.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (route: 'live' | 'ready') => {
    const response = await fetch(`${endpoint}/health/${route}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { state: string; reasonCodes: string[] };
    expect(Object.keys(body).sort()).toEqual(['reasonCodes', 'state']);
    return { response, body };
  };
  return { request, getReadiness, isInitialized };
}

describe('E-15 public health handlers through local HTTP', () => {
  it.each(['live', 'ready'] as const)(
    'keeps %s unavailable before local initialization without consulting readiness',
    async (route) => {
      const f = await fixture({ isInitialized: () => false });
      const { response, body } = await f.request(route);
      expect(response.status).toBe(503);
      expect(body).toEqual({
        state: 'INITIALIZING',
        reasonCodes: ['INITIALIZATION_UNCONFIRMED'],
      });
      expect(f.getReadiness).not.toHaveBeenCalled();
    },
  );

  it.each(['live', 'ready'] as const)(
    'contains an initialization observer exception on %s',
    async (route) => {
      const f = await fixture({
        isInitialized: () => {
          throw new Error('private-token-and-journal-path');
        },
      });
      const { response, body } = await f.request(route);
      expect(response.status).toBe(503);
      expect(body).toEqual({
        state: 'INITIALIZING',
        reasonCodes: ['INITIALIZATION_UNCONFIRMED'],
      });
      expect(f.getReadiness).not.toHaveBeenCalled();
    },
  );

  it('requires actual boolean initialization evidence', async () => {
    const f = await fixture({ isInitialized: () => 'true' as unknown as boolean });
    expect((await f.request('live')).response.status).toBe(503);
    expect((await f.request('ready')).response.status).toBe(503);
    expect(f.getReadiness).not.toHaveBeenCalled();
  });

  it.each(['READY', 'RECOVERING', 'LOCKED'] as const)(
    'reports process liveness during %s without consulting the readiness observer',
    async (state) => {
      const f = await fixture({ getReadiness: () => ({ ...locked, state }) });
      const { response, body } = await f.request('live');
      expect(response.status).toBe(200);
      expect(body).toEqual({ state: 'LIVE', reasonCodes: [] });
      expect(f.getReadiness).not.toHaveBeenCalled();
    },
  );

  it('keeps live available when the readiness observer throws without leaking its error', async () => {
    const f = await fixture({
      getReadiness: () => {
        throw new Error('private-token-and-identity');
      },
    });
    expect((await f.request('live')).response.status).toBe(200);
    expect(f.getReadiness).not.toHaveBeenCalled();
    const { response, body } = await f.request('ready');
    expect(response.status).toBe(503);
    expect(body).toEqual({ state: 'LOCKED', reasonCodes: ['READINESS_UNCONFIRMED'] });
  });

  it.each([
    { snapshot: healthy, status: 200 },
    {
      snapshot: { ...healthy, state: 'RECOVERING', reasonCodes: ['CLEANUP_PENDING'] },
      status: 503,
    },
    { snapshot: locked, status: 503 },
  ] as const)(
    'projects only state and safe reasons for $snapshot.state',
    async ({ snapshot, status }) => {
      const f = await fixture({ getReadiness: () => snapshot });
      const { response, body } = await f.request('ready');
      expect(response.status).toBe(status);
      expect(body).toEqual({ state: snapshot.state, reasonCodes: snapshot.reasonCodes });
      expect(f.getReadiness).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { ...healthy, historyComplete: false },
    { ...healthy, unresolvedCount: 1 },
    { ...healthy, reasonCodes: ['CLEANUP_PENDING'] },
  ])('rejects inconsistent READY evidence %#', async (snapshot) => {
    const f = await fixture({ getReadiness: () => snapshot });
    const { response, body } = await f.request('ready');
    expect(response.status).toBe(503);
    expect(body.state).toBe('LOCKED');
  });

  it.each([
    null,
    undefined,
    {},
    { ...healthy, state: 'OPEN' },
    { ...healthy, historyComplete: 'true' },
    { ...healthy, unresolvedCount: Number.NaN },
    { ...healthy, unresolvedCount: -1 },
    { ...healthy, unresolvedCount: 0.5 },
    { ...healthy, reasonCodes: 'private-credential' },
  ])('rejects malformed runtime readiness data %#', async (snapshot) => {
    const f = await fixture({ getReadiness: () => snapshot as Readiness });
    const { response, body } = await f.request('ready');
    expect(response.status).toBe(503);
    expect(body.state).toBe('LOCKED');
    expect(JSON.stringify(body)).not.toContain('private-credential');
  });

  it('excludes extra fields and arbitrary reason text even from an injected producer', async () => {
    const f = await fixture({
      getReadiness: () => ({
        ...locked,
        reasonCodes: ['JOURNAL_WRITE_FAILED', 'private-token-and-identity'],
        mediaIdentity: 'private-token-and-identity',
        token: 'private-token-and-identity',
        remainingMinutes: 9_999,
        history: { path: 'private-token-and-identity' },
      }),
    });
    const { response, body } = await f.request('ready');
    expect(response.status).toBe(503);
    expect(body.state).toBe('LOCKED');
    expect(body.reasonCodes.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(
      /private-token|mediaIdentity|remainingMinutes|history/,
    );
  });

  it('contains exceptions raised by malformed readiness properties', async () => {
    const f = await fixture({
      getReadiness: () => ({
        ...healthy,
        get state(): Readiness['state'] {
          throw new Error('private-getter-value');
        },
      }),
    });
    const { response, body } = await f.request('ready');
    expect(response.status).toBe(503);
    expect(body.state).toBe('LOCKED');
    expect(JSON.stringify(body)).not.toContain('private-getter-value');
  });

  it('reads current evidence on each request and closes again when initialization is lost', async () => {
    let snapshot: Readiness = { ...healthy, state: 'RECOVERING', reasonCodes: ['CLEANUP_PENDING'] };
    let initialized = true;
    const f = await fixture({
      getReadiness: () => snapshot,
      isInitialized: () => initialized,
    });
    expect((await f.request('ready')).response.status).toBe(503);
    snapshot = healthy;
    expect((await f.request('ready')).response.status).toBe(200);
    snapshot = locked;
    expect((await f.request('ready')).response.status).toBe(503);
    expect((await f.request('live')).response.status).toBe(200);
    initialized = false;
    expect((await f.request('live')).response.status).toBe(503);
    expect((await f.request('ready')).response.status).toBe(503);
  });
});

describe('E-15 preserves the current F configuration boundary', () => {
  it.each(['disabled', 'mock'])(
    'does not enable production using the %s media profile',
    (mediaMode) => {
      expect(() => parseConfig({ NODE_ENV: 'production', MEDIA_MODE: mediaMode })).toThrow(
        'Unsupported skeleton configuration',
      );
    },
  );

  it('keeps the explicitly disabled development profile available for existing local tooling', () => {
    expect(parseConfig({ NODE_ENV: 'test', MEDIA_MODE: 'disabled' }).mediaMode).toBe('disabled');
  });
});

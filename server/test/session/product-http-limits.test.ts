import { createServer, request as httpRequest, type ClientRequest } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { Client, type Room } from '@colyseus/sdk';
import { sessionResponseSchema } from '@kkakkung/protocol/game-messages';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { afterEach, expect, it } from 'vitest';
import { installHttpBoundary } from '../../src/session/HttpBoundary.js';
import { ProductHttpLimiter } from '../../src/session/ProductHttpLimiter.js';
import { bootProductApplication, TEST_OPS_TOKEN } from '../room/test-harness.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function fixture(options: { holdUnauthorized?: boolean; bodyTimeoutMs?: number } = {}) {
  let now = 0;
  let downstream = 0;
  const pending: (() => void)[] = [];
  const app = express();
  const limiter = new ProductHttpLimiter({
    now: () => now,
    clientIp: () => 'shared-school-nat',
    authorize: (header) => header === 'Bearer fixture-operator',
    sessionId: (token) => (token?.startsWith('fixture-session-') ? token : null),
  });
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  const handler = limiter.wrap(async (req, res) => {
    downstream++;
    const authorized = req.get('authorization')?.startsWith('Bearer fixture-');
    if (!authorized && options.holdUnauthorized)
      await new Promise<void>((resolve) => pending.push(resolve));
    res.status(authorized ? 200 : 403).json({ ok: !!authorized });
  });
  app.all('/api/operations/status', handler);
  app.all('/api/media/grants', handler);
  app.all('/api/media/report', handler);
  app.post('/api/raw-webhook', (req, res) => {
    req.resume();
    req.on('end', () => res.sendStatus(204));
  });
  app.get('/health/live', (_req, res) => res.sendStatus(200));
  const server = createServer(app);
  installHttpBoundary(server, {
    allowedOrigins: ['http://localhost:5173'],
    rawBodyPaths: ['/api/raw-webhook'],
    bodyTimeoutMs: options.bodyTimeoutMs ?? 5000,
    allowRequest: (req, path, res) => limiter.allow(req, path, res),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('NO_TEST_ADDRESS');
  const url = `http://127.0.0.1:${address.port}`;
  closers.push(async () => {
    pending.splice(0).forEach((resolve) => resolve());
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  return {
    url,
    limiter,
    nextWindow: () => {
      now += 1001;
    },
    calls: () => downstream,
    release: () => pending.splice(0).forEach((resolve) => resolve()),
  };
}

it('bounds invalid JSON before parsing, including case and trailing-slash route variants', async () => {
  const f = await fixture();
  const responses = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      fetch(f.url + (i % 2 ? '/API/OPERATIONS/status/' : '/api/media/grants/'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid',
      }),
    ),
  );
  expect(responses.filter((response) => response.status === 400).length).toBeLessThanOrEqual(5);
  expect(responses.filter((response) => response.status === 429).length).toBeGreaterThanOrEqual(95);
  expect(f.calls()).toBe(0);
  expect(f.limiter.retained.unauthorized).toMatchObject({
    active: 0,
    work: 0,
    inviteKeys: 1,
  });
  expect(f.limiter.retained.unauthorized?.timestamps).toBeLessThanOrEqual(10);
  expect(
    (
      await fetch(f.url + '/api/operations/status', {
        headers: { authorization: 'Bearer fixture-operator' },
      })
    ).status,
  ).toBe(200);
  const media = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      fetch(f.url + '/api/media/report', {
        method: 'POST',
        headers: {
          authorization: `Bearer fixture-session-${i}`,
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    ),
  );
  expect(media.map((response) => response.status)).toEqual(Array(6).fill(200));
  const preflight = await Promise.all(
    Array.from({ length: 6 }, () =>
      fetch(f.url + '/api/media/grants', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
      }),
    ),
  );
  expect(preflight.map((response) => response.status)).toEqual(Array(6).fill(204));
});

it('keeps unfinished async work charged after callers disconnect', async () => {
  const f = await fixture({ holdUnauthorized: true });
  const requests: ClientRequest[] = [];
  for (let i = 0; i < 4; i++) {
    const request = httpRequest(f.url + '/api/operations/status');
    request.on('error', () => {});
    request.end();
    requests.push(request);
  }
  await expect.poll(() => f.calls()).toBe(4);
  requests.forEach((request) => request.destroy());
  await expect.poll(() => f.limiter.retained.unauthorized?.active).toBe(0);
  expect(f.limiter.retained.unauthorized?.work).toBe(4);
  f.nextWindow();
  expect((await fetch(f.url + '/api/operations/status')).status).toBe(429);
  expect(f.calls()).toBe(4);
  expect(
    (
      await fetch(f.url + '/api/operations/status', {
        headers: { authorization: 'Bearer fixture-operator' },
      })
    ).status,
  ).toBe(200);
  f.release();
  await expect.poll(() => f.limiter.retained.unauthorized?.work).toBe(0);
});

it('times out unfinished chunked bodies without running handlers or retaining HTTP capacity', async () => {
  const f = await fixture({ bodyTimeoutMs: 80 });
  const request = httpRequest(f.url + '/API/MEDIA/grants/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  const response = once(request, 'response');
  request.on('error', () => {});
  request.write('{');
  const [incoming] = await response;
  expect(incoming.statusCode).toBe(408);
  incoming.resume();
  await expect.poll(() => f.limiter.retained.unauthorized?.active).toBe(0);
  expect(f.calls()).toBe(0);
  expect((await fetch(f.url + '/health/live')).status).toBe(200);
  request.destroy();
});

it('releases aborted body slots and leaves the signed raw-body route untouched', async () => {
  const f = await fixture({ bodyTimeoutMs: 1000 });
  const request = httpRequest(f.url + '/api/media/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  request.on('error', () => {});
  request.write('{');
  await expect.poll(() => f.limiter.retained.unauthorized?.active).toBe(1);
  request.destroy();
  await expect.poll(() => f.limiter.retained.unauthorized?.active).toBe(0);
  expect(f.calls()).toBe(0);
  expect(
    (await fetch(f.url + '/api/raw-webhook', { method: 'POST', body: 'x'.repeat(4096) })).status,
  ).toBe(204);
});

it('allows every one of sixty sessions before rejecting one noisy session', async () => {
  const f = await fixture();
  for (let round = 0; round < 2; round++) {
    const responses = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        fetch(f.url + '/api/media/report', {
          method: 'POST',
          headers: {
            authorization: `Bearer fixture-session-${i}`,
            'content-type': 'application/json',
          },
          body: '{}',
        }),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
  }
  const noisy = await Promise.all(
    Array.from({ length: 20 }, () =>
      fetch(f.url + '/api/media/report', {
        method: 'POST',
        headers: { authorization: 'Bearer fixture-session-0' },
      }),
    ),
  );
  expect(noisy.filter((response) => response.status === 429)).toHaveLength(10);
  expect(f.limiter.retained.media?.active).toBe(0);
  expect(f.limiter.retained.media?.work).toBe(0);
  expect(f.limiter.retained.media?.inviteKeys).toBe(60);
});

it('the real application preserves admission and metrics while invalid operation requests are limited', async () => {
  const metrics: { name: string; value: number }[] = [];
  const f = await bootProductApplication({ emitMetric: (metric) => metrics.push(metric) });
  closers.push(() => f.application.close());
  const responses = await Promise.all(
    Array.from({ length: 50 }, () => fetch(f.endpoint + '/API/OPERATIONS/status')),
  );
  expect(responses.some((response) => response.status === 429)).toBe(true);
  expect(
    (
      await fetch(f.endpoint + '/api/operations/invitations', {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_OPS_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: { allowCreate: true, roomCodes: [] },
          expiresAt: Date.now() + 60_000,
        }),
      })
    ).status,
  ).toBe(201);
  expect((await fetch(f.endpoint + '/health/live')).status).toBe(200);
  const invitation = f.application.invites!.issue({
    scope: { allowCreate: true, roomCodes: [] },
    expiresAt: Date.now() + 60_000,
  });
  if (invitation.status !== 'issued') throw new Error(invitation.code);
  let roomCode: string | undefined;
  const rooms: Room[] = [];
  closers.push(async () => {
    await Promise.all(rooms.map((room) => (room.connection.isOpen ? room.leave() : undefined)));
  });
  for (let i = 0; i < 6; i++) {
    const response = await fetch(f.endpoint + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nickname: `http-test-${i}`,
        createRoom: i === 0,
        roomCode,
        inviteToken: invitation.invitation.inviteToken,
      }),
    });
    expect(response.status).toBe(201);
    const session = sessionResponseSchema.parse(await response.json());
    roomCode = session.roomCode;
    const room = await new Client(f.endpoint).joinOrCreate(PRODUCT_ROOM_NAME, {
      token: session.sessionToken,
      roomCode,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    });
    room.reconnection.enabled = false;
    room.onMessage('*', () => undefined);
    rooms.push(room);
  }
  const ticksBefore = metrics.filter((metric) => metric.name === 'tick.duration').length;
  await Promise.all(
    Array.from({ length: 100 }, () => fetch(f.endpoint + '/api/operations/status')),
  );
  await expect
    .poll(() => metrics.filter((metric) => metric.name === 'tick.duration').length)
    .toBeGreaterThan(ticksBefore);
  expect(rooms.every((room) => room.connection.isOpen)).toBe(true);
  expect(f.application.slots!.totalOccupied()).toBe(6);
  await expect
    .poll(
      () => metrics.some((metric) => metric.name === 'http.requests.rejected' && metric.value > 0),
      { timeout: 3000 },
    )
    .toBe(true);
});

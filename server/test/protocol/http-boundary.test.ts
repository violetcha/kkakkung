/**
 * Real HTTP server boundary: Origin and 2KB body limits are enforced before the Colyseus
 * matchmaking router, OPTIONS pre-flight and Express, with zero room/seat side effects.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, ROOM_NAME } from '@kkakkung/protocol/version';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';
import { checkOrigin } from '../../src/session/HttpBoundary.js';

const ALLOWED = 'http://localhost:5173';
const BAD = 'https://unexpected.example';

describe('HTTP/WS entry boundary', () => {
  const application = createApplication({
    ...parseConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    port: 0,
  });
  let endpoint: string;
  let port: number;
  const roomCount = async () => (await matchMaker.query({})).length;

  beforeAll(async () => {
    port = await application.listen();
    endpoint = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await application.close();
  });

  const request = (path: string, init: RequestInit & { origin?: string } = {}) => {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.origin !== undefined) headers.origin = init.origin;
    return fetch(endpoint + path, { ...init, headers });
  };

  it('classifies origins exactly: absent allowed, null/empty/multiple/unknown rejected', () => {
    expect(checkOrigin(undefined, [ALLOWED])).toBe('absent');
    expect(checkOrigin(ALLOWED, [ALLOWED])).toBe('allowed');
    for (const bad of [
      'null',
      '',
      `${ALLOWED}, ${BAD}`,
      BAD,
      'http://localhost:5173/',
      'HTTP://localhost:5173',
    ])
      expect(checkOrigin(bad, [ALLOWED])).toBe('rejected');
    expect(checkOrigin([ALLOWED, ALLOWED], [ALLOWED])).toBe('rejected');
  });

  it('rejects disallowed origins on API, matchmaking and OPTIONS before any reservation', async () => {
    const before = await roomCount();
    for (const path of [
      '/api/config',
      '/matchmake/joinOrCreate/kkakkung',
      '/matchmake/create/kkakkung',
      '/matchmake/joinOrCreate/sandbox',
    ]) {
      const method = path.startsWith('/matchmake') ? 'POST' : 'GET';
      const response = await request(path, {
        method,
        origin: BAD,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      expect(response.status, path).toBe(403);
      expect(await response.json()).toEqual({ error: 'ORIGIN_NOT_ALLOWED' });
      const preflight = await request(path, {
        method: 'OPTIONS',
        origin: BAD,
        headers: { 'access-control-request-method': method },
      });
      expect(preflight.status, `OPTIONS ${path}`).toBe(403);
    }
    for (const origin of ['null', `${ALLOWED}, ${BAD}`]) {
      expect(
        (
          await request('/matchmake/joinOrCreate/kkakkung', {
            method: 'POST',
            origin,
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(403);
    }
    expect(await roomCount()).toBe(before);
  });

  it('keeps allowed origins and origin-less development requests working', async () => {
    const allowed = await request('/api/config', { origin: ALLOWED });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    const preflight = await request('/matchmake/joinOrCreate/kkakkung', {
      method: 'OPTIONS',
      origin: ALLOWED,
      headers: { 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    const dev = await request('/health/live');
    expect(dev.status).toBe(200);
    const before = await roomCount();
    const matchmake = await request('/matchmake/joinOrCreate/kkakkung', {
      method: 'POST',
      origin: ALLOWED,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(matchmake.status).toBe(200);
    expect(await roomCount()).toBe(before + 1);
  });

  it('ends bodies over 2,048 bytes with 413 and no reservation, by Content-Length and by actual bytes', async () => {
    const before = await roomCount();
    const oversized = JSON.stringify({ token: 'x'.repeat(2049 - 12) });
    expect(Buffer.byteLength(oversized)).toBe(2049);
    const declared = await request('/matchmake/joinOrCreate/kkakkung', {
      method: 'POST',
      origin: ALLOWED,
      headers: { 'content-type': 'application/json' },
      body: oversized,
    });
    expect(declared.status).toBe(413);
    const chunked = await request('/matchmake/joinOrCreate/kkakkung', {
      method: 'POST',
      origin: ALLOWED,
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oversized.slice(0, 1200)));
          controller.enqueue(new TextEncoder().encode(oversized.slice(1200)));
          controller.close();
        },
      }),
      // @ts-expect-error Node fetch requires duplex for streamed bodies.
      duplex: 'half',
    });
    expect(chunked.status).toBe(413);
    const session = await request('/api/dev-sessions', {
      method: 'POST',
      origin: ALLOWED,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'x'.repeat(2100) }),
    });
    expect(session.status).toBe(413);
    // None of the oversized requests created a room or a seat reservation.
    expect(await roomCount()).toBe(before);
    const boundary = JSON.stringify({ token: 'y'.repeat(2048 - 12) });
    expect(Buffer.byteLength(boundary)).toBe(2048);
    const exact = await request('/matchmake/joinOrCreate/kkakkung', {
      method: 'POST',
      origin: ALLOWED,
      headers: { 'content-type': 'application/json' },
      body: boundary,
    });
    expect(exact.status).toBe(200);
  });

  it('refuses WebSocket upgrades from disallowed origins and accepts allowed ones', async () => {
    const attempt = (origin: string) =>
      new Promise<'open' | 'rejected'>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/${ROOM_NAME}?sessionId=none`, {
          headers: { origin },
        });
        socket.once('open', () => {
          socket.close();
          resolve('open');
        });
        socket.once('unexpected-response', () => resolve('rejected'));
        socket.once('error', () => resolve('rejected'));
      });
    expect(await attempt(BAD)).toBe('rejected');
    expect(await attempt(ALLOWED)).toBe('open');
    expect(PROTOCOL_VERSION).toBe('0.1.0');
  });
});

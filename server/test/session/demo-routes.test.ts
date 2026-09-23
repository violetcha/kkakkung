import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_ADMIN_ROOM_ROUTE,
  DEMO_ROOM_ROUTE,
  demoRoomResponseSchema,
} from '@kkakkung/protocol/game-messages';
import { createDemoAdminRoutes, createDemoRoutes } from '../../src/session/DemoRoutes.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { TEST_OPS_TOKEN, createTestOperatorAuth } from '../room/test-harness.js';

describe('operator demo session admission', () => {
  let server: Server;
  let endpoint: string;
  let now = 1_000_000;
  const sessions = new ProductSessionStore({ now: () => now });
  // 여러 시험이 한 레지스트리에 데모 방을 연다. 데모 방 상한 자체는 아래 별도 시험이 본다.
  const slots = new SlotRegistry({ maxRooms: 2, maxDemoRooms: 3 });

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createDemoRoutes({
        sessions,
        slots,
        authorize: createTestOperatorAuth(TEST_OPS_TOKEN),
        monotonicNow: () => now,
        demoAdmissionTtlMs: 10 * 60_000,
      }),
    );
    app.use(
      createDemoAdminRoutes({
        sessions,
        slots,
        trustedProxy: true,
        // S15P21C204-367. 로그인 게이트를 지난 이메일 중 운영자 목록에 있는 것만 받는다.
        operatorAllowed: (identity) => identity === 'gitlab-member',
        monotonicNow: () => now,
        demoAdmissionTtlMs: 10 * 60_000,
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('exposes the demo kind and returns the first-connection deadline', async () => {
    const response = await fetch(endpoint + DEMO_ROOM_ROUTE, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_OPS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ role: 'runner' }),
    });

    expect(response.status).toBe(201);
    const body = demoRoomResponseSchema.parse(await response.json());
    expect(body.expiresAt).toBe(now + 10 * 60_000);
    expect(slots.optionsOf(body.roomCode)).toMatchObject({
      capacity: 1,
      kind: 'demo',
      operatorRole: 'runner',
    });
    expect(sessions.authenticate(body.sessionToken)).not.toBeNull();

    now += 10 * 60_000;
    expect(sessions.authenticate(body.sessionToken)).toBeNull();
    expect(slots.slotState(body.roomCode, body.playerId)).toBe('RESERVED');
  });

  it('accepts the separately asserted administrator identity but never a browser Bearer', async () => {
    const denied = await fetch(endpoint + DEMO_ADMIN_ROOM_ROUTE, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_OPS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ role: 'tagger' }),
    });
    expect(denied.status).toBe(401);

    const response = await fetch(endpoint + DEMO_ADMIN_ROOM_ROUTE, {
      method: 'POST',
      headers: { 'x-demo-admin': 'gitlab-member', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'tagger' }),
    });
    expect(response.status).toBe(201);
    expect(demoRoomResponseSchema.parse(await response.json()).role).toBe('tagger');

    // S15P21C204-367. 게이트는 SSAFY 계정 전체를 통과시킨다. 목록 밖 계정은 데모를 열지 못한다.
    const outsider = await fetch(endpoint + DEMO_ADMIN_ROOM_ROUTE, {
      method: 'POST',
      headers: { 'x-demo-admin': 'student@example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'tagger' }),
    });
    expect(outsider.status).toBe(401);
  });
});

// S15P21C204-312. 데모 방은 경기 방 예산(MAX_ROOMS)과 따로 센다. 시연 중에도 경기 방은 그대로다.
describe('demo room budget', () => {
  it('opens a demo room while every match room is taken, and refuses a second demo by its own code', async () => {
    const slots = new SlotRegistry({ maxRooms: 1, maxDemoRooms: 1 });
    expect(slots.reserve('M00001', 'p0', 0, { create: true })).toBe('reserved');
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createDemoRoutes({
        sessions: new ProductSessionStore({ now: () => 0 }),
        slots,
        authorize: createTestOperatorAuth(TEST_OPS_TOKEN),
        monotonicNow: () => 0,
        demoAdmissionTtlMs: 60_000,
      }),
    );
    const local = createServer(app);
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
    const address = local.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const open = () =>
      fetch(url + DEMO_ROOM_ROUTE, {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_OPS_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'runner' }),
      });
    try {
      expect((await open()).status).toBe(201);
      const second = await open();
      expect(second.status).toBe(503);
      expect(await second.json()).toEqual({ error: 'DEMO_ROOM_LIMIT' });
      // 경기 방 예산은 데모 때문에 줄지 않았다: 다음 경기 방은 경기 방 상한(1)으로만 막힌다.
      expect(slots.reserve('M00002', 'q0', 0, { create: true })).toBe('ROOM_LIMIT');
    } finally {
      await new Promise<void>((resolve) => local.close(() => resolve()));
    }
  });
});

import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ROOM_ROUTE, demoRoomResponseSchema } from '@kkakkung/protocol/game-messages';
import { createDemoRoutes } from '../../src/session/DemoRoutes.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { TEST_OPS_TOKEN, createTestOperatorAuth } from '../room/test-harness.js';

describe('operator demo session admission', () => {
  let server: Server;
  let endpoint: string;
  let now = 1_000_000;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });

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
});

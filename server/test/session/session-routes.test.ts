import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_ROUTE, sessionResponseSchema } from '@kkakkung/protocol/game-messages';
import { AdmissionLimiter } from '../../src/session/AdmissionLimiter.js';
import { InviteStore } from '../../src/session/InviteStore.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import {
  createSessionRoutes,
  generateRoomCode,
  type AdmissionState,
} from '../../src/session/SessionRoutes.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';

describe('POST /api/sessions', () => {
  let server: Server;
  let endpoint: string;
  let admission: AdmissionState = 'OPEN';
  let monotonic = 0;
  const epoch = 1_000_000;
  const slots = new SlotRegistry({ maxRooms: 2 });
  const sessions = new ProductSessionStore({ now: () => epoch });
  const invites = new InviteStore({
    now: () => epoch,
    maxTtlMs: 60_000,
    publicWindow: { opensAtEpochMs: 0, closesAtEpochMs: 2_000_000 },
    knownRoomCodes: () => slots.roomCodes(),
    operationsReady: () => true,
  });
  const limiter = new AdmissionLimiter({ windowMs: 60_000, perInvite: 4, perIp: 10 });
  const token = (allowCreate: boolean, roomCodes: string[] = []) => {
    const issued = invites.issue({ scope: { allowCreate, roomCodes }, expiresAt: epoch + 30_000 });
    if (issued.status !== 'issued') throw new Error(issued.code);
    return issued.invitation.inviteToken;
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createSessionRoutes({
        invites,
        sessions,
        slots,
        limiter,
        admission: () => admission,
        monotonicNow: () => monotonic,
        trustProxy: false,
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
  const post = (body: unknown) =>
    fetch(endpoint + SESSION_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('creates a room with a create-scoped invitation and lets the same invitation join it', async () => {
    const invite = token(true);
    const created = await post({ nickname: '하나', inviteToken: invite, createRoom: true });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const body = sessionResponseSchema.parse(await created.json());
    expect(body.protocolVersion).toBe('0.2.0');
    expect(slots.slotState(body.roomCode, body.playerId)).toBe('RESERVED');
    const joined = await post({
      nickname: '둘',
      inviteToken: invite,
      createRoom: false,
      roomCode: body.roomCode,
    });
    expect(joined.status).toBe(201);
    const second = sessionResponseSchema.parse(await joined.json());
    expect(second.roomCode).toBe(body.roomCode);
    expect(second.playerId).not.toBe(body.playerId);
    // A different invitation cannot enter with the room code alone.
    const stranger = await post({
      nickname: '셋',
      inviteToken: token(true),
      createRoom: false,
      roomCode: body.roomCode,
    });
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({ error: 'INVALID_INVITATION' });
    expect(slots.occupied(body.roomCode)).toBe(2);
  });

  it('rejects malformed union branches without reserving anything', async () => {
    const before = slots.totalOccupied();
    const invite = token(true);
    expect(
      (await post({ nickname: '하나', inviteToken: invite, createRoom: true, roomCode: 'ABC234' }))
        .status,
    ).toBe(400);
    expect((await post({ nickname: '하나', inviteToken: invite, createRoom: false })).status).toBe(
      400,
    );
    expect((await post({ nickname: '', inviteToken: invite, createRoom: true })).status).toBe(400);
    expect((await post({ nickname: '하나', inviteToken: 'ABC234', createRoom: true })).status).toBe(
      400,
    );
    // Invitation scope is checked before room existence so no room information leaks.
    expect(
      (await post({ nickname: '하나', inviteToken: invite, createRoom: false, roomCode: 'ZZZ999' }))
        .status,
    ).toBe(403);
    expect(slots.totalOccupied()).toBe(before);
  });

  it('limits attempts per invitation first and closes admission when draining', async () => {
    const invite = token(true);
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      monotonic += 1;
      results.push(
        (await post({ nickname: `n${i}`, inviteToken: invite, createRoom: true })).status,
      );
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    admission = 'DRAINING';
    const closed = await post({ nickname: '하나', inviteToken: token(true), createRoom: true });
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: 'ADMISSION_CLOSED' });
    admission = 'OPEN';
  });

  it('generates codes from the unambiguous alphabet and skips existing ones', () => {
    const code = generateRoomCode(() => false);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    let calls = 0;
    expect(() => generateRoomCode(() => ++calls <= 64)).toThrow('ROOM_CODE_EXHAUSTED');
  });
});

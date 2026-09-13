import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_ROUTE, sessionResponseSchema } from '@kkakkung/protocol/game-messages';
import { AdmissionLimiter } from '../../src/session/AdmissionLimiter.js';
import { InviteStore } from '../../src/session/InviteStore.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import {
  createSessionRoutes,
  generateRoomCode,
  type AdmissionState,
  type SessionRouteDeps,
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

  beforeEach(() => {
    monotonic += 60_000;
  });

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

  it('bounds invalid-token and malformed requests before they can reserve a seat', async () => {
    const before = slots.totalOccupied();
    for (let i = 0; i < 10; i++) {
      const response = await post(
        i % 2
          ? {}
          : {
              nickname: '반복',
              inviteToken: `invalid-${String(i).padStart(40, 'x')}`,
              createRoom: true,
            },
      );
      expect([400, 403]).toContain(response.status);
    }
    const limited = await post({});
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(slots.totalOccupied()).toBe(before);
    monotonic += 60_000;
    expect((await post({})).status).toBe(400);
  });
});

describe('GitLab team admission through the trusted ingress', () => {
  let server: Server;
  let endpoint: string;
  let deps: SessionRouteDeps;
  let admission: AdmissionState;
  let monotonic: number;
  beforeEach(async () => {
    admission = 'OPEN';
    monotonic = 0;
    const slots = new SlotRegistry({ maxRooms: 1 });
    deps = {
      slots,
      sessions: new ProductSessionStore({ now: () => 1_000_000 }),
      invites: new InviteStore({
        now: () => 1_000_000,
        maxTtlMs: 60_000,
        publicWindow: { mode: 'continuous' },
        knownRoomCodes: () => slots.roomCodes(),
        operationsReady: () => true,
      }),
      limiter: new AdmissionLimiter({ windowMs: 60_000, perInvite: 3, perIp: 10 }),
      admission: () => admission,
      monotonicNow: () => monotonic,
      trustProxy: true,
      admissionMode: 'gitlab-sso',
    };
    const app = express();
    app.use(express.json());
    // Rebuild per request so refusal tests can exercise both configuration flags.
    app.use((req, res, next) => createSessionRoutes(deps)(req, res, next));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    endpoint = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0);
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(endpoint + SESSION_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const create = { nickname: 'team', createRoom: true };
  const identity = (user: string) => ({ 'x-sso-user': user });

  it('validates an explicitly supplied link for team members while retaining link-free code admission', async () => {
    const host = sessionResponseSchema.parse(await (await post(create, identity('host'))).json());
    const link = deps.invites.issue({
      scope: { allowCreate: false, roomCodes: [host.roomCode] },
      expiresAt: 1_030_000,
    });
    if (link.status !== 'issued') throw new Error(link.code);
    const request = {
      nickname: 'friend',
      createRoom: false,
      roomCode: host.roomCode,
      inviteToken: link.invitation.inviteToken,
    };
    const friend = sessionResponseSchema.parse(
      await (await post(request, identity('friend'))).json(),
    );
    expect(deps.sessions.authenticate(friend.sessionToken)?.inviteId).toBe(
      link.invitation.inviteId,
    );
    deps.invites.revoke(link.invitation.inviteId);
    const revoked = await post(request, identity('revoked-link-user'));
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toEqual({ error: 'INVALID_INVITATION' });
    expect(
      (
        await post(
          { nickname: 'code-user', createRoom: false, roomCode: host.roomCode },
          identity('code-user'),
        )
      ).status,
    ).toBe(201);
  });

  it('lets team members create and fill one room by code without operator-issued invites', async () => {
    const created = await post(create, identity('host'));
    expect(created.status).toBe(201);
    const host = sessionResponseSchema.parse(await created.json());
    const session = deps.sessions.authenticate(host.sessionToken)!;
    expect(session.inviteId).toMatch(/^sso:[a-f0-9]{64}$/);
    for (let i = 0; i < 5; i++) {
      const joined = await post(
        { nickname: 'team-' + i, createRoom: false, roomCode: host.roomCode },
        identity('member-' + i),
      );
      expect(joined.status).toBe(201);
      expect((await joined.json()).roomCode).toBe(host.roomCode);
    }
    expect(deps.slots.occupied(host.roomCode)).toBe(6);
    const seventh = await post(
      { nickname: 'seventh', createRoom: false, roomCode: host.roomCode },
      identity('member-6'),
    );
    expect(await seventh.json()).toEqual({ error: 'CAPACITY' });
    expect(await (await post(create, identity('another-host'))).json()).toEqual({
      error: 'CAPACITY',
    });
    expect(deps.slots.totalOccupied()).toBe(6);
    deps.sessions.prune();
    expect(deps.sessions.size).toBe(6);
  });

  it('reports only this request admission method, without exposing the GitLab identity', async () => {
    const response = await fetch(endpoint + '/api/sessions/access', {
      headers: identity('member'),
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toContain('X-SSO-User');
    expect(await response.json()).toEqual({ method: 'gitlab-sso' });
    expect(await (await fetch(endpoint + '/api/sessions/access')).json()).toEqual({
      method: 'invitation',
    });
    expect((await post(create)).status).toBe(403);
    expect(deps.slots.totalOccupied()).toBe(0);
  });

  it('rejects missing, malformed and caller-supplied alternative identities without reservations', async () => {
    for (const headers of [
      {},
      identity(''),
      identity('one, two'),
      identity('x'.repeat(256)),
      { 'x-forwarded-user': 'member', 'x-auth-request-user': 'member' },
    ])
      expect((await post(create, headers)).status).toBe(403);
    expect((await post({ ...create, ssoUser: 'member' })).status).toBe(400);
    expect(deps.slots.totalOccupied()).toBe(0);
  });

  it('ignores identity headers unless both SSO mode and proxy trust are enabled', async () => {
    deps = { ...deps, admissionMode: 'invitation' };
    expect((await post(create, identity('member'))).status).toBe(403);
    deps = { ...deps, admissionMode: 'gitlab-sso', trustProxy: false };
    expect((await post(create, identity('member'))).status).toBe(403);
    expect(deps.slots.totalOccupied()).toBe(0);
  });

  it('keeps invitation scope validation for internal smoke and legacy callers', async () => {
    const issued = deps.invites.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: 1_030_000,
    });
    if (issued.status !== 'issued') throw new Error(issued.code);
    expect((await post({ ...create, inviteToken: issued.invitation.inviteToken })).status).toBe(
      201,
    );
    expect((await post({ ...create, inviteToken: 'unknown-invitation-token' })).status).toBe(403);
  });

  it('counts repeated nicknames as one SSO identity, respects IP limits and draining', async () => {
    const missing = { nickname: 'n', createRoom: false, roomCode: 'ABCDEF' };
    for (let i = 0; i < 3; i++)
      expect((await post({ ...missing, nickname: 'n-' + i }, identity('same-user'))).status).toBe(
        404,
      );
    expect((await post(missing, identity('same-user'))).status).toBe(429);
    for (let i = 0; i < 7; i++)
      expect((await post(missing, identity('other-' + i))).status).toBe(404);
    expect((await post(missing, identity('ip-over-limit'))).status).toBe(429);
    monotonic = 60_000;
    expect((await post(missing, identity('same-user'))).status).toBe(404);
    admission = 'DRAINING';
    const draining = await post(create, identity('same-user'));
    expect(draining.status).toBe(503);
    expect(await draining.json()).toEqual({ error: 'ADMISSION_CLOSED' });
    expect(deps.slots.totalOccupied()).toBe(0);
  });
});

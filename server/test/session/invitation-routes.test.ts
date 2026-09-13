import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InviteStore } from '../../src/session/InviteStore.js';
import { createInvitationRoutes } from '../../src/session/InvitationRoutes.js';
import { INVITATION_ROUTES } from '../../src/session/invite-types.js';
import { TEST_OPS_TOKEN, createTestOperatorAuth } from '../room/test-harness.js';

describe('operator invitation routes', () => {
  let server: Server;
  let endpoint: string;
  const now = 1_000_000;
  const invites = new InviteStore({
    now: () => now,
    maxTtlMs: 60_000,
    publicWindow: { opensAtEpochMs: 0, closesAtEpochMs: 2_000_000 },
    knownRoomCodes: () => new Set(['ABC234']),
    operationsReady: () => true,
  });

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(createInvitationRoutes({ invites, authorize: createTestOperatorAuth(TEST_OPS_TOKEN) }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (path: string, body: unknown, authorization?: string) =>
    fetch(endpoint + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    });

  it('does not intercept unrelated player routes with operator authentication', async () => {
    const response = await post('/api/media/grants', {}, 'Bearer player-session');
    expect(response.status).toBe(404);
  });

  it('issues with the operator token, returns the raw token once and revokes idempotently', async () => {
    const response = await post(
      INVITATION_ROUTES.issue,
      { scope: { allowCreate: false, roomCodes: ['ABC234'] }, expiresAt: now + 30_000 },
      `Bearer ${TEST_OPS_TOKEN}`,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      inviteId: string;
      inviteToken: string;
      scope: unknown;
      expiresAt: number;
    };
    expect(body.inviteToken.length).toBeGreaterThan(30);
    expect(
      invites.verify({ inviteToken: body.inviteToken, createRoom: false, roomCode: 'ABC234' }),
    ).toEqual({ inviteId: body.inviteId, expiresAt: now + 30_000 });
    const revoke = await post(
      INVITATION_ROUTES.revoke.replace(':inviteId', body.inviteId),
      {},
      `Bearer ${TEST_OPS_TOKEN}`,
    );
    expect(revoke.status).toBe(204);
    expect(
      (
        await post(
          INVITATION_ROUTES.revoke.replace(':inviteId', body.inviteId),
          {},
          `Bearer ${TEST_OPS_TOKEN}`,
        )
      ).status,
    ).toBe(204);
    expect(
      invites.verify({ inviteToken: body.inviteToken, createRoom: false, roomCode: 'ABC234' }),
    ).toBeNull();
  });

  it('refuses a game session bearer or no token with 401 and never issues', async () => {
    const before = invites.size;
    expect(
      (
        await post(INVITATION_ROUTES.issue, {
          scope: { allowCreate: true, roomCodes: [] },
          expiresAt: now + 1000,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          INVITATION_ROUTES.issue,
          { scope: { allowCreate: true, roomCodes: [] }, expiresAt: now + 1000 },
          'Bearer some-session-token',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          INVITATION_ROUTES.revoke.replace(':inviteId', '00000000-0000-4000-8000-000000000000'),
          {},
          'Bearer nope',
        )
      ).status,
    ).toBe(401);
    expect(invites.size).toBe(before);
  });

  it('maps invalid requests to 400 and operational rejections to 409 with safe codes', async () => {
    const auth = `Bearer ${TEST_OPS_TOKEN}`;
    expect(
      (
        await post(
          INVITATION_ROUTES.issue,
          { scope: { allowCreate: true }, expiresAt: now + 1000 },
          auth,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          INVITATION_ROUTES.issue,
          { scope: { allowCreate: true, roomCodes: [] }, expiresAt: now + 1000, extra: 1 },
          auth,
        )
      ).status,
    ).toBe(400);
    const tooLate = await post(
      INVITATION_ROUTES.issue,
      { scope: { allowCreate: true, roomCodes: [] }, expiresAt: now + 60_001 },
      auth,
    );
    expect(tooLate.status).toBe(400);
    expect(await tooLate.json()).toEqual({ error: 'INVALID_INVITATION' });
    const outside = await post(
      INVITATION_ROUTES.issue,
      { scope: { allowCreate: true, roomCodes: [] }, expiresAt: 2_500_000 },
      auth,
    );
    expect(outside.status).toBe(409);
    expect(await outside.json()).toEqual({ error: 'OUTSIDE_PUBLIC_WINDOW' });
    expect(
      (await post(INVITATION_ROUTES.revoke.replace(':inviteId', 'not-a-uuid'), {}, auth)).status,
    ).toBe(400);
  });
});

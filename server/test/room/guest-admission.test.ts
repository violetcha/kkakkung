import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import {
  ROOM_INVITATION_ROUTE,
  roomInvitationResponseSchema,
  sessionResponseSchema,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';
import { loadProductProfile } from '../../src/game/ProductProfileLoader.js';
import { productProfile } from './test-harness.js';

const configuration = () => ({
  ...parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SERVER_PROFILE: 'product',
    SERVICE_AUDIENCE: 'public',
    TRUST_PROXY_HOPS: '1',
    MEDIA_MODE: 'disabled',
    INVITE_MAX_TTL_MS: '600000',
    SESSION_ATTEMPT_WINDOW_MS: '60000',
    SESSION_ATTEMPTS_PER_INVITE: '20',
    SESSION_ATTEMPTS_PER_IP: '100',
    ROOM_IDLE_TTL_MS: '600000',
  }),
  port: 0,
});

/** Real HTTP/Colyseus/room ownership. The existing development admission hook is synthetic;
 * these lobby tests do not certify Cloud, real game rules, or a public-ready deployment. */
async function fixture(perInvite = 20) {
  let now = Date.now();
  let monotonic = 0;
  let admission: 'OPEN' | 'DRAINING' | 'LOCKED' = 'OPEN';
  const application = createApplication(
    configuration(),
    productProfile({
      maxRooms: 1,
      trustProxy: true,
      epochNow: () => now,
      monotonicNow: () => monotonic,
      sessionAttempts: { windowMs: 60_000, perInvite, perIp: 100 },
      developmentAdmission: () => admission,
    }),
  );
  const port = await application.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  const peers: Room<unknown, PublicMatchState>[] = [];
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(endpoint + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const create = async () =>
    sessionResponseSchema.parse(await (await post({ nickname: 'guest', createRoom: true })).json());
  const connect = async (session: SessionResponse) => {
    const room = await new Client(endpoint).joinOrCreate<unknown, PublicMatchState>(
      PRODUCT_ROOM_NAME,
      {
        token: session.sessionToken,
        roomCode: session.roomCode,
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
      },
    );
    room.reconnection.enabled = false;
    room.onMessage('*', () => undefined);
    peers.push(room);
    await vi.waitFor(() => expect(room.state.matchId).toBeTruthy());
    return room;
  };
  const rotate = async (host: SessionResponse) => {
    const response = await fetch(endpoint + ROOM_INVITATION_ROUTE, {
      method: 'POST',
      headers: { authorization: `Bearer ${host.sessionToken}` },
    });
    expect(response.status).toBe(201);
    return roomInvitationResponseSchema.parse(await response.json());
  };
  const cancel = (session: SessionResponse) =>
    fetch(endpoint + '/api/sessions/current', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
  return {
    application,
    endpoint,
    post,
    create,
    connect,
    rotate,
    cancel,
    advance: (ms: number) => {
      now += ms;
      monotonic += ms;
    },
    drain: () => {
      admission = 'DRAINING';
    },
    close: async () => {
      await Promise.all(
        peers.map((peer) => (peer.connection.isOpen ? peer.leave() : Promise.resolve())),
      );
      await application.close();
    },
  };
}

it('creates an independent guest, shares a host invitation and fills six real game connections', async () => {
  const f = await fixture();
  try {
    const access = await fetch(f.endpoint + '/api/sessions/access', {
      headers: { 'x-sso-user': 'forged' },
    });
    expect(access.headers.get('cache-control')).toBe('no-store');
    expect(await access.json()).toEqual({ method: 'guest' });
    const host = await f.create();
    await f.connect(host);
    expect(host.sessionToken).not.toBe(host.playerId);
    expect(f.application.productSessions.authenticate(host.sessionToken)?.inviteId).toMatch(
      /^guest:/,
    );
    const plain = { nickname: 'guest', createRoom: false, roomCode: host.roomCode };
    expect(
      (await f.post(plain, { 'x-sso-user': 'forged', 'x-auth-request-user': 'forged' })).status,
    ).toBe(403);
    const invitation = await f.rotate(host);
    expect(invitation.inviteToken).not.toBe(host.sessionToken);
    expect(
      (await f.post({ ...plain, roomCode: 'ABC234', inviteToken: invitation.inviteToken })).status,
    ).toBe(403);
    const ids = new Set([host.playerId]);
    for (let i = 0; i < 5; i++) {
      const session = sessionResponseSchema.parse(
        await (await f.post({ ...plain, inviteToken: invitation.inviteToken })).json(),
      );
      ids.add(session.playerId);
      await f.connect(session);
    }
    expect(ids.size).toBe(6);
    expect(f.application.slots!.occupied(host.roomCode)).toBe(6);
    expect((await f.post({ ...plain, inviteToken: invitation.inviteToken })).status).toBe(503);
    await expect(f.connect(host)).rejects.toThrow();
    expect(f.application.slots!.occupied(host.roomCode)).toBe(6);
    expect((await f.cancel(host)).status).toBe(409);
  } finally {
    await f.close();
  }
});

it('rotates away pending guest reservations, preserves joined friends and refuses old links', async () => {
  const f = await fixture();
  try {
    const host = await f.create();
    await f.connect(host);
    const link = await f.rotate(host);
    const request = {
      nickname: 'friend',
      createRoom: false,
      roomCode: link.roomCode,
      inviteToken: link.inviteToken,
    };
    const friend = sessionResponseSchema.parse(await (await f.post(request)).json());
    await f.connect(friend);
    const pending = sessionResponseSchema.parse(await (await f.post(request)).json());
    const next = await f.rotate(host);
    expect(next.inviteToken).not.toBe(link.inviteToken);
    expect(f.application.productSessions.authenticate(pending.sessionToken)).toBeNull();
    await expect(f.connect(pending)).rejects.toThrow('INVALID_SESSION');
    expect((await f.post(request)).status).toBe(403);
    expect(
      (await f.post({ nickname: 'host', createRoom: true, inviteToken: link.inviteToken })).status,
    ).toBe(403);
    expect(f.application.productSessions.authenticate(friend.sessionToken)).not.toBeNull();
    expect(f.application.slots!.occupied(host.roomCode)).toBe(2);
    f.advance(600_000);
    expect((await f.post({ ...request, inviteToken: next.inviteToken })).status).toBe(403);
  } finally {
    await f.close();
  }
});

it('keeps one creation attempt budget across new guest identities and canceled reservations', async () => {
  const f = await fixture(3);
  try {
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const response = await f.post(
        { nickname: `different-${i}`, createRoom: true },
        { 'x-sso-user': `forged-${i}` },
      );
      const session = sessionResponseSchema.parse(await response.json());
      ids.add(session.playerId);
      expect((await f.cancel(session)).status).toBe(204);
    }
    expect(ids.size).toBe(3);
    const refused = await f.post(
      { nickname: 'again', createRoom: true },
      { 'x-sso-user': 'new-value' },
    );
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'RATE_LIMITED' });
    expect(f.application.slots!.totalOccupied()).toBe(0);
    f.advance(60_000);
    const session = await f.create();
    f.advance(60_001);
    await expect(f.connect(session)).rejects.toThrow('INVALID_SESSION');
    await f.cancel(session);
    expect(f.application.slots!.totalOccupied()).toBe(0);
    f.drain();
    expect((await f.post({ nickname: 'closed', createRoom: true })).status).toBe(503);
  } finally {
    await f.close();
  }
});

it('keeps the actual media-disabled public product LOCKED without the test admission hook', async () => {
  const config = configuration();
  const application = createApplication(config, await loadProductProfile(config));
  const port = await application.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'guest', createRoom: true }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'ADMISSION_CLOSED' });
    expect(application.slots!.totalOccupied()).toBe(0);
  } finally {
    await application.close();
  }
});

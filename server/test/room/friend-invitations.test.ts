import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import {
  ROOM_INVITATION_ROUTE,
  roomInvitationResponseSchema,
  sessionResponseSchema,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import type { Phase, PublicMatchState } from '@kkakkung/protocol/game-schema';
import type { SessionAuth } from '../../src/session/session-types.js';
import type { AdmissionState } from '../../src/session/SessionRoutes.js';
import { bootProductApplication } from './test-harness.js';

async function fixture() {
  let now = Date.now();
  let admission: AdmissionState = 'OPEN';
  const h = await bootProductApplication({
    monotonicNow: () => 0,
    epochNow: () => now,
    developmentAdmission: () => admission,
  });
  const peers: Room<unknown, PublicMatchState>[] = [];
  const operator = h.application.invites!.issue({
    scope: { allowCreate: true, roomCodes: [] },
    expiresAt: now + 600_000,
  });
  if (operator.status !== 'issued') throw new Error(operator.code);
  const requestSession = (token: string, roomCode?: string) =>
    fetch(h.endpoint + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nickname: 'friend',
        inviteToken: token,
        ...(roomCode ? { createRoom: false, roomCode } : { createRoom: true }),
      }),
    });
  const options = (session: SessionResponse) => ({
    token: session.sessionToken,
    roomCode: session.roomCode,
    protocolVersion: PRODUCT_PROTOCOL_VERSION,
  });
  const connect = async (session: SessionResponse) => {
    const room = await new Client(h.endpoint).joinOrCreate<unknown, PublicMatchState>(
      PRODUCT_ROOM_NAME,
      options(session),
    );
    room.reconnection.enabled = false;
    room.onMessage('*', () => undefined);
    peers.push(room);
    return room;
  };
  const host = sessionResponseSchema.parse(
    await (await requestSession(operator.invitation.inviteToken)).json(),
  );
  const hostRoom = await connect(host);
  await vi.waitFor(() => expect(hostRoom.state.matchId).toBeTruthy());
  const actual = h.application.directory.get(host.roomCode)!;
  const room = actual as unknown as {
    roomId: string;
    setPhase(phase: Phase): void;
    onJoin(client: unknown, options: unknown, auth: SessionAuth): void;
    constructor: {
      onAuth(token: string, options: unknown, context: unknown): Promise<SessionAuth>;
    };
  };
  h.application.coordinator.unregister(room.roomId);
  const manage = (session = host, method = 'POST', body?: unknown) =>
    fetch(h.endpoint + ROOM_INVITATION_ROUTE, {
      method,
      headers: {
        authorization: `Bearer ${session.sessionToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const rotate = async () => {
    const response = await manage();
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return roomInvitationResponseSchema.parse(await response.json());
  };
  return {
    ...h,
    host,
    hostRoom,
    actual,
    room,
    options,
    manage,
    rotate,
    connect,
    requestSession,
    advance: (ms: number) => {
      now += ms;
    },
    setAdmission: (value: AdmissionState) => {
      admission = value;
    },
    close: async () => {
      await Promise.all(peers.map((p) => (p.connection.isOpen ? p.leave() : Promise.resolve())));
      await h.application.close();
    },
  };
}

it('rotates scoped links and rejects stale onAuth/queued admission while preserving joined players', async () => {
  const f = await fixture();
  try {
    const first = await f.rotate();
    expect(first.roomCode).toBe(f.host.roomCode);
    expect(first.inviteToken).not.toBe(f.host.sessionToken);
    expect((await f.requestSession(first.inviteToken)).status).toBe(403);
    expect((await f.requestSession(first.inviteToken, 'ABC234')).status).toBe(403);
    const joined = sessionResponseSchema.parse(
      await (await f.requestSession(first.inviteToken, first.roomCode)).json(),
    );
    await f.connect(joined);
    const pending = sessionResponseSchema.parse(
      await (await f.requestSession(first.inviteToken, first.roomCode)).json(),
    );
    const staleAuth = await f.room.constructor.onAuth('', f.options(pending), {});
    const second = await f.rotate();
    expect(second.inviteToken).not.toBe(first.inviteToken);
    expect((await f.requestSession(first.inviteToken, first.roomCode)).status).toBe(403);
    expect(f.application.productSessions.authenticate(pending.sessionToken)).toBeNull();
    expect(() => f.room.onJoin({ sessionId: 'late-auth' }, {}, staleAuth)).toThrow(
      'INVALID_SESSION',
    );
    await expect(f.connect(pending)).rejects.toThrow('INVALID_SESSION');
    expect(f.application.productSessions.authenticate(joined.sessionToken)).not.toBeNull();
    expect(f.application.slots!.slotState(first.roomCode, joined.playerId)).toBe('JOINED');
    expect(f.application.slots!.occupied(first.roomCode)).toBe(2);
    expect((await f.manage(f.host, 'DELETE')).status).toBe(204);
    expect((await f.manage(f.host, 'DELETE')).status).toBe(204);
    expect((await f.requestSession(second.inviteToken, first.roomCode)).status).toBe(403);
  } finally {
    await f.close();
  }
});

it('keeps the previous link if replacement fails and permits revocation while draining', async () => {
  const f = await fixture();
  try {
    const link = await f.rotate();
    vi.spyOn(f.application.invites!, 'issue').mockReturnValueOnce({
      status: 'rejected',
      code: 'NOT_READY',
    });
    expect((await f.manage()).status).toBe(503);
    const scope = {
      inviteToken: link.inviteToken,
      createRoom: false as const,
      roomCode: link.roomCode,
    };
    expect(f.application.invites!.verify(scope)).not.toBeNull();
    f.setAdmission('DRAINING');
    expect((await f.manage()).status).toBe(503);
    expect((await f.manage(f.host, 'DELETE')).status).toBe(204);
    expect(f.application.invites!.verify(scope)).toBeNull();
  } finally {
    await f.close();
  }
});

it('bounds repeated link rotation without discarding live invitations on a rejected request', async () => {
  const f = await fixture();
  try {
    let link;
    for (let i = 0; i < 20; i++) link = await f.rotate();
    expect(f.application.invites!.size).toBe(2);
    const response = await f.manage();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'RATE_LIMITED' });
    expect(
      f.application.invites!.verify({
        inviteToken: link!.inviteToken,
        createRoom: false,
        roomCode: link!.roomCode,
      }),
    ).not.toBeNull();
  } finally {
    await f.close();
  }
});

it('enforces current host, connected session, current phase and strict empty bodies', async () => {
  const f = await fixture();
  try {
    const invite = await f.rotate();
    const friend = sessionResponseSchema.parse(
      await (await f.requestSession(invite.inviteToken, invite.roomCode)).json(),
    );
    expect((await f.manage(friend)).status).toBe(403);
    await f.connect(friend);
    expect((await f.manage(friend)).status).toBe(403);
    expect((await f.manage(f.host, 'POST', { roomCode: 'ABC234' })).status).toBe(400);
    expect((await fetch(f.endpoint + ROOM_INVITATION_ROUTE, { method: 'POST' })).status).toBe(401);
    await f.hostRoom.leave();
    await vi.waitFor(() => expect(f.actual.canManageInvitations(friend.playerId)).toBe(true));
    expect([401, 403]).toContain((await f.manage()).status);
    expect((await f.manage(friend)).status).toBe(201);
    f.room.setPhase('PLAYING');
    expect((await f.manage(friend)).status).toBe(403);
    expect((await f.manage(friend, 'DELETE')).status).toBe(403);
  } finally {
    await f.close();
  }
});

it('refuses reservations at invitation expiry and forgets the closed room link', async () => {
  const f = await fixture();
  try {
    const invite = await f.rotate();
    f.advance(599_000);
    const pending = sessionResponseSchema.parse(
      await (await f.requestSession(invite.inviteToken, invite.roomCode)).json(),
    );
    f.advance(1000);
    await expect(f.connect(pending)).rejects.toThrow('INVALID_SESSION');
    expect((await f.requestSession(invite.inviteToken, invite.roomCode)).status).toBe(403);
    const next = await f.rotate();
    await f.hostRoom.leave();
    await vi.waitFor(() => expect(f.application.directory.get(next.roomCode)).toBeNull());
    expect(
      f.application.invites!.verify({
        inviteToken: next.inviteToken,
        createRoom: false,
        roomCode: next.roomCode,
      }),
    ).toBeNull();
  } finally {
    await f.close();
  }
});

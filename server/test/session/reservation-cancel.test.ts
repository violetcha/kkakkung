import { expect, it } from 'vitest';
import {
  SESSION_CANCEL_ROUTE,
  SESSION_ROUTE,
  sessionResponseSchema,
} from '@kkakkung/protocol/game-messages';
import { bootProductApplication } from '../room/test-harness.js';

it('cancels only an unjoined owner and immediately restores the one-room budget', async () => {
  const h = await bootProductApplication({ maxRooms: 1 });
  const app = h.application;
  try {
    const issued = app.invites!.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: Date.now() + 60000,
    });
    if (issued.status !== 'issued') throw Error(issued.code);
    const inviteToken = issued.invitation.inviteToken;
    const post = (roomCode?: string) =>
      fetch(h.endpoint + SESSION_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nickname: 'test',
          inviteToken,
          createRoom: !roomCode,
          ...(roomCode ? { roomCode } : {}),
        }),
      });
    const first = sessionResponseSchema.parse(await (await post()).json());
    const second = sessionResponseSchema.parse(await (await post(first.roomCode)).json());
    const cancel = (token?: string, body?: unknown) =>
      fetch(h.endpoint + SESSION_CANCEL_ROUTE, {
        method: 'DELETE',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect((await cancel()).status).toBe(401);
    expect((await cancel(first.sessionToken, { playerId: second.playerId })).status).toBe(400);
    expect((await cancel('synthetic-unknown')).status).toBe(204);
    expect(
      (
        await fetch(h.endpoint + SESSION_CANCEL_ROUTE, {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${first.sessionToken}`,
            origin: 'https://untrusted.invalid',
          },
        })
      ).status,
    ).toBe(403);
    expect(app.slots!.totalOccupied()).toBe(2);
    const response = await cancel(first.sessionToken);
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(app.productSessions.authenticate(first.sessionToken)).toBeNull();
    expect(app.slots!.slotState(first.roomCode, first.playerId)).toBeNull();
    expect(app.slots!.slotState(second.roomCode, second.playerId)).toBe('RESERVED');
    expect((await cancel(first.sessionToken)).status).toBe(204);
    expect(app.slots!.totalOccupied()).toBe(1);
    expect((await cancel(second.sessionToken)).status).toBe(204);
    expect(app.slots!.roomCodes().size).toBe(0);
    expect(
      app.invites!.verify({ inviteToken, createRoom: false, roomCode: first.roomCode }),
    ).toBeNull();
    for (let attempt = 0; attempt < 7; attempt++) {
      const created = await post();
      expect(created.status).toBe(201);
      const pending = sessionResponseSchema.parse(await created.json());
      expect((await cancel(pending.sessionToken)).status).toBe(204);
      expect(app.slots!.totalOccupied()).toBe(0);
    }
    expect((await post()).status).toBe(201);
  } finally {
    await app.close();
  }
});

it('never frees a joined connection or a retiring media seat through cancellation', async () => {
  const h = await bootProductApplication();
  const app = h.application;
  try {
    const session = app.productSessions.issue({
      nickname: 'test',
      inviteId: 'invite',
      roomCode: 'ABCDEF',
    });
    app.slots!.reserve(session.roomCode, session.playerId, 0, { create: true });
    const cancel = () =>
      fetch(h.endpoint + SESSION_CANCEL_ROUTE, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${session.sessionToken}` },
      });
    expect(app.productSessions.claimConnection(session.sessionId, 'socket')).toBe('claimed');
    expect((await cancel()).status).toBe(409);
    app.slots!.markJoined(session.roomCode, session.playerId, 0);
    app.productSessions.releaseConnection(session.sessionId, 'socket');
    expect((await cancel()).status).toBe(409);
    app.slots!.markRetiring(session.roomCode, session.playerId);
    expect((await cancel()).status).toBe(409);
    expect(app.productSessions.authenticate(session.sessionToken)).not.toBeNull();
    expect(app.slots!.slotState(session.roomCode, session.playerId)).toBe('RETIRING');
  } finally {
    await app.close();
  }
});

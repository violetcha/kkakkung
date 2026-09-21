import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import {
  ROOM_EXPIRED_CLOSE_CODE,
  ROOM_REMOVED_CLOSE_CODE,
  sessionResponseSchema,
} from '@kkakkung/protocol/game-messages';
import type { Phase, PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { bootProductApplication } from './test-harness.js';

async function fixture() {
  let now = 0;
  const h = await bootProductApplication({
    monotonicNow: () => now,
    epochNow: () => 1_000_000 + now,
    roomIdleTtlMs: 600_000,
    maxRooms: 1,
  });
  let room: Room<unknown, PublicMatchState> | undefined;
  try {
    const invitation = h.application.invites!.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: 4_000_000,
    });
    if (invitation.status !== 'issued') throw new Error(invitation.code);
    const response = await fetch(h.endpoint + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nickname: 'expiry',
        createRoom: true,
        inviteToken: invitation.invitation.inviteToken,
      }),
    });
    expect(response.status).toBe(201);
    const session = sessionResponseSchema.parse(await response.json());
    room = await new Client(h.endpoint).joinOrCreate<unknown, PublicMatchState>(PRODUCT_ROOM_NAME, {
      token: session.sessionToken,
      roomCode: session.roomCode,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    });
    room.reconnection.enabled = false;
    room.onMessage('*', () => undefined);
    const serverRoom = h.application.directory.get(session.roomCode) as unknown as {
      roomId: string;
      phase: Phase;
      state: PublicMatchState;
      checkExpiry(now: number): void;
      syncPublic(): void;
    };
    // Control the expiry clock without accidentally simulating a scheduler overload.
    h.application.coordinator.unregister(serverRoom.roomId);
    return {
      ...h,
      room,
      session,
      serverRoom,
      time: (value: number) => {
        now = value;
      },
      close: async () => {
        if (room?.connection.isOpen) await room.leave();
        await h.application.close();
      },
    };
  } catch (error) {
    if (room?.connection.isOpen) await room.leave();
    await h.application.close();
    throw error;
  }
}

it.each(['LOBBY', 'DEVICE_CHECK', 'RESULT', 'ABORTED'] as const)(
  'warns and disconnects a connected %s room, then releases its session and capacity',
  async (phase) => {
    const f = await fixture();
    try {
      const closed = vi.fn();
      f.room.onLeave(closed);
      f.serverRoom.phase = phase;
      f.application.slots!.setPhase(f.session.roomCode, phase, 0);
      const deadline = phase === 'LOBBY' ? 600_000 : 300_000;
      f.time(deadline - 60_000);
      f.serverRoom.checkExpiry(deadline - 60_000);
      f.serverRoom.syncPublic();
      await vi.waitFor(() => expect(f.room.state.roomExpiresInSeconds).toBe(60));
      expect(closed).not.toHaveBeenCalled();
      f.time(deadline);
      f.serverRoom.checkExpiry(deadline);
      // Device-check recovery returns an active group to LOBBY. A second expiry pass is
      // intentionally not part of this case because the recovered room is now empty.
      if (phase !== 'DEVICE_CHECK') f.serverRoom.checkExpiry(deadline);
      expect(f.application.productSessions.authenticate(f.session.sessionToken)).toBeNull();
      expect(f.application.slots!.reserve(f.session.roomCode, 'late-join', deadline)).toBe(
        phase === 'DEVICE_CHECK' ? 'reserved' : 'ROOM_CLOSED',
      );
      await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
      expect(closed.mock.calls[0]?.[0]).toBe(
        phase === 'DEVICE_CHECK' ? ROOM_REMOVED_CLOSE_CODE : ROOM_EXPIRED_CLOSE_CODE,
      );
      if (phase === 'DEVICE_CHECK') f.application.slots!.release(f.session.roomCode, 'late-join');
      await vi.waitFor(() => {
        expect(f.application.slots!.totalOccupied()).toBe(0);
        expect(f.application.directory.size).toBe(0);
      });
    } finally {
      await f.close();
    }
  },
);

it('bounds malformed command replies and closes a transport flood of unknown message types', async () => {
  const f = await fixture();
  try {
    const receipts = vi.fn();
    const closed = vi.fn();
    f.room.onMessage('command-result', receipts);
    f.room.onLeave(closed);
    for (let i = 0; i < 100; i++) f.room.send('command', {});
    await vi.waitFor(() => expect(receipts).toHaveBeenCalledTimes(90));
    expect(f.room.connection.isOpen).toBe(true);
    for (let i = 0; i < 150; i++) f.room.send('unknown-message', {});
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.application.slots!.totalOccupied()).toBe(0));
  } finally {
    await f.close();
  }
});

it('limits invalid JSON before parsing and matchmaking without trusting spoofed forwarded IPs', async () => {
  let now = 0;
  const h = await bootProductApplication({
    monotonicNow: () => now,
    sessionAttempts: { windowMs: 1000, perInvite: 2, perIp: 2 },
  });
  const post = (index: number) =>
    fetch(h.endpoint + (index % 2 ? '/api/sessions' : '/matchmake/joinOrCreate/kkakkung'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${index}` },
      body: '{invalid-json',
    });
  try {
    for (let i = 0; i < 8; i++) expect((await post(i)).status).toBe(400);
    const rejected = await post(9);
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({ error: 'RATE_LIMITED' });
    expect(h.application.slots!.totalOccupied()).toBe(0);
    expect(h.application.directory.size).toBe(0);
    now = 1000;
    expect((await post(10)).status).toBe(400);
  } finally {
    await h.application.close();
  }
});

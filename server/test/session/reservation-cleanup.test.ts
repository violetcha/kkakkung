import { expect, it, vi } from 'vitest';
import { SESSION_ROUTE, sessionResponseSchema } from '@kkakkung/protocol/game-messages';
import { ProductSessionStore, SESSION_LIMITS } from '../../src/session/ProductSessionStore.js';
import { createReservationCleanup } from '../../src/session/ReservationCleanup.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { bootProductApplication } from '../room/test-harness.js';

function fixture() {
  let now = 0;
  const sessions = new ProductSessionStore({ now: () => now, leaseTtlMs: 1000 });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const onRoomClosed = vi.fn();
  const hasLiveRoom = vi.fn(() => false);
  const cleanup = createReservationCleanup({ sessions, slots, onRoomClosed, hasLiveRoom });
  const reserve = () => {
    const session = sessions.issue({ nickname: 'test', inviteId: 'invite', roomCode: 'ABCDEF' });
    expect(slots.reserve('ABCDEF', session.playerId, now, { create: true })).toBe('reserved');
    return session;
  };
  return {
    sessions,
    slots,
    cleanup,
    reserve,
    onRoomClosed,
    hasLiveRoom,
    time: (value: number) => {
      now = value;
    },
  };
}

it('reclaims expired reservations and an orphan room even if sessions were already pruned', () => {
  const f = fixture();
  const tokens = Array.from({ length: 6 }, () => f.reserve());
  f.time(999);
  f.cleanup();
  expect(f.slots.totalOccupied()).toBe(6);
  f.time(1000);
  f.sessions.prune();
  f.cleanup();
  f.cleanup();
  expect(f.slots.totalOccupied()).toBe(0);
  expect(f.slots.roomCodes().size).toBe(0);
  expect(f.onRoomClosed).toHaveBeenCalledExactlyOnceWith('ABCDEF');
  expect(tokens.every((session) => f.sessions.authenticate(session.sessionToken) === null)).toBe(
    true,
  );
  expect(f.slots.reserve('GHIJKL', 'retry', 1000, { create: true })).toBe('reserved');
});

it('preserves live reservations and JOINED/RETIRING seats after session expiry', () => {
  const f = fixture();
  const expired = f.reserve();
  const joined = f.reserve();
  const retiring = f.reserve();
  f.slots.markJoined('ABCDEF', joined.playerId, 0);
  f.slots.markRetiring('ABCDEF', retiring.playerId);
  f.time(500);
  const live = f.reserve();
  f.time(1000);
  f.cleanup();
  expect(f.slots.slotState('ABCDEF', expired.playerId)).toBeNull();
  expect(f.slots.slotState('ABCDEF', joined.playerId)).toBe('JOINED');
  expect(f.slots.slotState('ABCDEF', retiring.playerId)).toBe('RETIRING');
  expect(f.slots.slotState('ABCDEF', live.playerId)).toBe('RESERVED');
  expect(f.slots.activity().pendingAdmissions).toBe(1);
  expect(f.onRoomClosed).not.toHaveBeenCalled();
});

it('leaves disposal of an empty live Room to that Room', () => {
  const f = fixture();
  const session = f.reserve();
  f.hasLiveRoom.mockReturnValue(true);
  f.sessions.invalidate(session.sessionId);
  f.cleanup();
  expect(f.slots.occupied('ABCDEF')).toBe(0);
  expect(f.slots.hasRoom('ABCDEF')).toBe(true);
  expect(f.onRoomClosed).not.toHaveBeenCalled();
});

it.each(['timer', 'admission'] as const)(
  'reclaims a never-joined room through the bootstrap %s path',
  async (path) => {
    let now = 1_000_000;
    const h = await bootProductApplication({ epochNow: () => now, maxRooms: 1 });
    const { application: app } = h;
    try {
      const invitation = app.invites!.issue({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: now + 3_000_000,
      });
      if (invitation.status !== 'issued') throw Error(invitation.code);
      const inviteToken = invitation.invitation.inviteToken;
      const post = () =>
        fetch(h.endpoint + SESSION_ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: 'test', inviteToken, createRoom: true }),
        });
      const first = await post();
      expect(first.status).toBe(201);
      const issued = sessionResponseSchema.parse(await first.json());
      expect(app.directory.size).toBe(0);
      expect((await post()).status).toBe(503);
      now += SESSION_LIMITS.admissionTtlMs;
      if (path === 'timer')
        await vi.waitFor(() => expect(app.slots!.hasRoom(issued.roomCode)).toBe(false), {
          timeout: 2000,
        });
      const retry = await post();
      expect(retry.status).toBe(201);
      expect(app.productSessions.authenticate(issued.sessionToken)).toBeNull();
      expect(app.slots!.totalOccupied()).toBe(1);
      expect(app.slots!.roomCodes().size).toBe(1);
      expect(
        app.invites!.verify({ inviteToken, createRoom: false, roomCode: issued.roomCode }),
      ).toBeNull();
    } finally {
      await app.close();
    }
  },
);

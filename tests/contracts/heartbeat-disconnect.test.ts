import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { RoomRosterMessage } from '@kkakkung/protocol/game-messages';
import { matchCore } from '../../packages/game-core/src/match/engine';
import { preparePracticeLayout } from '../../packages/game-core/src/match/map/prepare-practice-layout';
import { loadPractice } from '../../packages/game-core/test/match/helpers';
import { createKkakkungRoom } from '../../server/src/rooms/KkakkungRoom';
import { RoomDirectory } from '../../server/src/rooms/RoomDirectory';
import { RoomTickCoordinator } from '../../server/src/game/RoomTickCoordinator';
import type { HeartbeatTracker } from '../../server/src/game/Heartbeat';
import { RoomExpiry } from '../../server/src/session/RoomExpiry';
import { ProductSessionStore } from '../../server/src/session/ProductSessionStore';
import { SlotRegistry } from '../../server/src/session/SlotRegistry';
import { testTuning } from '../../server/test/room/test-harness';
import type { StructuredEvent } from '../../server/src/observability/StructuredEvents';

type Clock = { now: number };

function openRoom(clock: Clock, events: StructuredEvent[] = []) {
  const sessions = new ProductSessionStore({ now: () => clock.now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const Room = createKkakkungRoom({
    emitEvent: (event) => events.push(event),
    serverEpoch: 'test',
    monotonicNow: () => clock.now,
    sessions,
    slots,
    directory: new RoomDirectory(),
    coordinator: new RoomTickCoordinator({ now: () => clock.now }),
    roomExpiry: new RoomExpiry(600000),
    core: matchCore,
    tuning: testTuning,
    practice: { port: { preparePracticeLayout }, raw: loadPractice() },
    layouts: null,
    media: null,
    assetVersion: 'c-primitives-1',
  });
  const room = new Room();
  type Client = Parameters<typeof room.onJoin>[0];
  room.roomCode = 'ABCDEF';
  const handlers = room as unknown as {
    onCommand(client: Client, command: unknown): void;
    heartbeat: HeartbeatTracker;
  };
  const rosters: RoomRosterMessage[] = [];
  room.broadcast = ((type: string, value: unknown) => {
    if (type === 'room-roster') rosters.push(value as RoomRosterMessage);
  }) as typeof room.broadcast;
  const clients = Array.from({ length: 6 }, (_, i) => {
    const session = sessions.issue({ nickname: `test-${i}`, inviteId: 'test', roomCode: 'ABCDEF' });
    slots.reserve('ABCDEF', session.playerId, clock.now, { create: i === 0 });
    const client = {
      sessionId: `connection-${i}`,
      send: vi.fn(),
      leave: vi.fn(),
    } as unknown as Client;
    room.onJoin(client, {}, sessions.authenticate(session.sessionToken)!);
    return { client, session };
  });
  return { room, handlers, rosters, clients, sessions, slots };
}

it('removes a silent ready host before the remaining five can start practice; late leave is idempotent', () => {
  const clock = { now: 0 };
  const { room, handlers, rosters, clients, sessions, slots } = openRoom(clock);
  const ready = (index: number) =>
    handlers.onCommand(clients[index]!.client, {
      matchId: room.matchId,
      requestId: randomUUID(),
      sequence: 1,
      type: 'READY',
      payload: { ready: true },
    });
  try {
    ready(0);
    room.tick();
    expect(room.phase).toBe('DEVICE_CHECK');
    const originalHost = rosters.at(-1)!.hostId;
    // 서버는 틱마다 sweep 한다. 한 번에 6초를 건너뛰면 서버 정지로 보고 아무도 끊지 않는다 (337).
    for (clock.now = 50; clock.now < 6000; clock.now += 50) room.tick();
    clock.now = 6001;
    for (const { client } of clients.slice(1))
      handlers.heartbeat.ack(
        client.sessionId,
        { serverEpoch: 'test', matchId: room.matchId, heartbeatSeq: 1 },
        room.matchId,
        clock.now,
      );
    room.tick();
    const lost = clients[0]!;
    expect(lost.client.leave).toHaveBeenCalledExactlyOnceWith(4000, 'HEARTBEAT_TIMEOUT');
    expect(sessions.authenticate(lost.session.sessionToken)).toBeNull();
    expect(slots.occupied('ABCDEF')).toBe(5);
    expect(room.phase).toBe('LOBBY');
    expect(rosters.at(-1)!.players).toHaveLength(5);
    expect(rosters.at(-1)!.hostId).not.toBe(originalHost);
    expect(
      rosters.at(-1)!.players.some((player) => player.playerId === lost.session.playerId),
    ).toBe(false);
    const broadcasts = rosters.length;
    room.onLeave(lost.client);
    expect(rosters).toHaveLength(broadcasts);
    for (let i = 1; i < 6; i++) ready(i);
    room.tick();
    expect(room.phase).toBe('LOBBY');
    expect(lost.client.leave).toHaveBeenCalledOnce();
    expect(
      clients.slice(1).every(({ client }) => vi.mocked(client.leave).mock.calls.length === 0),
    ).toBe(true);
  } finally {
    room.clock.clear();
  }
});

// S15P21C204-337. 서버가 6초 넘게 멈췄다 재개해도 살아 있는 연결을 끊지 않고, 멈춘 사실을 남긴다.
it('keeps every connection through a server stall and records it', () => {
  const clock = { now: 0 };
  const events: StructuredEvent[] = [];
  const { room, clients } = openRoom(clock, events);
  try {
    room.tick();
    clock.now = 7000;
    room.tick();
    expect(clients.every(({ client }) => vi.mocked(client.leave).mock.calls.length === 0)).toBe(
      true,
    );
    expect(events.filter((event) => event.event === 'room.heartbeat_stall')).toEqual([
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ roomRef: 'ABCDEF', durationMs: 7000, count: 6 }),
      }),
    ]);
  } finally {
    room.clock.clear();
  }
});

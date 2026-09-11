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

it('removes a silent ready host before the remaining five can start practice; late leave is idempotent', () => {
  let now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const Room = createKkakkungRoom({
    serverEpoch: 'test',
    monotonicNow: () => now,
    sessions,
    slots,
    directory: new RoomDirectory(),
    coordinator: new RoomTickCoordinator({ now: () => now }),
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
    slots.reserve('ABCDEF', session.playerId, now, { create: i === 0 });
    const client = {
      sessionId: `connection-${i}`,
      send: vi.fn(),
      leave: vi.fn(),
    } as unknown as Client;
    room.onJoin(client, {}, sessions.authenticate(session.sessionToken)!);
    return { client, session };
  });
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
    now = 6001;
    for (const { client } of clients.slice(1))
      handlers.heartbeat.ack(
        client.sessionId,
        { serverEpoch: 'test', matchId: room.matchId, heartbeatSeq: 1 },
        room.matchId,
        now,
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

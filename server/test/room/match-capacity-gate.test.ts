/* eslint-disable @typescript-eslint/no-explicit-any -- Drive the practice gate directly, as monthly-usage-gate.test.ts does. */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createKkakkungRoom } from '../../src/rooms/KkakkungRoom.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { RoomExpiry } from '../../src/session/RoomExpiry.js';
import { FakeCore, fakePracticePort, testTuning } from './test-harness.js';

// S15P21C204-372. 방은 대기방 예산으로 열리고, LiveKit 을 쓰는 경기는 동시에 maxRooms 판까지다.
// 경기 자리가 없으면 방은 장치 점검에 머물며 이유를 보이고, 자리가 나면 방장이 다시 시작한다.
function readyRoom() {
  const now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1, maxLobbyRooms: 2 });
  // 다른 방 하나가 이미 경기 중이다.
  slots.reserve('OTHER1', 'other-host', now, { create: true });
  slots.setPhase('OTHER1', 'PLAYING', now);
  const RoomClass = createKkakkungRoom({
    serverEpoch: 'capacity-epoch',
    monotonicNow: () => now,
    sessions,
    slots,
    directory: { register() {}, unregister() {} } as any,
    coordinator: { register() {}, unregister() {}, rearm() {} } as any,
    roomExpiry: new RoomExpiry(600_000),
    core: new FakeCore(),
    tuning: testTuning,
    practice: { port: fakePracticePort, raw: { practiceVersion: 'fixture' } },
    layouts: null,
    media: null,
    assetVersion: 'fixture',
    random: () => 0.5,
  });
  const room: any = new RoomClass();
  room.roomCode = 'ABCDEF';
  room.broadcast = () => undefined;
  const players = Array.from({ length: 6 }, (_, i) => {
    const session = sessions.issue({ nickname: `p${i}`, inviteId: 'fixture', roomCode: 'ABCDEF' });
    expect(slots.reserve('ABCDEF', session.playerId, now, { create: true })).toBe('reserved');
    const client = { sessionId: `connection-${i}`, send() {}, leave() {} };
    room.onJoin(client, {}, sessions.get(session.sessionId));
    return client;
  });
  for (const client of players)
    room.onCommand(client, {
      matchId: room.matchId,
      requestId: randomUUID(),
      sequence: 1,
      type: 'READY',
      payload: { ready: true },
    });
  let sequence = 2;
  const start = () =>
    room.onCommand(players[0]!, {
      matchId: room.matchId,
      requestId: randomUUID(),
      sequence: sequence++,
      type: 'ROOM_START',
      payload: {},
    });
  return { room, slots, start };
}

it('keeps a ready room waiting while every match slot is in use, then starts it when one frees', () => {
  const { room, slots, start } = readyRoom();
  try {
    room.tick();
    start();
    room.tick();
    expect(room.phase).toBe('DEVICE_CHECK');
    room.syncPublic();
    expect(room.state.preparationIssue).toBe('MATCH_CAPACITY_FULL');
    // 방은 그대로 남아 있다. 새로 만들 필요가 없다.
    expect(slots.hasRoom('ABCDEF')).toBe(true);

    // 다른 방이 결과 화면으로 넘어가면 자리가 나고, 누르지 않아도 방 안내가 바뀐다.
    slots.setPhase('OTHER1', 'RESULT', 0);
    room.tick();
    expect(room.state.preparationIssue).toBe('MATCH_SLOT_AVAILABLE');
    expect(room.phase).toBe('DEVICE_CHECK');
    // 대기열은 없다. 누르기 전에 다른 방이 먼저 시작하면 안내가 다시 자리 없음으로 돌아간다.
    slots.setPhase('OTHER1', 'TEAM_PRACTICE', 0);
    room.tick();
    expect(room.state.preparationIssue).toBe('MATCH_CAPACITY_FULL');
    slots.setPhase('OTHER1', 'RESULT', 0);
    room.tick();
    expect(room.state.preparationIssue).toBe('MATCH_SLOT_AVAILABLE');
    // 방장이 누르면 들어간다.
    start();
    room.tick();
    expect(room.phase).toBe('TEAM_PRACTICE');
    room.syncPublic();
    expect(room.state.preparationIssue ?? undefined).toBeUndefined();
    expect(slots.capacity().matchesInUse).toBe(1);
  } finally {
    room.clock.clear();
  }
});

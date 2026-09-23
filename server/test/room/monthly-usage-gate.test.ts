/* eslint-disable @typescript-eslint/no-explicit-any -- Drive the practice gate directly; the meter itself is covered in media/monthly-usage-meter.test.ts. */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createKkakkungRoom } from '../../src/rooms/KkakkungRoom.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { RoomExpiry } from '../../src/session/RoomExpiry.js';
import { FakeCore, fakePracticePort, testTuning } from './test-harness.js';

// S15P21C204-364. 월 사용량이 한도 가까이 차면 새 경기는 연습 문턱에서 기다린다. LiveKit 이
// 과금을 시작하는 곳이 연습이고, 여기서 막아야 진행 중인 경기가 중간에 끊기지 않는다.
function readyRoom(allowed: { value: boolean }) {
  const now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const RoomClass = createKkakkungRoom({
    serverEpoch: 'monthly-epoch',
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
    canStartMatch: () => allowed.value,
  });
  const room: any = new RoomClass();
  room.roomCode = 'ABCDEF';
  room.broadcast = () => undefined;
  const players = Array.from({ length: 6 }, (_, i) => {
    const session = sessions.issue({ nickname: `p${i}`, inviteId: 'fixture', roomCode: 'ABCDEF' });
    slots.reserve('ABCDEF', session.playerId, now, { create: true });
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
  // S15P21C204-295. 전원이 준비해도 저절로 시작하지 않는다. 방장이 시작을 누른다.
  let sequence = 2;
  const start = () =>
    room.onCommand(players[0]!, {
      matchId: room.matchId,
      requestId: randomUUID(),
      sequence: sequence++,
      type: 'ROOM_START',
      payload: {},
    });
  return { room, start };
}

it('holds a ready room at device check and says why while the month is nearly spent', () => {
  const allowed = { value: false };
  const { room, start } = readyRoom(allowed);
  try {
    room.tick();
    start();
    room.tick();
    expect(room.phase).toBe('DEVICE_CHECK');
    room.syncPublic();
    expect(room.state.preparationIssue).toBe('MEDIA_BUDGET_EXHAUSTED');
    // 막힌 동안에는 다시 눌러도 연습에 들어가지 않는다.
    start();
    for (let i = 0; i < 5; i++) room.tick();
    expect(room.phase).toBe('DEVICE_CHECK');
  } finally {
    room.clock.clear();
  }
});

it('lets the same room start as soon as the guard opens again', () => {
  const allowed = { value: false };
  const { room, start } = readyRoom(allowed);
  try {
    room.tick();
    start();
    room.tick();
    expect(room.phase).toBe('DEVICE_CHECK');
    // 가드가 열리면 방장이 다시 시작을 누르는 것만으로 들어간다. 방을 새로 만들 필요가 없다.
    allowed.value = true;
    start();
    room.tick();
    expect(room.phase).toBe('TEAM_PRACTICE');
    room.syncPublic();
    expect(room.state.preparationIssue ?? undefined).toBeUndefined();
  } finally {
    room.clock.clear();
  }
});

it('never stops a match that already started', () => {
  const allowed = { value: true };
  const { room, start } = readyRoom(allowed);
  try {
    room.tick();
    start();
    room.tick();
    expect(room.phase).toBe('TEAM_PRACTICE');
    // 연습이 시작된 뒤 가드가 닫혀도 이 방은 계속 진행한다. 가드는 새 연습 진입만 본다.
    allowed.value = false;
    for (let i = 0; i < 5; i++) room.tick();
    expect(room.phase).toBe('TEAM_PRACTICE');
    expect(room.abortReason).toBeNull();
  } finally {
    room.clock.clear();
  }
});

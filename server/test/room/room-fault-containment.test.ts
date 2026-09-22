/* eslint-disable @typescript-eslint/no-explicit-any -- Drive private room paths directly; transport-level isolation is in tick-isolation.test.ts. */
import { randomUUID } from 'node:crypto';
import { ServerError } from '@colyseus/core';
import { expect, it } from 'vitest';
import { createKkakkungRoom } from '../../src/rooms/KkakkungRoom.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { RoomExpiry } from '../../src/session/RoomExpiry.js';
import { FakeCore, fakePracticePort, testTuning } from './test-harness.js';

// S15P21C204-336. A room's own failure must end in cleanup, never in a room that stops ticking
// or an exception that leaves the room.
function practiceRoom() {
  const now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const rearmed: string[] = [];
  const events: any[] = [];
  const RoomClass = createKkakkungRoom({
    serverEpoch: 'fault-epoch',
    monotonicNow: () => now,
    emitEvent: (event: any) => events.push(event),
    sessions,
    slots,
    directory: { register() {}, unregister() {} } as any,
    coordinator: {
      register() {},
      unregister() {},
      rearm: (id: string) => rearmed.push(id),
    } as any,
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
    slots.reserve('ABCDEF', session.playerId, now, { create: true });
    const client = { sessionId: `connection-${i}`, send() {}, leave() {} };
    room.onJoin(client, {}, sessions.get(session.sessionId));
    return { session, client };
  });
  for (const { client } of players)
    room.onCommand(client, {
      matchId: room.matchId,
      requestId: randomUUID(),
      sequence: 1,
      type: 'READY',
      payload: { ready: true },
    });
  room.tick();
  expect(room.phase).toBe('TEAM_PRACTICE');
  return { room, rearmed, events, players, close: () => room.clock.clear() };
}

const uncaught = (events: any[]) => events.filter((e) => e.event === 'room.uncaught_exception');

it('re-arms a failed or overloaded room even when its abort throws', () => {
  const f = practiceRoom();
  try {
    f.room.abortMatch = () => {
      throw new Error('abort failed');
    };
    expect(() => f.room.tickFailed(new Error('tick'))).toThrow('abort failed');
    expect(() => f.room.overload(400)).toThrow('abort failed');
    // Without the re-arm the coordinator would never tick this room again.
    expect(f.rearmed).toEqual([f.room.roomId, f.room.roomId]);
  } finally {
    f.close();
  }
});

it('aborts a running match on an uncaught handler exception and records it', () => {
  const f = practiceRoom();
  try {
    f.room.onUncaughtException(
      Object.assign(new Error('wrapped'), { cause: new TypeError('selector broke') }),
      'onMessage',
    );
    expect(f.room.phase).toBe('ABORTED');
    expect(uncaught(f.events)).toEqual([
      expect.objectContaining({
        level: 'error',
        fields: expect.objectContaining({ name: 'onMessage', reason: 'selector broke' }),
      }),
    ]);
  } finally {
    f.close();
  }
});

it('keeps the match for a refused join and for a join that failed', () => {
  const f = practiceRoom();
  try {
    f.room.onUncaughtException(
      Object.assign(new Error('refused'), { cause: new ServerError(403, 'ROOM_CLOSED') }),
      'onJoin',
    );
    expect(uncaught(f.events)).toEqual([]);
    // Colyseus rethrows onJoin to that client; only the attempt fails.
    f.room.onUncaughtException(
      Object.assign(new Error('join'), { cause: new Error('bad auth') }),
      'onJoin',
    );
    expect(f.room.phase).toBe('TEAM_PRACTICE');
    expect(uncaught(f.events)).toHaveLength(1);
  } finally {
    f.close();
  }
});

it('never overwrites a decided round and never throws itself', () => {
  const f = practiceRoom();
  try {
    f.room.setPhase('RESULT');
    f.room.onUncaughtException(
      Object.assign(new Error('late'), { cause: new Error('late') }),
      'setTimeout',
    );
    expect(f.room.phase).toBe('RESULT');
    f.room.setPhase('PLAYING');
    f.room.abortMatch = () => {
      throw new Error('abort failed');
    };
    expect(() =>
      f.room.onUncaughtException(
        Object.assign(new Error('x'), { cause: new Error('x') }),
        'onMessage',
      ),
    ).not.toThrow();
  } finally {
    f.close();
  }
});

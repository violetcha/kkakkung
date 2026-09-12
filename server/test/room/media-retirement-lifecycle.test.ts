/* eslint-disable @typescript-eslint/no-explicit-any -- Inspect private room state in this isolated lifecycle harness; product transport is covered separately. */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createKkakkungRoom } from '../../src/rooms/KkakkungRoom.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { FakeCore, fakePracticePort, layoutFor, testTuning } from './test-harness.js';

function fixture(
  prepareGeneration?: (request: any) => Promise<any>,
  retire?: (request: any) => Promise<any>,
) {
  let now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const retirementRequests: any[] = [];
  const RoomClass = createKkakkungRoom({
    serverEpoch: 'diagnostic-epoch',
    monotonicNow: () => now,
    sessions,
    slots,
    directory: { unregister() {} } as any,
    coordinator: { rearm() {} } as any,
    roomExpiry: { decide: () => 'keep', remainingMs: () => null } as any,
    core: new FakeCore(),
    tuning: testTuning,
    practice: { port: fakePracticePort, raw: { practiceVersion: 'fixture' } },
    layouts: null,
    media: {
      observeFrame() {},
      lifecycle: { setGameConnection() {} },
      prepareGeneration,
      retireGeneration: async (request: any) => {
        retirementRequests.push(request);
        return retire ? retire(request) : { ...request, status: 'confirmed', code: null };
      },
    } as any,
    assetVersion: 'fixture',
    random: () => 0.5,
  });
  const room: any = new RoomClass();
  room.roomCode = 'ABCDEF';
  room.broadcast = () => undefined;
  const players = Array.from({ length: 6 }, (_, i) => {
    const session = sessions.issue({
      nickname: `test${i}`,
      inviteId: 'fixture',
      roomCode: room.roomCode,
    });
    slots.reserve(room.roomCode, session.playerId, now, { create: true });
    const client = { sessionId: `connection-${i}`, send() {}, leave() {} };
    room.onJoin(client, {}, sessions.get(session.sessionId));
    return { session, client };
  });
  for (const player of players)
    room.onCommand(player.client, {
      matchId: room.matchId,
      requestId: randomUUID(),
      sequence: 1,
      type: 'READY',
      payload: { ready: true },
    });
  room.tick();
  expect(room.phase).toBe('TEAM_PRACTICE');
  now += 50;
  room.tick();
  return {
    room,
    players,
    sessions,
    slots,
    retirementRequests,
    advance: (ms: number) => {
      now += ms;
      room.heartbeat.resetForMatch(now);
      room.tick();
    },
    flush: async () => {
      await Promise.resolve();
      await Promise.resolve();
      room.tick();
    },
    close: () => room.clock.clear(),
  };
}

it('releases a practice leaver who never requested a media generation', () => {
  const f = fixture();
  try {
    const leaving = f.players[5]!;
    f.room.onLeave(leaving.client);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();
    expect(f.retirementRequests).toHaveLength(0);
    expect(f.room.pendingRetirements.size).toBe(0);
    f.advance(60000);
    f.room.tick();
    expect(f.room.phase).toBe('LOBBY');
    expect(f.room.lobby.connectedCount()).toBe(5);
    expect(f.slots.reserve('ABCDEF', 'replacement-player', 60000)).toBe('reserved');
  } finally {
    f.close();
  }
});

it('holds an in-flight leaver until the late generation is confirmed retired', async () => {
  let allocate!: (result: any) => void;
  let confirm!: (result: any) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  let request: any;
  const f = fixture(
    (value) => {
      request = value;
      started();
      return new Promise((resolve) => {
        allocate = resolve;
      });
    },
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  try {
    const leaving = f.players[5]!;
    const preparation = f.room.requestMediaGrant(leaving.session.playerId, 'practice', null);
    await began;
    f.room.onLeave(leaving.client);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBe('RETIRING');
    allocate({ ...request, status: 'ready', receiverGeneration: 1, grant: {}, code: null });
    await preparation;
    expect(f.retirementRequests).toHaveLength(1);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBe('RETIRING');
    confirm({ ...f.retirementRequests[0], status: 'confirmed', code: null });
    await f.flush();
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();
    expect(f.room.pendingRetirements.size).toBe(0);
  } finally {
    f.close();
  }
});

it('retires a returned grant when its player leaves before the next room tick', async () => {
  const f = fixture(async (request) => ({
    ...request,
    status: 'ready',
    receiverGeneration: 1,
    grant: {},
    code: null,
  }));
  try {
    const leaving = f.players[5]!;
    await f.room.requestMediaGrant(leaving.session.playerId, 'practice', null);
    f.room.onLeave(leaving.client);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBe('RETIRING');
    f.room.tick();
    await f.flush();
    expect(f.retirementRequests).toHaveLength(1);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();
  } finally {
    f.close();
  }
});

it('does not release an in-flight leaver after a producer fails without a generation cursor', async () => {
  let reject!: (reason: Error) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = fixture(() => {
    started();
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  try {
    const leaving = f.players[5]!;
    const preparation = f.room.requestMediaGrant(leaving.session.playerId, 'practice', null);
    await began;
    f.room.onLeave(leaving.client);
    reject(new Error('unknown allocation'));
    await preparation;
    f.room.tick();
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBe('RETIRING');
    expect(f.room.hasUnresolvedMedia()).toBe(true);
  } finally {
    f.close();
  }
});

it('publishes settling and requested rematch states until retirement confirms', async () => {
  const confirmations: Array<() => void> = [];
  const f = fixture(
    undefined,
    (request) =>
      new Promise((resolve) => {
        confirmations.push(() => resolve({ ...request, status: 'confirmed', code: null }));
      }),
  );
  try {
    f.room.endPractice('to-map-finalizing');
    f.room.startLoading(
      layoutFor([...f.room.roles].map(([playerId, role]: any) => ({ playerId, role }))),
      0,
    );
    const game = f.room.gameInstance();
    const mediaInstanceId = f.room.mediaInstances.get(game.gameInstanceId);
    for (const player of f.players)
      f.room.playerGenerations.set(player.session.playerId, {
        mediaInstanceId,
        receiverGeneration: 1,
      });
    f.room.handleMediaIntent(
      { type: 'RETIRE_INSTANCE', reason: 'round-ended' },
      game.gameInstanceId,
    );
    f.room.finishMatch();
    f.room.syncPublic();
    expect(f.room.state.rematchState).toBe('settling');
    const previous = f.room.matchId;
    f.room.onCommand(f.players[0]!.client, {
      matchId: previous,
      requestId: randomUUID(),
      sequence: 2,
      type: 'REMATCH',
      payload: { mode: 'same' },
    });
    f.room.tick();
    expect(f.room.state.rematchState).toBe('requested');
    expect(f.room.matchId).toBe(previous);
    await f.flush();
    expect(confirmations).toHaveLength(6);
    confirmations.forEach((confirm) => confirm());
    await f.flush();
    await f.flush();
    expect(f.room.matchId).not.toBe(previous);
    expect(f.room.state.rematchState).toBeUndefined();
  } finally {
    f.close();
  }
});

it('does not revive confirmed retirements when a rematch replaces a participant', async () => {
  const f = fixture();
  try {
    f.room.endPractice('to-map-finalizing');
    f.room.startLoading(
      layoutFor([...f.room.roles].map(([playerId, role]: any) => ({ playerId, role }))),
      0,
    );
    const game = f.room.gameInstance();
    const mediaInstanceId = f.room.mediaInstances.get(game.gameInstanceId);
    for (const player of f.players)
      f.room.playerGenerations.set(player.session.playerId, {
        mediaInstanceId,
        receiverGeneration: 1,
      });
    f.room.handleMediaIntent(
      { type: 'RETIRE_INSTANCE', reason: 'round-ended' },
      game.gameInstanceId,
    );
    f.room.finishMatch();
    await f.flush();
    expect(f.room.pendingRetirements.size).toBe(0);
    expect(f.retirementRequests).toHaveLength(6);
    const oldMatch = f.room.matchId;
    f.room.startNewRound();
    expect(f.room.matchId).not.toBe(oldMatch);
    expect(f.room.phase).toBe('DEVICE_CHECK');
    await f.flush();
    expect(f.retirementRequests).toHaveLength(6);
    expect(f.room.pendingRetirements.size).toBe(0);
    expect(f.room.retiringScopes.size).toBe(0);
    const leaving = f.players[5]!;
    f.room.onLeave(leaving.client);
    expect(f.room.phase).toBe('LOBBY');
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();
    const session = f.sessions.issue({
      nickname: 'replacement',
      inviteId: 'fixture',
      roomCode: 'ABCDEF',
    });
    expect(f.slots.reserve('ABCDEF', session.playerId, 0)).toBe('reserved');
    const client = { sessionId: 'connection-replacement', send() {}, leave() {} };
    f.room.onJoin(client, {}, f.sessions.get(session.sessionId));
    const currentPlayers = [...f.players.slice(0, 5), { session, client }];
    expect(f.room.phase).toBe('DEVICE_CHECK');
    for (const player of currentPlayers)
      f.room.onCommand(player.client, {
        matchId: f.room.matchId,
        requestId: randomUUID(),
        sequence: 2,
        type: 'READY',
        payload: { ready: true },
      });
    f.room.tick();
    expect(f.room.phase).toBe('TEAM_PRACTICE');
    for (const player of currentPlayers) {
      const scope = f.room.mediaScopeFor(player.session.playerId, 'practice');
      f.room.playerGenerations.set(player.session.playerId, {
        mediaInstanceId: scope.mediaInstanceId,
        receiverGeneration: 1,
      });
      f.room.onCommand(player.client, {
        matchId: f.room.matchId,
        requestId: randomUUID(),
        sequence: 3,
        type: 'PRACTICE_READY',
        payload: { ready: true },
      });
    }
    f.room.tick();
    await f.flush();
    expect(f.retirementRequests).toHaveLength(12);
    expect(f.room.pendingRetirements.size).toBe(0);
    // This harness deliberately has no layout producer. Reaching its explicit failure
    // proves the old participant no longer pins the MAP_FINALIZING retirement barrier.
    expect(f.room.phase).toBe('DEVICE_CHECK');
    expect(f.room.blockedReason).toBe('LAYOUT:LAYOUT_PRODUCER_MISSING');
  } finally {
    f.close();
  }
});

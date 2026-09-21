/* eslint-disable @typescript-eslint/no-explicit-any -- Inspect private room state in this isolated lifecycle harness; product transport is covered separately. */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createKkakkungRoom } from '../../src/rooms/KkakkungRoom.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { RoomExpiry } from '../../src/session/RoomExpiry.js';
import { FakeCore, fakePracticePort, layoutFor, testTuning } from './test-harness.js';

function fixture(
  prepareGeneration?: (request: any) => Promise<any>,
  retire?: (request: any) => Promise<any>,
  layouts: any = null,
) {
  let now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const retirementRequests: any[] = [];
  const releasedMatches: string[] = [];
  const RoomClass = createKkakkungRoom({
    serverEpoch: 'diagnostic-epoch',
    monotonicNow: () => now,
    sessions,
    slots,
    directory: { unregister() {} } as any,
    coordinator: { rearm() {}, unregister() {} } as any,
    roomExpiry: new RoomExpiry(600_000),
    core: new FakeCore(),
    tuning: testTuning,
    practice: { port: fakePracticePort, raw: { practiceVersion: 'fixture' } },
    layouts,
    media: {
      observeFrame() {},
      releaseMatch(matchId: string) {
        releasedMatches.push(matchId);
      },
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
    releasedMatches,
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

async function pendingFinalization() {
  const f = fixture(
    async (request) => ({
      ...request,
      status: 'ready',
      receiverGeneration: 1,
      grant: {},
      code: null,
    }),
    async (request) => ({ ...request, status: 'unknown', code: 'TIMEOUT' }),
  );
  for (const player of f.players) {
    await f.room.requestMediaGrant(player.session.playerId, 'practice', null);
    await f.flush();
    f.room.onCommand(player.client, {
      matchId: f.room.matchId,
      requestId: randomUUID(),
      sequence: 2,
      type: 'PRACTICE_READY',
      payload: { ready: true },
    });
  }
  f.room.tick();
  await f.flush();
  expect(f.room.phase).toBe('MAP_FINALIZING');
  expect(f.room.pendingRetirements.size).toBe(6);
  return f;
}

it('bounds map finalization despite live heartbeats and retains unknown retirement until confirmed', async () => {
  const f = await pendingFinalization();
  try {
    const previous = f.room.matchId;
    f.advance(29_999);
    expect(f.room.phase).toBe('MAP_FINALIZING');
    f.advance(1);
    expect(f.room.phase).toBe('ABORTED');
    expect(f.room.state.abortReason).toBe('MEDIA_UNAVAILABLE');
    expect(f.room.blockedReason).toBe('MAP_FINALIZING_TIMEOUT');
    expect(f.room.state.rematchState).toBe('settling');
    expect(f.room.pendingRetirements.size).toBe(6);
    expect(f.room.mediaScopeFor(f.players[0]!.session.playerId, 'game')).toBeNull();
    const leaving = f.players[5]!;
    f.room.onLeave(leaving.client);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBe('RETIRING');
    f.room.onCommand(f.players[0]!.client, {
      matchId: previous,
      requestId: randomUUID(),
      sequence: 3,
      type: 'REMATCH',
      payload: { mode: 'lobby' },
    });
    f.room.tick();
    expect(f.room.state.rematchState).toBe('requested');
    f.advance(270_000);
    expect(f.room.phase).toBe('ABORTED');
    expect(f.room.matchId).toBe(previous);
    expect(f.slots.occupied('ABCDEF')).toBe(6);
    expect(f.slots.reserve('ABCDEF', 'replacement', 300_050)).toBe('ROOM_CLOSED');
    for (const scope of f.retirementRequests)
      f.room.enqueueMediaControl({
        type: 'MEDIA_RETIRED',
        result: { ...scope, status: 'confirmed', code: null },
      });
    f.room.tick();
    expect(f.room.matchId).not.toBe(previous);
    expect(f.room.phase).toBe('LOBBY');
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();
    expect(f.room.pendingRetirements.size).toBe(0);
    for (const scope of f.retirementRequests)
      f.room.enqueueMediaControl({
        type: 'MEDIA_RETIRED',
        result: { ...scope, status: 'unknown', code: 'TIMEOUT' },
      });
    f.room.tick();
    expect(f.room.pendingRetirements.size).toBe(0);
    expect(f.room.phase).toBe('LOBBY');
  } finally {
    f.close();
  }
});

it.each([29_999, 30_000])(
  'applies the map deadline deterministically when retirement settles at %i ms',
  async (elapsed) => {
    const f = await pendingFinalization();
    try {
      f.room.finalizing = Promise.resolve();
      f.room.pendingLayout = {
        status: 'selected',
        layout: layoutFor([...f.room.roles].map(([playerId, role]: any) => ({ playerId, role }))),
      };
      for (const scope of f.retirementRequests)
        f.room.enqueueMediaControl({
          type: 'MEDIA_RETIRED',
          result: { ...scope, status: 'confirmed', code: null },
        });
      f.advance(elapsed);
      if (elapsed < 30_000) {
        expect(f.room.phase).toBe('GAME_LOADING');
        expect(f.room.gameInstance()).not.toBeNull();
      } else {
        expect(f.room.phase).toBe('ABORTED');
        expect(f.room.gameInstance()).toBeNull();
        expect(f.room.state.rematchState).toBe('available');
      }
      expect(f.room.pendingRetirements.size).toBe(0);
    } finally {
      f.close();
    }
  },
);

it('fails current pending retirement errors after practice detaches, ignoring foreign and stale scopes', async () => {
  const f = await pendingFinalization();
  try {
    const scope = f.retirementRequests[0];
    const failure = {
      ...scope,
      type: 'MEDIA_FAILED',
      eventId: randomUUID(),
      code: 'POLICY_UNKNOWN',
    };
    f.room.enqueueMediaControl({ ...failure, matchId: 'old-match' });
    f.room.enqueueMediaControl({ ...failure, receiverGeneration: 100 });
    f.room.tick();
    expect(f.room.phase).toBe('MAP_FINALIZING');
    f.room.enqueueMediaControl(failure);
    f.room.tick();
    expect(f.room.phase).toBe('ABORTED');
    expect(f.room.state.abortReason).toBe('MEDIA_POLICY_UNCERTAIN');
    expect(f.room.pendingRetirements.size).toBe(6);
  } finally {
    f.close();
  }
});

it('invalidates a slow layout result at the deadline without creating a game after abort', async () => {
  let complete!: (value: any) => void;
  const f = fixture(undefined, undefined, {
    loader: {
      prepare: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
  });
  try {
    f.room.endPractice('to-map-finalizing');
    f.room.tick();
    expect(complete).toBeTypeOf('function');
    f.advance(30_000);
    expect(f.room.phase).toBe('ABORTED');
    expect(f.room.blockedReason).toBe('MAP_FINALIZING_TIMEOUT');
    complete({
      status: 'selected',
      layout: {
        layout: layoutFor([...f.room.roles].map(([playerId, role]: any) => ({ playerId, role }))),
      },
    });
    await f.flush();
    expect(f.room.phase).toBe('ABORTED');
    expect(f.room.gameInstance()).toBeNull();
    expect(f.room.pendingLayout).toBeNull();
  } finally {
    f.close();
  }
});

it('keeps media ownership throughout ordinary ticks and releases it only on disposal', () => {
  const f = fixture();
  try {
    const matchId = f.room.matchId;
    for (let i = 0; i < 100; i++) f.advance(50);
    expect(f.room.phase).toBe('TEAM_PRACTICE');
    expect(f.releasedMatches).toEqual([]);
    f.room.onDispose();
    expect(f.releasedMatches).toEqual([matchId]);
  } finally {
    f.close();
  }
});

it('releases the old match once on rematch and keeps the new lobby active on later ticks', () => {
  const f = fixture();
  try {
    const old = f.room.matchId;
    f.room.setPhase('RESULT');
    f.room.startNewRound();
    const next = f.room.matchId;
    expect(next).not.toBe(old);
    expect(f.releasedMatches).toEqual([old]);
    for (let i = 0; i < 20; i++) f.advance(50);
    expect(f.releasedMatches).toEqual([old]);
    expect(f.room.matchId).toBe(next);
  } finally {
    f.close();
  }
});

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

it('returns to the lobby immediately when a participant leaves during preparation', () => {
  const f = fixture();
  try {
    const leaving = f.players[5]!;
    f.room.onLeave(leaving.client);
    expect(f.room.phase).toBe('LOBBY');
    expect(f.room.lobby.list()).toHaveLength(5);
    expect(f.room.lobby.list().every((player: any) => player.connected)).toBe(true);
    expect(f.room.loading.current).toBeNull();
    expect(f.room.gameInstance()).toBeNull();
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();
  } finally {
    f.close();
  }
});

it('invalidates map and loading work when a participant leaves during map finalization', () => {
  const f = fixture();
  try {
    f.room.endPractice('to-map-finalizing');
    expect(f.room.phase).toBe('MAP_FINALIZING');
    f.room.onLeave(f.players[5]!.client);
    expect(f.room.phase).toBe('LOBBY');
    expect(f.room.pendingLayout).toBeNull();
    expect(f.room.finalizing).toBeNull();
    expect(f.room.loading.current).toBeNull();
    expect(f.room.lobby.list()).toHaveLength(5);
  } finally {
    f.close();
  }
});

it('reclaims an unready participant when device check expires without deleting the group', () => {
  const f = fixture();
  try {
    f.room.endPractice('to-device-check');
    f.room.lobby.clearReady();
    for (const player of f.players.slice(0, 5))
      f.room.lobby.applyReady(player.session.playerId, true, 'DEVICE_CHECK');
    f.advance(300_000);
    expect(f.room.phase).toBe('LOBBY');
    expect(f.room.lobby.list()).toHaveLength(5);
    expect(f.room.lobby.list().every((player: any) => player.ready === false)).toBe(true);
    expect(f.slots.slotState('ABCDEF', f.players[5]!.session.playerId)).toBeNull();
    expect(f.sessions.authenticate(f.players[5]!.session.sessionToken)).toBeNull();
  } finally {
    f.close();
  }
});

it('removes a result-stage leaver before a new round can reuse the roster', () => {
  const f = fixture();
  try {
    f.room.setPhase('RESULT');
    const leaving = f.players[5]!;
    f.room.onLeave(leaving.client);
    expect(f.room.lobby.list()).toHaveLength(5);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();

    f.room.startNewRound();
    expect(f.room.phase).toBe('LOBBY');
    expect(f.room.lobby.list()).toHaveLength(5);
    expect(f.room.lobby.list().every((player: any) => player.connected)).toBe(true);
    expect(f.slots.reserve('ABCDEF', 'replacement', 100)).toBe('reserved');
    expect(f.room.lobby.list()).not.toContainEqual(
      expect.objectContaining({ playerId: leaving.session.playerId }),
    );
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

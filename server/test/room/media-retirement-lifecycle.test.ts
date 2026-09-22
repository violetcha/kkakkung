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
  const unregistered: string[] = [];
  const events: any[] = [];
  const RoomClass = createKkakkungRoom({
    serverEpoch: 'diagnostic-epoch',
    emitEvent: (event: any) => events.push(event),
    monotonicNow: () => now,
    sessions,
    slots,
    directory: {
      unregister(roomCode: string) {
        unregistered.push(roomCode);
      },
    } as any,
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
  // S15P21C204-295. 전원이 준비해도 저절로 시작하지 않는다. 방장이 시작한다.
  room.onCommand(players[0]!.client, {
    matchId: room.matchId,
    requestId: randomUUID(),
    sequence: 2,
    type: 'ROOM_START',
    payload: {},
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
    unregistered,
    events,
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
      sequence: 20,
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
      sequence: 30,
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
      sequence: 20,
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
        sequence: 10,
        type: 'READY',
        payload: { ready: true },
      });
    f.room.onCommand(currentPlayers[0]!.client, {
      matchId: f.room.matchId,
      requestId: randomUUID(),
      sequence: 11,
      type: 'ROOM_START',
      payload: {},
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
        sequence: 40,
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

// S15P21C204-332. The first bounded retire can time out; the operations retry engine confirms the
// remote boundary minutes later, after the room is already disposed. Until E announced that
// confirmation the seats stayed RETIRING, closeRoom refused, and the room held a MAX_ROOMS slot
// until the process restarted.
it('frees a disposed room with unknown retirements once the retry engine confirms them', async () => {
  const f = await pendingFinalization();
  try {
    f.advance(30_000);
    expect(f.room.phase).toBe('ABORTED');

    // Everyone leaves while E still owes six confirmations, so every seat is RETIRING.
    for (const player of f.players) f.room.onLeave(player.client);
    for (const player of f.players)
      expect(f.slots.slotState('ABCDEF', player.session.playerId)).toBe('RETIRING');

    f.room.onDispose();
    // A RETIRING seat refuses an unconfirmed release, so the room keeps its MAX_ROOMS slot and
    // stays reachable for the late confirmation.
    expect(f.room.pendingRetirements.size).toBe(6);
    expect(f.unregistered).toHaveLength(0);
    expect(f.slots.occupied('ABCDEF')).toBe(6);
    expect(f.slots.reserve('FRESH1', 'newcomer', 400_000, { create: true })).toBe('ROOM_LIMIT');

    // A late confirmation for five scopes must not release the room early.
    for (const scope of f.retirementRequests.slice(0, 5))
      f.room.enqueueMediaControl({
        type: 'MEDIA_RETIRED',
        result: { ...scope, status: 'confirmed', code: null },
      });
    expect(f.slots.occupied('ABCDEF')).toBe(1);
    expect(f.unregistered).toHaveLength(0);

    f.room.enqueueMediaControl({
      type: 'MEDIA_RETIRED',
      result: { ...f.retirementRequests[5]!, status: 'confirmed', code: null },
    });
    expect(f.room.pendingRetirements.size).toBe(0);
    expect(f.slots.occupied('ABCDEF')).toBe(0);
    expect(f.unregistered).toEqual(['ABCDEF']);
    expect(f.slots.reserve('FRESH1', 'newcomer', 400_000, { create: true })).toBe('reserved');
  } finally {
    f.close();
  }
});

// S15P21C204-333. A producer failure without a cursor used to hold the room forever: nothing ever
// removed the player from uncertainPreparations.
async function uncertainLeaver() {
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
  const leaving = f.players[5]!;
  const preparation = f.room.requestMediaGrant(leaving.session.playerId, 'practice', null);
  await began;
  f.room.onLeave(leaving.client);
  reject(new Error('unknown allocation'));
  await preparation;
  f.room.tick();
  expect(f.room.uncertainPreparations.has(leaving.session.playerId)).toBe(true);
  expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBe('RETIRING');
  return { f, leaving };
}

const released = (f: { events: any[] }) =>
  f.events.filter((event) => event.event === 'room.media_uncertain_released');

it('lets the remaining players start a new round after a preparation of unknown outcome', async () => {
  const { f, leaving } = await uncertainLeaver();
  try {
    const previous = f.room.matchId;
    f.room.setPhase('RESULT');
    f.room.onCommand(f.players[0]!.client, {
      matchId: previous,
      requestId: randomUUID(),
      // 295 뒤로 픽스처의 방장 ROOM_START 가 sequence 2 를 쓰므로 그보다 커야 명령이 받아들여진다.
      sequence: 20,
      type: 'REMATCH',
      payload: { mode: 'same' },
    });
    f.room.tick();
    // The rematch releases the old match to E, which owns anything that preparation allocated.
    expect(f.room.matchId).not.toBe(previous);
    expect(f.releasedMatches).toContain(previous);
    expect(f.room.uncertainPreparations.size).toBe(0);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();
    expect(released(f)).toEqual([
      expect.objectContaining({
        fields: expect.objectContaining({ reason: 'round-ended', count: 1 }),
      }),
    ]);
  } finally {
    f.close();
  }
});

it('lets go of an uncertain preparation once any allocation it made has expired', async () => {
  const { f, leaving } = await uncertainLeaver();
  try {
    f.advance(329_000);
    expect(f.room.hasUnresolvedMedia()).toBe(true);
    expect(released(f)).toEqual([]);
    f.advance(1_000);
    expect(f.room.hasUnresolvedMedia()).toBe(false);
    expect(f.slots.slotState('ABCDEF', leaving.session.playerId)).toBeNull();
    expect(released(f)).toEqual([
      expect.objectContaining({
        fields: expect.objectContaining({ reason: 'expired', count: 1, durationMs: 330_000 }),
      }),
    ]);
  } finally {
    f.close();
  }
});

it('closes a disposed room that still held an uncertain preparation', async () => {
  const { f } = await uncertainLeaver();
  try {
    for (const player of f.players.slice(0, 5)) f.room.onLeave(player.client);
    f.room.onDispose();
    expect(f.unregistered).toEqual(['ABCDEF']);
    expect(f.slots.occupied('ABCDEF')).toBe(0);
    expect(f.slots.reserve('FRESH1', 'newcomer', 0, { create: true })).toBe('reserved');
    expect(released(f)).toEqual([
      expect.objectContaining({ fields: expect.objectContaining({ reason: 'disposed' }) }),
    ]);
  } finally {
    f.close();
  }
});

it('does not hold a disposed room for a preparation that fails after disposal', async () => {
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
    const preparation = f.room.requestMediaGrant(f.players[0]!.session.playerId, 'practice', null);
    await began;
    for (const player of f.players) f.room.onLeave(player.client);
    f.room.onDispose();
    // Still preparing: the room waits for the answer.
    expect(f.unregistered).toEqual([]);
    reject(new Error('unknown allocation'));
    await preparation;
    expect(f.room.uncertainPreparations.size).toBe(0);
    expect(f.unregistered).toEqual(['ABCDEF']);
    expect(f.slots.occupied('ABCDEF')).toBe(0);
  } finally {
    f.close();
  }
});

// S15P21C204-335. After the round is decided nothing may move it again: no stepping, no new
// media generation, and no late failure turning the winner into ABORTED.
it('stops a decided round: no more frames, no late generation and no abort over the result', async () => {
  let resolve!: (value: any) => void;
  let started!: () => void;
  const began = new Promise<void>((done) => {
    started = done;
  });
  const f = fixture(
    (request) =>
      new Promise((done) => {
        started();
        resolve = () =>
          done({ ...request, status: 'ready', receiverGeneration: 3, grant: {}, code: null });
      }),
  );
  try {
    const player = f.players[0]!.session.playerId;
    const preparation = f.room.requestMediaGrant(player, 'practice', null);
    await began;
    const [instance] = f.room.driver.attached();
    f.room.finishMatch();
    expect(f.room.phase).toBe('RESULT');
    const revisions = f.room.driver.attached().map((each: any) => each.frameRevision);
    for (let i = 0; i < 20; i++) f.advance(50);
    expect(f.room.driver.attached().map((each: any) => each.frameRevision)).toEqual(revisions);
    expect(f.room.driver.attached()).toContain(instance);

    // A grant finishing during RESULT finds no scope: it is retired, never adopted.
    expect(f.room.mediaScopeFor(player, 'practice')).toBeNull();
    resolve(undefined);
    await preparation;
    await f.flush();
    expect(f.room.playerGenerations.has(player)).toBe(false);
    expect(f.retirementRequests).toEqual([
      expect.objectContaining({ playerId: player, receiverGeneration: 3 }),
    ]);

    f.room.abortMatch('MEDIA_UNAVAILABLE', 'LATE_FAILURE');
    expect(f.room.phase).toBe('RESULT');
    expect(f.room.abortReason).toBeNull();
  } finally {
    f.close();
  }
});

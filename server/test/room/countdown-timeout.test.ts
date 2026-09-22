/* eslint-disable @typescript-eslint/no-explicit-any -- Drives the room's own phase machine on a fake clock; product transport is covered separately. */
// S15P21C204-328. COUNTDOWN used to be the one phase with no way out. `countdown.due` is true
// exactly once, the core refuses a START_PLAYING it cannot apply without saying so, and RoomExpiry
// keeps the room. Lose that one control and six people watch a countdown that never ends.
import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LayoutLoader } from '../../src/game/LayoutLoader.js';
import { createKkakkungRoom } from '../../src/rooms/KkakkungRoom.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { RoomExpiry } from '../../src/session/RoomExpiry.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import {
  FakeCore,
  fakeMapPorts,
  fakePracticePort,
  fallbackFileFor,
  testTuning,
} from './test-harness.js';

/** In-memory master/fallback bytes so the loader can select a layout without touching disk. */
function layoutFiles() {
  const master = Buffer.from(JSON.stringify({ regions: true, note: 'countdown fixture' }), 'utf8');
  const templateHash = createHash('sha256').update(master).digest('hex');
  const source = { templateId: 'test-template', templateVersion: 'v1', templateHash };
  const store = new Map<string, Uint8Array>([
    ['master.json', master],
    [
      'fallback.json',
      Buffer.from(
        JSON.stringify(
          ['r0', 'r1', 'r2'].map((variantId) => fallbackFileFor({ ...source, variantId })),
        ),
        'utf8',
      ),
    ],
  ]);
  return async (path: string) => {
    const bytes = store.get(path);
    if (!bytes) throw new Error('ENOENT');
    return bytes;
  };
}

/**
 * Six ready players on a fake clock, no media, driven with the room's own commands. `dropStart`
 * makes the core ignore START_PLAYING, which is what a lost or refused control looks like from
 * the room's side: nothing is reported, the match simply never enters PLAYING.
 */
function fixture(dropStart: boolean) {
  let now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  class Core extends FakeCore {
    stepMatch(state: any, input: any): any {
      return super.stepMatch(
        state,
        dropStart
          ? { ...input, controls: input.controls.filter((c: any) => c.type !== 'START_PLAYING') }
          : input,
      );
    }
  }
  const RoomClass = createKkakkungRoom({
    serverEpoch: 'countdown-epoch',
    monotonicNow: () => now,
    sessions,
    slots,
    directory: { unregister() {} } as any,
    coordinator: { rearm() {}, unregister() {} } as any,
    roomExpiry: new RoomExpiry(600_000),
    core: new Core() as any,
    tuning: testTuning,
    practice: { port: fakePracticePort, raw: { practiceVersion: 'fixture' } },
    layouts: {
      ...fakeMapPorts(),
      loader: new LayoutLoader({
        ...fakeMapPorts(),
        readFile: layoutFiles(),
        now: () => now,
        yieldToEventLoop: async () => {},
      }),
      masterPath: 'master.json',
      fallbackPath: 'fallback.json',
      templateId: 'test-template',
      templateVersion: 'v1',
    } as any,
    media: null,
    assetVersion: 'fixture',
    random: () => 0.5,
  });
  const room: any = new RoomClass();
  room.roomCode = 'ABCDEF';
  room.broadcast = () => undefined;
  const players = Array.from({ length: 6 }, (_, i) => {
    const session = sessions.issue({
      nickname: `카운트${i}`,
      inviteId: 'fixture',
      roomCode: room.roomCode,
    });
    slots.reserve(room.roomCode, session.playerId, now, { create: true });
    const client = { sessionId: `connection-${i}`, send() {}, leave() {} };
    room.onJoin(client, {}, sessions.get(session.sessionId));
    return { session, client };
  });
  let sequence = 0;
  const send = (player: (typeof players)[number], type: string, payload: unknown) =>
    room.onCommand(player.client, {
      matchId: room.matchId,
      requestId: randomUUID(),
      sequence: ++sequence,
      type,
      payload,
    });
  const advance = (ms: number) => {
    now += ms;
    room.heartbeat.resetForMatch(now);
    room.tick();
  };
  return { room, players, send, advance, close: () => room.clock.clear() };
}

/** Walks the room from LOBBY to COUNTDOWN the way the product does. */
async function toCountdown(dropStart: boolean) {
  const f = fixture(dropStart);
  for (const player of f.players) f.send(player, 'READY', { ready: true });
  // S15P21C204-295. 전원이 준비해도 저절로 시작하지 않는다. 방장이 시작한다.
  f.send(f.players[0]!, 'ROOM_START', {});
  f.advance(50);
  expect(f.room.phase).toBe('TEAM_PRACTICE');
  for (const player of f.players) f.send(player, 'PRACTICE_READY', { ready: true });
  f.advance(50);
  expect(f.room.phase).toBe('MAP_FINALIZING');
  // The loader resolves off the microtask queue; the next tick picks the layout up.
  for (let i = 0; i < 8 && f.room.phase === 'MAP_FINALIZING'; i++) {
    await Promise.resolve();
    f.advance(50);
  }
  expect(f.room.phase).toBe('GAME_LOADING');
  for (const player of f.players) {
    const loading = f.room.dispatcher.publishView(player.session.playerId, 'resync', 'GAME_LOADING')
      ?.self?.loading;
    expect(loading, 'the loading barrier must name a scope to report against').toBeTruthy();
    f.send(player, 'LOAD_READY', {
      loadId: loading.loadId,
      mediaInstanceId: loading.mediaInstanceId,
      receiverGeneration: loading.receiverGeneration,
    });
  }
  f.advance(50);
  expect(f.room.phase).toBe('COUNTDOWN');
  return f;
}

it('starts PLAYING well inside the countdown timeout when the start control lands', async () => {
  const f = await toCountdown(false);
  try {
    // The countdown itself is 3s; the control it hands over is applied on the very next tick.
    f.advance(3000);
    f.advance(50);
    expect(f.room.phase).toBe('PLAYING');
    // Time passing after the start changes nothing: the timeout belongs to COUNTDOWN alone.
    f.advance(20_000);
    expect(f.room.phase).toBe('PLAYING');
  } finally {
    f.close();
  }
});

it('returns to device check instead of sitting in COUNTDOWN forever when the start never applies', async () => {
  const f = await toCountdown(true);
  try {
    f.advance(3000);
    f.advance(50);
    // The control went out and was ignored. Before this story nothing would ever fire again.
    expect(f.room.phase).toBe('COUNTDOWN');
    f.advance(11_000);
    expect(f.room.phase).toBe('COUNTDOWN');
    f.advance(1000);
    expect(f.room.phase).toBe('DEVICE_CHECK');
    expect(f.room.blockedReason).toBe('COUNTDOWN_TIMEOUT');
    // Nobody is stranded: the room is usable again and the players keep their seats.
    expect(f.room.lobby.list()).toHaveLength(6);
  } finally {
    f.close();
  }
});

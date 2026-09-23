/* eslint-disable @typescript-eslint/no-explicit-any -- Inspect private room state in this isolated harness; the product transport is covered by the demo/room integration tests. */
/**
 * 발표 시연 방(showcase)의 방 동작. 넷이 고른 역할 그대로 2:2 로 배정되고, 맵은 소형·고정 시드로
 * 준비되며(템플릿이 요구하는 여섯 자리는 빈 이름으로 채운다), 경기는 실제 넷만으로 제한시간
 * 판정 정책을 달고 만들어진다. 앞의 두 케이스는 가짜 코어·가짜 로더로 방의 배선을 보고, 뒤의
 * 두 케이스는 실제 `matchCore` 와 인증된 소형 미로로 경기가 실제로 만들어지는지, 코어가 거절하면
 * 준비 실패로 끝나는지를 본다(S15P21C204-350).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { bindFallbackPlayers, matchCore } from '@kkakkung/game-core/match';
import type { RoomRosterMessage } from '@kkakkung/protocol/game-messages';
import type { CorePort, MatchLayout } from '../../src/game/ports.js';
import { createKkakkungRoom } from '../../src/rooms/KkakkungRoom.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { RoomExpiry } from '../../src/session/RoomExpiry.js';
import { FakeCore, fakePracticePort, layoutFor, testTuning } from './test-harness.js';

type RosterEntry = { playerId: string; role: 'tagger' | 'runner' };

/** The certified small maze's identity placement, bound to the six-slot roster the room asks for. */
function smallMazeLayout(players: readonly RosterEntry[]): MatchLayout {
  const file = JSON.parse(
    readFileSync(
      new URL('../../content/placements/maze-s-v1-fallback.json', import.meta.url),
      'utf8',
    ),
  ) as { fallbacks: { variantId: string; layout: MatchLayout }[] };
  const identity = file.fallbacks.find((f) => f.variantId === 'r0')!;
  const bound = bindFallbackPlayers(identity.layout, players);
  if (!bound) throw new Error('small maze binding failed');
  return bound;
}

function fixture(
  options: {
    core?: CorePort<any>;
    layout?: (players: readonly RosterEntry[]) => MatchLayout;
    /** 미디어 포트. 기본은 없음. S15P21C204-360 은 해제 확인이 오지 않는 미디어를 꽂는다. */
    media?: unknown;
  } = {},
) {
  let now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const core = options.core ?? new FakeCore();
  const layoutOf = options.layout ?? ((players: readonly RosterEntry[]) => layoutFor(players));
  const prepared: { players: { playerId: string; role: string }[]; seed: number }[] = [];
  const loader = {
    prepare: async (input: any) => {
      prepared.push({ players: input.players, seed: input.seed });
      return {
        status: 'selected',
        source: { templateId: 't', templateVersion: 'v1', templateHash: 'h', variantId: 'r0' },
        layout: { status: 'selected', source: 'online', layout: layoutOf(input.players) },
      };
    },
  };
  const RoomClass = createKkakkungRoom({
    serverEpoch: 'showcase-epoch',
    monotonicNow: () => now,
    sessions,
    slots,
    directory: { register() {}, unregister() {} } as any,
    coordinator: { register() {}, rearm() {}, unregister() {} } as any,
    roomExpiry: new RoomExpiry(600_000),
    core,
    tuning: testTuning,
    practice: { port: fakePracticePort, raw: { practiceVersion: 'fixture' } },
    layouts: {
      loader: loader as any,
      masterPath: 'large-master',
      fallbackPath: 'large-fallback',
      templateId: 'large',
      templateVersion: 'v1',
      bySize: {
        small: {
          masterPath: 'small-master',
          fallbackPath: 'small-fallback',
          templateId: 'small',
          templateVersion: 'v1',
        },
      },
    },
    media: (options.media ?? null) as any,
    assetVersion: 'fixture',
    random: () => 0.5,
  });
  const room: any = new RoomClass();
  room.roomCode = 'SHOWC1';
  const rosters: RoomRosterMessage[] = [];
  room.broadcast = (type: string, value: unknown) => {
    if (type === 'room-roster') rosters.push(value as RoomRosterMessage);
  };
  const roles = ['runner', 'tagger', 'tagger', 'runner'] as const;
  const players = roles.map((role, i) => {
    const session = sessions.issue({
      nickname: `p${i}`,
      inviteId: 'showcase:fixture',
      roomCode: room.roomCode,
    });
    expect(
      slots.reserve(room.roomCode, session.playerId, now, { create: i === 0, showcase: { role } }),
    ).toBe('reserved');
    return { session, role, client: { sessionId: `connection-${i}`, send() {}, leave() {} } };
  });
  room.onCreate({ roomCode: room.roomCode });
  const command = (
    player: (typeof players)[number],
    type: string,
    payload: unknown,
    sequence: number,
  ) =>
    room.onCommand(player.client, {
      matchId: room.matchId,
      requestId: randomUUID(),
      sequence,
      type,
      payload,
    });
  return {
    room,
    core: core as FakeCore,
    slots,
    sessions,
    players,
    rosters,
    prepared,
    command,
    join: () => {
      for (const player of players)
        room.onJoin(player.client, {}, sessions.get(player.session.sessionId));
    },
    tick: () => {
      now += 50;
      room.tick();
    },
    flush: async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      room.tick();
    },
    close: () => room.clock.clear(),
  };
}

it('seats four, keeps their chosen roles as the 2:2 plan and tells clients the room kind', () => {
  const f = fixture();
  try {
    expect(f.room.maxClients).toBe(4);
    expect(f.room.lobby.capacity).toBe(4);
    f.join();
    // 넷이 모이면 바로 장치 점검이다. 여섯을 기다리지 않는다.
    expect(f.room.phase).toBe('DEVICE_CHECK');
    const roster = f.rosters.at(-1)!;
    expect(roster.kind).toBe('showcase');
    expect(roster.capacity).toBe(4);
    expect(roster.players).toHaveLength(4);
    // 맵은 소형으로 고정이고 방장도 바꿀 수 없다.
    expect(f.room.roomMapSize).toBe('small');
    f.command(f.players[0]!, 'ROOM_MAP_SIZE', { size: 'large' }, 1);
    f.tick();
    expect(f.room.roomMapSize).toBe('small');
    for (const [index, player] of f.players.entries())
      f.command(player, 'READY', { ready: true }, index + 2);
    // S15P21C204-295. 전원이 준비해도 저절로 시작하지 않는다. 방장이 시작한다.
    f.tick();
    f.command(f.players[0]!, 'ROOM_START', {}, 20);
    f.tick();
    expect(f.room.phase).toBe('TEAM_PRACTICE');
    for (const player of f.players)
      expect(f.room.roles.get(player.session.playerId)).toBe(player.role);
  } finally {
    f.close();
  }
});

it('prepares the small maze with a fixed seed and six template slots, then creates the match for the real four', async () => {
  const f = fixture();
  try {
    f.join();
    for (const [index, player] of f.players.entries())
      f.command(player, 'READY', { ready: true }, index + 1);
    f.tick();
    f.command(f.players[0]!, 'ROOM_START', {}, 6);
    f.tick();
    expect(f.room.phase).toBe('TEAM_PRACTICE');
    for (const [index, player] of f.players.entries())
      f.command(player, 'PRACTICE_READY', { ready: true }, index + 10);
    f.tick();
    await f.flush();
    expect(f.room.phase).toBe('MAP_FINALIZING');
    await f.flush();
    await f.flush();
    expect(f.room.phase).toBe('GAME_LOADING');

    // 로더는 소형 템플릿과 고정 시드를 받고, 빈 두 자리는 이름만 있는 참가자로 채워진다.
    expect(f.prepared).toHaveLength(1);
    const request = f.prepared[0]!;
    expect(request.seed).toBe(20260922);
    expect(request.players).toHaveLength(6);
    expect(request.players.filter((p) => p.role === 'runner')).toHaveLength(3);
    expect(request.players.filter((p) => p.playerId.startsWith('showcase-vacant-'))).toHaveLength(
      2,
    );

    // 경기는 실제 넷만으로, 제한시간 판정 정책과 3분 시계를 달고 만들어진다.
    const created = f.core.calls.find((call) => call.method === 'createMatch')!.args as any;
    expect(created.players).toHaveLength(4);
    expect(created.result).toBe('timeout-only');
    expect(created.deadline).toBe('round');
    expect(created.layout.players).toHaveLength(4);
    expect(created.layout.exits).toHaveLength(2);
    expect(created.layout.territories).toHaveLength(2);
    for (const placed of created.layout.players)
      expect(placed.playerId.startsWith('showcase-vacant-')).toBe(false);
  } finally {
    f.close();
  }
});

/** Drives a joined room through READY, ROOM_START and PRACTICE_READY into MAP_FINALIZING. */
async function reachMapFinalizing(f: ReturnType<typeof fixture>) {
  f.join();
  for (const [index, player] of f.players.entries())
    f.command(player, 'READY', { ready: true }, index + 1);
  f.tick();
  f.command(f.players[0]!, 'ROOM_START', {}, 6);
  f.tick();
  expect(f.room.phase).toBe('TEAM_PRACTICE');
  for (const [index, player] of f.players.entries())
    f.command(player, 'PRACTICE_READY', { ready: true }, index + 10);
  f.tick();
  await f.flush();
  expect(f.room.phase).toBe('MAP_FINALIZING');
}

it('S15P21C204-350: reaches GAME_LOADING with the real rules and the real small maze for four players', async () => {
  // 가짜 코어는 인원 불변식이 없어 이 결함을 지나쳤다. 실제 `matchCore` 와 인증된 소형 미로 배치다.
  const f = fixture({ core: matchCore, layout: smallMazeLayout });
  try {
    await reachMapFinalizing(f);
    await f.flush();
    await f.flush();
    expect(f.room.phase).toBe('GAME_LOADING');
    expect(f.room.blockedReason).toBeNull();
    const attached = f.room.driver.attached();
    expect(attached).toHaveLength(1);
    const frame = matchCore.getFrame(attached[0]!.state);
    expect(frame.phase).toBe('GAME_LOADING');
    expect(frame.participants.map((p: { role: string }) => p.role).sort()).toEqual([
      'runner',
      'runner',
      'tagger',
      'tagger',
    ]);
  } finally {
    f.close();
  }
});

it('S15P21C204-350: a match the rules refuse ends preparation with its own reason, not a tick fault', async () => {
  const core = new FakeCore();
  core.createMatch = () => {
    throw new RangeError('a match needs 3 taggers and 3 runners');
  };
  const f = fixture({ core });
  try {
    await reachMapFinalizing(f);
    // The tick must return normally: a thrown createMatch used to escape here and be reported as
    // SERVER_TICK_OVERLOAD by the coordinator.
    await f.flush();
    await f.flush();
    expect(f.room.phase).toBe('DEVICE_CHECK');
    expect(f.room.abortReason).toBeNull();
    expect(f.room.blockedReason).toBe('MATCH_CREATE:a match needs 3 taggers and 3 runners');
    expect(f.room.driver.attached()).toHaveLength(0);
  } finally {
    f.close();
  }
});

it('S15P21C204-360: frees the seats and the room entry on dispose without waiting for media confirmation', async () => {
  // 배포는 LiveKit 을 쓴다. E 가 해제를 확인하지 않는 미디어로, 넷이 모두 나간 뒤 방이 소멸하면
  // 시연 방은 RETIRING 자리를 남기지 않고 즉시 등록부에서 사라져 다음 시연이 새 방을 연다.
  const retirements: any[] = [];
  const media = {
    observeFrame() {},
    releaseMatch() {},
    lifecycle: { setGameConnection() {} },
    prepareGeneration: async (request: any) => ({
      ...request,
      status: 'ready',
      receiverGeneration: 1,
      grant: {},
      code: null,
    }),
    retireGeneration: async (request: any) => {
      retirements.push(request);
      return { ...request, status: 'unknown', code: 'TIMEOUT' };
    },
  };
  const f = fixture({ media });
  try {
    f.join();
    for (const [index, player] of f.players.entries())
      f.command(player, 'READY', { ready: true }, index + 1);
    f.tick();
    f.command(f.players[0]!, 'ROOM_START', {}, 6);
    f.tick();
    expect(f.room.phase).toBe('TEAM_PRACTICE');
    // 연습 미디어 세대를 받은 넷이 모두 창을 닫는다. 해제 확인은 오지 않는다.
    for (const player of f.players) {
      await f.room.requestMediaGrant(player.session.playerId, 'practice', null);
      await f.flush();
    }
    for (const player of f.players) f.room.onLeave(player.client);
    expect(f.room.pendingRetirements.size).toBe(4);
    for (const player of f.players)
      expect(f.slots.slotState(f.room.roomCode, player.session.playerId)).toBe('RETIRING');

    f.room.onDispose();
    expect(f.slots.hasRoom(f.room.roomCode)).toBe(false);
    expect(f.slots.occupied(f.room.roomCode)).toBe(0);
    expect(f.slots.joinableShowcaseRoom()).toBeNull();
    expect(f.slots.formingShowcaseRoom()).toBe(false);
    // 방 한도가 1 인 이 픽스처에서도 다음 시연 방이 바로 열린다.
    expect(
      f.slots.reserve('SHOWC2', 'next-host', 1_000, { create: true, showcase: { role: 'runner' } }),
    ).toBe('reserved');

    // 늦게 온 해제 확인은 소멸한 핸들이 받아 아무것도 건드리지 않는다.
    for (const scope of retirements)
      f.room.enqueueMediaControl({
        type: 'MEDIA_RETIRED',
        result: { ...scope, status: 'confirmed', code: null },
      });
    expect(f.room.pendingRetirements.size).toBe(0);
    expect(f.slots.hasRoom(f.room.roomCode)).toBe(false);
    expect(f.slots.occupied('SHOWC2')).toBe(1);
  } finally {
    f.close();
  }
});

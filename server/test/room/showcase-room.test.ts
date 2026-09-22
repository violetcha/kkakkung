/* eslint-disable @typescript-eslint/no-explicit-any -- Inspect private room state in this isolated harness; the product transport is covered by the demo/room integration tests. */
/**
 * 발표 시연 방(showcase)의 방 동작. 넷이 고른 역할 그대로 2:2 로 배정되고, 맵은 소형·고정 시드로
 * 준비되며(템플릿이 요구하는 여섯 자리는 빈 이름으로 채운다), 경기는 실제 넷만으로 제한시간
 * 판정 정책을 달고 만들어진다. 가짜 코어·가짜 로더라 규칙 판정이 아닌 방의 배선을 본다.
 */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { RoomRosterMessage } from '@kkakkung/protocol/game-messages';
import { createKkakkungRoom } from '../../src/rooms/KkakkungRoom.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { RoomExpiry } from '../../src/session/RoomExpiry.js';
import { FakeCore, fakePracticePort, layoutFor, testTuning } from './test-harness.js';

function fixture() {
  let now = 0;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 1 });
  const core = new FakeCore();
  const prepared: { players: { playerId: string; role: string }[]; seed: number }[] = [];
  const loader = {
    prepare: async (input: any) => {
      prepared.push({ players: input.players, seed: input.seed });
      return {
        status: 'selected',
        source: { templateId: 't', templateVersion: 'v1', templateHash: 'h', variantId: 'r0' },
        layout: { status: 'selected', source: 'online', layout: layoutFor(input.players) },
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
    media: null,
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
    core,
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

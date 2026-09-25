/**
 * S15P21C204-258. Demo room on the real composition: real HTTP/Colyseus transport, the real seat
 * registry and room, A's `matchCore` and map selection. Media is disabled because puppets have no
 * camera, so this is not Cloud or device evidence. It shows that one operator alone reaches a
 * real match through the ordinary phases, and that no player-facing route opens the room.
 */
import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import {
  DEMO_ROOM_ROUTE,
  demoRoomResponseSchema,
  type CommandEnvelope,
  type CommandReceipt,
  type GameHeartbeat,
  type DemoRoomResponse,
  type RoomRosterMessage,
} from '@kkakkung/protocol/game-messages';
import type { PrivateView, PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import type { MatchState } from '@kkakkung/game-core/match';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';
import { loadProductProfile } from '../../src/game/ProductProfileLoader.js';
import { createTestOperatorAuth, TEST_OPS_TOKEN } from './test-harness.js';

const configuration = (demoRooms: boolean) => ({
  ...parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SERVER_PROFILE: 'product',
    SERVICE_AUDIENCE: 'public',
    TRUST_PROXY_HOPS: '1',
    MEDIA_MODE: 'disabled',
    OPS_TOKEN: TEST_OPS_TOKEN,
    DEMO_ROOMS: demoRooms ? '1' : '0',
    INVITE_MAX_TTL_MS: '600000',
    SESSION_ATTEMPT_WINDOW_MS: '60000',
    SESSION_ATTEMPTS_PER_INVITE: '20',
    SESSION_ATTEMPTS_PER_IP: '100',
    ROOM_IDLE_TTL_MS: '600000',
  }),
  port: 0,
});

async function fixture(demoRooms = true, strictProduct = false, clock = { offsetMs: 0 }) {
  const config = configuration(demoRooms);
  const real = await loadProductProfile(config);
  const application = createApplication<MatchState>(config, {
    ...real,
    strictProduct,
    developmentAdmission: () => 'OPEN',
    createOperatorAuth: createTestOperatorAuth,
    publicWindow: { mode: 'continuous' },
    serverEpoch: 'epoch-demo-test',
    maxRooms: 2,
    monotonicNow: () => performance.now() + clock.offsetMs,
  });
  const port = await application.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  const peers: Room<unknown, PublicMatchState>[] = [];
  const open = (body: unknown, token: string | null = TEST_OPS_TOKEN) =>
    fetch(endpoint + DEMO_ROOM_ROUTE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const connect = async (session: DemoRoomResponse) => {
    const room = await new Client(endpoint).joinOrCreate<unknown, PublicMatchState>(
      PRODUCT_ROOM_NAME,
      {
        token: session.sessionToken,
        roomCode: session.roomCode,
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
      },
    );
    room.reconnection.enabled = false;
    room.onMessage('*', () => undefined);
    // The product runtime answers heartbeats; a test client must do the same or the server
    // drops it after six seconds and the match aborts with GAME_CONNECTION_LOST.
    room.onMessage('game-heartbeat', (value: GameHeartbeat) =>
      room.send('game-heartbeat-ack', {
        serverEpoch: value.serverEpoch,
        matchId: value.matchId,
        heartbeatSeq: value.heartbeatSeq,
      }),
    );
    peers.push(room);
    await vi.waitFor(() => expect(room.state.matchId).toBeTruthy());
    return room;
  };
  let sequence = 0;
  const send = async (
    room: Room<unknown, PublicMatchState>,
    input: Pick<CommandEnvelope, 'type' | 'payload'>,
  ) => {
    const command = {
      matchId: room.state.matchId,
      requestId: randomUUID(),
      sequence: ++sequence,
      ...input,
    };
    let receipt: CommandReceipt | undefined;
    const off = room.onMessage('command-result', (value: CommandReceipt) => {
      if (value.requestId === command.requestId) receipt = value;
    });
    room.send('command', command);
    await vi.waitFor(() => expect(receipt).toBeDefined());
    off();
    return receipt!;
  };
  return {
    application,
    endpoint,
    open,
    connect,
    send,
    close: async () => {
      await Promise.all(
        peers.map((peer) => (peer.connection.isOpen ? peer.leave() : Promise.resolve())),
      );
      await application.close();
    },
  };
}

// The phase waits below are wider than the sibling tests: under a full parallel vitest run on a
// 4-core host this match with five puppets took 15.9 s to reach PLAYING (2026-09-18, local).
it('takes one operator through the real phases into a match with five puppets', async () => {
  const f = await fixture();
  try {
    const created = await f.open({ role: 'runner' });
    expect(created.status).toBe(201);
    const session = demoRoomResponseSchema.parse(await created.json());
    const room = await f.connect(session);
    const rosters: RoomRosterMessage[] = [];
    room.onMessage('room-roster', (value: RoomRosterMessage) => rosters.push(value));
    const views: PrivateView[] = [];
    room.onMessage('private-view', (value: PrivateView) => views.push(value));

    // The five puppets complete the room, so device check opens for the operator alone.
    await vi.waitFor(() => expect(room.state.phase).toBe('DEVICE_CHECK'));
    expect((await f.send(room, { type: 'READY', payload: { ready: true } })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(rosters.at(-1)?.players).toHaveLength(6));
    // The roster never reveals a role, not even for puppets.
    expect(JSON.stringify(rosters.at(-1))).not.toMatch(/runner|tagger/);

    // S15P21C204-295. 데모 방도 실제 방과 같은 길을 걷는다: 방장이 시작하고, 팀 연습을 거친다.
    // 인형은 보고할 클라이언트가 없어 서버가 대신 연습을 마쳤다고 적어 두므로, 운영자가 자기
    // 연습을 끝내면 바로 넘어간다.
    expect((await f.send(room, { type: 'ROOM_START', payload: {} })).status).toBe('accepted');
    await vi.waitFor(() => expect(room.state.phase).toBe('TEAM_PRACTICE'), { timeout: 30_000 });
    expect((await f.send(room, { type: 'PRACTICE_READY', payload: { ready: true } })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(room.state.phase).toBe('GAME_LOADING'), { timeout: 30_000 });
    expect((await f.send(room, { type: 'LOAD_READY', payload: loadPayload(views) })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(room.state.phase).toBe('PLAYING'), { timeout: 30_000 });
    const self = views.at(-1)?.self;
    expect(self?.status === 'ACTIVE' && self.role).toBe('runner');
    // A real game instance with the round armed, not a practice instance.
    expect(views.at(-1)?.gameScope.kind).toBe('game');
    expect(room.state.deadlineTick ?? null).toBeNull();
    expect(room.state.counts.escaped).toBe(0);
    expect(room.state.counts.captured).toBe(0);
    // The operator plays by the ordinary rules: a command is judged by A's core.
    expect((await f.send(room, { type: 'TURN', payload: { direction: 'left' } })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => {
      const latest = views.at(-1)?.self;
      expect(latest?.status === 'ACTIVE' && latest.action?.kind).toBe('turn');
    });

    // The puppets stand still: nothing happens until a scenario tells them to act (259).
    const before = room.state.serverTick;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(room.state.serverTick).toBeGreaterThan(before);
    expect(room.state.phase).toBe('PLAYING');
    expect(room.state.counts).toMatchObject({ escaped: 0, captured: 0 });

    // No seat for anyone else, and no player-facing session route into the room.
    expect(f.application.slots!.occupied(session.roomCode)).toBe(1);
    const joined = await fetch(f.endpoint + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'friend', createRoom: false, roomCode: session.roomCode }),
    });
    expect(joined.status).toBe(403);
  } finally {
    await f.close();
  }
}, 60_000);

// S15P21C204-396. 일반 방의 "로비로 돌아가기" 재경기도 데모에서 확인한다. 인형이 자리를 지키므로
// 관리자만 다시 준비하면 새 라운드로 들어가고, 관리자가 고른 역할은 그대로다.
it('takes the demo room back to the lobby and into a new round with the same operator role', async () => {
  const f = await fixture();
  try {
    const session = demoRoomResponseSchema.parse(await (await f.open({ role: 'tagger' })).json());
    const room = await f.connect(session);
    const views: PrivateView[] = [];
    room.onMessage('private-view', (value: PrivateView) => views.push(value));
    const toPlaying = async () => {
      await vi.waitFor(() => expect(room.state.phase).toBe('DEVICE_CHECK'), { timeout: 30_000 });
      expect((await f.send(room, { type: 'READY', payload: { ready: true } })).status).toBe(
        'accepted',
      );
      expect((await f.send(room, { type: 'ROOM_START', payload: {} })).status).toBe('accepted');
      await vi.waitFor(() => expect(room.state.phase).toBe('TEAM_PRACTICE'), { timeout: 30_000 });
      await f.send(room, { type: 'PRACTICE_READY', payload: { ready: true } });
      await vi.waitFor(() => expect(room.state.phase).toBe('GAME_LOADING'), { timeout: 30_000 });
      await f.send(room, { type: 'LOAD_READY', payload: loadPayload(views) });
      await vi.waitFor(() => expect(room.state.phase).toBe('PLAYING'), { timeout: 30_000 });
    };
    await toPlaying();
    const firstMatch = room.state.matchId;
    room.send('demo-control', { matchId: firstMatch, action: 'abort-round' });
    await vi.waitFor(() => expect(room.state.phase).toBe('ABORTED'), { timeout: 30_000 });
    expect((await f.send(room, { type: 'REMATCH', payload: { mode: 'lobby' } })).status).toBe(
      'accepted',
    );
    await toPlaying();
    expect(room.state.matchId).not.toBe(firstMatch);
    const self = views.at(-1)?.self;
    expect(self?.status === 'ACTIVE' && self.role).toBe('tagger');
  } finally {
    await f.close();
  }
}, 120_000);

function loadPayload(views: readonly PrivateView[]) {
  const loading = views.at(-1)?.self;
  const value = loading?.status === 'ACTIVE' ? loading.loading : null;
  if (!value) throw new Error('LOADING_VIEW_MISSING');
  return {
    loadId: value.loadId,
    mediaInstanceId: value.mediaInstanceId,
    receiverGeneration: value.receiverGeneration,
  };
}

it('refuses the demo room without the operator token and when it is not enabled', async () => {
  const f = await fixture();
  try {
    expect((await f.open({ role: 'runner' }, null)).status).toBe(401);
    expect((await f.open({ role: 'nobody' })).status).toBe(400);
  } finally {
    await f.close();
  }
});

it('answers the route with 503 while demo rooms are off', async () => {
  const f = await fixture(false);
  try {
    const response = await f.open({ role: 'tagger' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'DEMO_UNAVAILABLE' });
    expect(f.application.slots!.totalOccupied()).toBe(0);
  } finally {
    await f.close();
  }
});

it('opens the demo room on the deployed composition, where a match cannot start', async () => {
  // The deployed overlays run a strict product with MEDIA_MODE disabled, so media readiness never
  // reaches READY there and every match gate answers NOT_READY. The demo room uses no media and
  // must still open and play (S15P21C204-258); it is the only room that does.
  const f = await fixture(true, true);
  try {
    const refused = await fetch(f.endpoint + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'friend', createRoom: true }),
    });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: 'ADMISSION_CLOSED' });

    const created = await f.open({ role: 'tagger' });
    expect(created.status).toBe(201);
    const session = demoRoomResponseSchema.parse(await created.json());
    // onAuth and onJoin: the operator is admitted although the match gate is shut.
    const room = await f.connect(session);
    const views: PrivateView[] = [];
    room.onMessage('private-view', (value: PrivateView) => views.push(value));
    await vi.waitFor(() => expect(room.state.phase).toBe('DEVICE_CHECK'));
    expect(f.application.slots!.occupied(session.roomCode)).toBe(1);
    // The demo gate still applies on the deployed composition.
    expect((await f.send(room, { type: 'READY', payload: { ready: true } })).status).toBe(
      'accepted',
    );
    expect((await f.send(room, { type: 'ROOM_START', payload: {} })).status).toBe('accepted');
    await vi.waitFor(() => expect(room.state.phase).toBe('TEAM_PRACTICE'), { timeout: 15_000 });
    expect((await f.send(room, { type: 'PRACTICE_READY', payload: { ready: true } })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(room.state.phase).toBe('GAME_LOADING'), { timeout: 15_000 });
    expect((await f.send(room, { type: 'LOAD_READY', payload: loadPayload(views) })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(room.state.phase).toBe('PLAYING'), { timeout: 15_000 });
  } finally {
    await f.close();
  }
}, 60_000);

// S15P21C204-312. A refresh used to end the demo: the room disposed with its only client, the
// connection loss freed the seat and voided the match, and PLAYING refused the join.
async function rejoin(f: Awaited<ReturnType<typeof fixture>>, session: DemoRoomResponse) {
  try {
    return await f.connect(session);
  } catch (error) {
    const refused = error as { code?: number; message?: string };
    throw new Error(`REJOIN_REFUSED ${refused.code} ${refused.message}`, { cause: error });
  }
}

it('lets the operator come back after a refresh before the match', async () => {
  const f = await fixture();
  try {
    const session = demoRoomResponseSchema.parse(await (await f.open({ role: 'runner' })).json());
    const first = await f.connect(session);
    await vi.waitFor(() => expect(first.state.phase).toBe('DEVICE_CHECK'));
    await first.leave(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(f.application.slots!.occupied(session.roomCode)).toBe(1);

    const again = await rejoin(f, session);
    await vi.waitFor(() => expect(again.state.phase).toBe('DEVICE_CHECK'));
    expect(f.application.slots!.occupied(session.roomCode)).toBe(1);
  } finally {
    await f.close();
  }
}, 60_000);

it('keeps the running demo match through a refresh and hands it back', async () => {
  const f = await fixture();
  try {
    const session = demoRoomResponseSchema.parse(await (await f.open({ role: 'runner' })).json());
    const first = await f.connect(session);
    const views: PrivateView[] = [];
    first.onMessage('private-view', (value: PrivateView) => views.push(value));
    await vi.waitFor(() => expect(first.state.phase).toBe('DEVICE_CHECK'));
    await f.send(first, { type: 'READY', payload: { ready: true } });
    // S15P21C204-295. 방장이 시작하고 팀 연습을 거친다. 인형 몫의 보고는 서버가 대신 적는다.
    await f.send(first, { type: 'ROOM_START', payload: {} });
    await vi.waitFor(() => expect(first.state.phase).toBe('TEAM_PRACTICE'), { timeout: 30_000 });
    await f.send(first, { type: 'PRACTICE_READY', payload: { ready: true } });
    await vi.waitFor(() => expect(first.state.phase).toBe('GAME_LOADING'), { timeout: 30_000 });
    await f.send(first, { type: 'LOAD_READY', payload: loadPayload(views) });
    await vi.waitFor(() => expect(first.state.phase).toBe('PLAYING'), { timeout: 30_000 });
    const matchId = first.state.matchId;
    await first.leave(false);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const again = await rejoin(f, session);
    const back: PrivateView[] = [];
    again.onMessage('private-view', (value: PrivateView) => back.push(value));
    // The same match, still running: a refresh is not a connection loss that voids the round.
    await vi.waitFor(() => expect(again.state.phase).toBe('PLAYING'));
    expect(again.state.matchId).toBe(matchId);
    expect(again.state.abortReason ?? null).toBeNull();
    // The operator plays on: the command is judged and the next view shows them still in it.
    expect((await f.send(again, { type: 'TURN', payload: { direction: 'left' } })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(back.at(-1)?.self?.status).toBe('ACTIVE'));
  } finally {
    await f.close();
  }
}, 90_000);

it('closes an abandoned demo room after the rejoin grace and frees its slot', async () => {
  const clock = { offsetMs: 0 };
  const f = await fixture(true, false, clock);
  try {
    const session = demoRoomResponseSchema.parse(await (await f.open({ role: 'runner' })).json());
    const first = await f.connect(session);
    await vi.waitFor(() => expect(first.state.phase).toBe('DEVICE_CHECK'));
    await first.leave(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(f.application.slots!.totalOccupied()).toBe(1);

    clock.offsetMs = 121_000;
    await vi.waitFor(() => expect(f.application.slots!.totalOccupied()).toBe(0), {
      timeout: 5000,
    });
    await expect(rejoin(f, session)).rejects.toThrow(/REJOIN_REFUSED/);
  } finally {
    await f.close();
  }
}, 60_000);

// S15P21C204-312. A lock in a one-seat demo room would refuse the operator's own rejoin (D6).
it('refuses to lock or kick in a demo room, so a refresh can still come back', async () => {
  const f = await fixture();
  try {
    const session = demoRoomResponseSchema.parse(await (await f.open({ role: 'runner' })).json());
    const first = await f.connect(session);
    await vi.waitFor(() => expect(first.state.phase).toBe('DEVICE_CHECK'));
    // The receipt only says the command was queued; the room judges it on the next tick.
    await f.send(first, { type: 'ROOM_LOCK', payload: { locked: true } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await first.leave(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rejoin(f, session);
  } finally {
    await f.close();
  }
}, 60_000);

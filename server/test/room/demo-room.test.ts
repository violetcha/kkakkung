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

async function fixture(demoRooms = true, strictProduct = false) {
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

    // Practice: puppets report at once, so the operator's own report moves the room on.
    await vi.waitFor(() => expect(room.state.phase).toBe('TEAM_PRACTICE'), { timeout: 15_000 });
    expect((await f.send(room, { type: 'PRACTICE_READY', payload: { ready: true } })).status).toBe(
      'accepted',
    );

    // A real match: A's map selection, the 3:3 assignment and the operator's own exit.
    await vi.waitFor(() => expect(room.state.phase).toBe('GAME_LOADING'), { timeout: 30_000 });
    expect((await f.send(room, { type: 'LOAD_READY', payload: loadPayload(views) })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(room.state.phase).toBe('PLAYING'), { timeout: 30_000 });
    const self = views.at(-1)?.self;
    expect(self?.status === 'ACTIVE' && self.role).toBe('runner');
    // A real game instance with the round armed, not a practice instance.
    expect(views.at(-1)?.gameScope.kind).toBe('game');
    expect(room.state.deadlineTick).toBeGreaterThan(room.state.startTick ?? 0);
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
    // startPractice and startCountdown answer to the same demo gate.
    expect((await f.send(room, { type: 'READY', payload: { ready: true } })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(room.state.phase).toBe('TEAM_PRACTICE'), { timeout: 5000 });
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

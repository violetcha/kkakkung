/**
 * S15P21C204-259. Scenarios on the real composition: the demo room, A's `matchCore` and the real
 * command queue. A scenario only enqueues puppet commands, so a restraint, a capture or an escape
 * here is the rules' own verdict. Media is disabled: this is not Cloud or device evidence.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  DEMO_ROOM_ROUTE,
  PRODUCT_CLIENT_MESSAGES,
  demoRoomResponseSchema,
  demoStateSchema,
  type CommandEnvelope,
  type CommandReceipt,
  type GameHeartbeat,
  type DemoRoomResponse,
  type DemoScenarioId,
  type DemoStateMessage,
} from '@kkakkung/protocol/game-messages';
import type { PrivateView, PublicMatchState, Role } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import type { MatchState } from '@kkakkung/game-core/match';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';
import { loadProductProfile } from '../../src/game/ProductProfileLoader.js';
import { createTestOperatorAuth, TEST_OPS_TOKEN } from './test-harness.js';

const configuration = () => ({
  ...parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SERVER_PROFILE: 'product',
    SERVICE_AUDIENCE: 'public',
    TRUST_PROXY_HOPS: '1',
    MEDIA_MODE: 'disabled',
    OPS_TOKEN: TEST_OPS_TOKEN,
    DEMO_ROOMS: '1',
    INVITE_MAX_TTL_MS: '600000',
    SESSION_ATTEMPT_WINDOW_MS: '60000',
    SESSION_ATTEMPTS_PER_INVITE: '20',
    SESSION_ATTEMPTS_PER_IP: '100',
    ROOM_IDLE_TTL_MS: '600000',
  }),
  port: 0,
});

/** Opens a demo room, walks it to PLAYING and returns handles for driving scenarios. */
async function playing(role: Role) {
  const config = configuration();
  const real = await loadProductProfile(config);
  const application = createApplication<MatchState>(config, {
    ...real,
    strictProduct: false,
    developmentAdmission: () => 'OPEN',
    createOperatorAuth: createTestOperatorAuth,
    publicWindow: { mode: 'continuous' },
    serverEpoch: 'epoch-demo-scenarios',
    maxRooms: 2,
  });
  const port = await application.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  const created = await fetch(endpoint + DEMO_ROOM_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_OPS_TOKEN}` },
    body: JSON.stringify({ role }),
  });
  const session: DemoRoomResponse = demoRoomResponseSchema.parse(await created.json());
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
  // The product runtime answers heartbeats; a test client must do the same or the server drops
  // it after six seconds and the match aborts with GAME_CONNECTION_LOST.
  room.onMessage('game-heartbeat', (value: GameHeartbeat) =>
    room.send('game-heartbeat-ack', {
      serverEpoch: value.serverEpoch,
      matchId: value.matchId,
      heartbeatSeq: value.heartbeatSeq,
    }),
  );
  const views: PrivateView[] = [];
  const states: DemoStateMessage[] = [];
  room.onMessage('private-view', (value: PrivateView) => views.push(value));
  room.onMessage('demo-state', (value: DemoStateMessage) =>
    states.push(demoStateSchema.parse(value)),
  );
  await vi.waitFor(() => expect(room.state.matchId).toBeTruthy());
  let sequence = 0;
  const send = async (input: Pick<CommandEnvelope, 'type' | 'payload'>) => {
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
  await vi.waitFor(() => expect(room.state.phase).toBe('DEVICE_CHECK'));
  await send({ type: 'READY', payload: { ready: true } });
  await vi.waitFor(() => expect(room.state.phase).toBe('TEAM_PRACTICE'), { timeout: 10_000 });
  await send({ type: 'PRACTICE_READY', payload: { ready: true } });
  await vi.waitFor(() => expect(room.state.phase).toBe('GAME_LOADING'), { timeout: 15_000 });
  const loading = views.at(-1)?.self;
  const barrier = loading?.status === 'ACTIVE' ? loading.loading : null;
  if (!barrier) throw new Error('LOADING_VIEW_MISSING');
  await send({
    type: 'LOAD_READY',
    payload: {
      loadId: barrier.loadId,
      mediaInstanceId: barrier.mediaInstanceId,
      receiverGeneration: barrier.receiverGeneration,
    },
  });
  await vi.waitFor(() => expect(room.state.phase).toBe('PLAYING'), { timeout: 15_000 });
  return {
    application,
    room,
    views,
    states,
    send,
    scenario: (scenario: DemoScenarioId) =>
      room.send(PRODUCT_CLIENT_MESSAGES.demoScenario, { matchId: room.state.matchId, scenario }),
    self: () => {
      const value = views.at(-1)?.self;
      return value?.status === 'ACTIVE' ? value : null;
    },
    close: async () => {
      if (room.connection.isOpen) await room.leave();
      await application.close();
    },
  };
}

it('offers the scenario list to the operator and refuses an unknown request', async () => {
  const demo = await playing('runner');
  try {
    await vi.waitFor(() => expect(demo.states.at(-1)).toBeDefined());
    expect(demo.states.at(-1)?.available).toContain('trap');
    expect(demo.states.at(-1)?.available).toContain('capture');
    expect(demo.states.at(-1)?.available).toContain('exchange');
    // The list follows the operator's role: a runner cannot be shown a tagger's trace view.
    expect(demo.states.at(-1)?.available).not.toContain('exchange-trace');
    expect(demo.states.at(-1)?.running).toBeNull();
    // A malformed request changes nothing: the room keeps waiting for a real scenario id.
    demo.room.send(PRODUCT_CLIENT_MESSAGES.demoScenario, { matchId: demo.room.state.matchId });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(demo.states.at(-1)?.running).toBeNull();
  } finally {
    await demo.close();
  }
}, 60_000);

it('aborts on a puppet connection loss and refills the room for the rematch', async () => {
  const demo = await playing('runner');
  try {
    demo.scenario('abort-connection-lost');
    // The drop is one control into the rules: an ACTIVE participant vanishing voids the match.
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('ABORTED'), { timeout: 5000 });
    expect(demo.room.state.abortReason).toBe('GAME_CONNECTION_LOST');
    await vi.waitFor(() => expect(demo.states.at(-1)?.running).toBeNull());
    expect(demo.states.at(-1)?.failure).toBeNull();

    // The operator alone asks for a rematch; the puppets are back and ready without a client.
    expect((await demo.send({ type: 'REMATCH', payload: { mode: 'same' } })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('DEVICE_CHECK'), { timeout: 5000 });
    await demo.send({ type: 'READY', payload: { ready: true } });
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('TEAM_PRACTICE'), {
      timeout: 10_000,
    });
    // The operator keeps the role the room was opened with.
    await vi.waitFor(() => expect(demo.self()?.role).toBe('runner'));
  } finally {
    await demo.close();
  }
}, 60_000);

/**
 * These three run a real match in real time: a puppet walks the maze for tens of seconds while a
 * 20Hz room ticks. Running them beside the rest of the suite starves both, so they are opt-in:
 *   KKAKKUNG_DEMO_SCENARIOS=1 pnpm exec vitest run server/test/room/demo-scenarios.test.ts
 */
describe.skipIf(!process.env.KKAKKUNG_DEMO_SCENARIOS)('demo scenarios in real time', () => {
  it('lets a puppet tagger capture the operator by the ordinary rule', async () => {
    const demo = await playing('runner');
    try {
      demo.scenario('capture');
      // The capture is A's verdict on a completed move into the operator's cell.
      await vi.waitFor(() => expect(demo.room.state.counts.captured).toBe(1), { timeout: 55_000 });
      await vi.waitFor(() => expect(demo.self()).toBeNull());
      expect(demo.room.state.phase).toBe('PLAYING');
    } finally {
      await demo.close();
    }
  }, 90_000);

  it('restrains the operator with a puppet-installed trap', async () => {
    const demo = await playing('runner');
    try {
      demo.scenario('trap');
      // Wait for the device to be armed and the installer to have stepped off it: walking into
      // a tagger would be a capture, and an ended operator has no restraint to show.
      await vi.waitFor(() => expect(demo.states.at(-1)?.step).toBe('step-back'), {
        timeout: 55_000,
      });
      await vi.waitFor(() => expect(demo.states.at(-1)?.running).toBeNull(), { timeout: 20_000 });
      expect(demo.states.at(-1)?.failure).toBeNull();
      await vi.waitFor(
        async () => {
          await demo.send({ type: 'MOVE_INTENT', payload: { direction: 'forward' } });
          await new Promise((resolve) => setTimeout(resolve, 600));
          expect(typeof demo.self()?.restraintUntilTick).toBe('number');
        },
        { timeout: 30_000, interval: 100 },
      );
      expect(demo.room.state.counts.captured).toBe(0);
    } finally {
      await demo.close();
    }
  }, 120_000);

  it('ends the match with a real result when two puppet runners escape', async () => {
    const demo = await playing('tagger');
    try {
      demo.scenario('result-runner-win');
      await vi.waitFor(() => expect(demo.room.state.counts.escaped).toBe(2), { timeout: 110_000 });
      await vi.waitFor(() => expect(demo.room.state.phase).toBe('RESULT'), { timeout: 10_000 });
      expect(demo.room.state.result?.winner).toBe('runners');
    } finally {
      await demo.close();
    }
  }, 180_000);
});

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

const configuration = (mapTemplate = process.env.KKAKKUNG_DEMO_MAP) => ({
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
    // S15P21C204-267. KKAKKUNG_DEMO_MAP=maze-v1 runs the same scenarios on the corridor maze.
    ...(mapTemplate ? { PRODUCT_MAP_TEMPLATE: mapTemplate } : {}),
  }),
  port: 0,
});

/** Opens a demo room, walks it to PLAYING and returns handles for driving scenarios. */
async function playing(
  role: Role,
  /** null chooses nothing, even when KKAKKUNG_DEMO_MAP_SIZE is set. */
  mapSize?: 'small' | 'medium' | 'large' | null,
  /** Receives each template the match preparation validates, to see which map was played. */
  prepared?: (templateId: string) => void,
  mapTemplate?: string,
) {
  const config = configuration(mapTemplate);
  const real = await loadProductProfile(config);
  const layouts = real.layouts;
  const application = createApplication<MatchState>(config, {
    ...real,
    ...(prepared && layouts
      ? {
          layouts: {
            ...layouts,
            maps: {
              ...layouts.maps,
              validateTemplate: (raw, source) => {
                const result = layouts.maps.validateTemplate(raw, source);
                if (result.status === 'valid') prepared(result.template.templateId);
                return result;
              },
            },
          },
        }
      : {}),
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
  // S15P21C204-321 크기별 미로. KKAKKUNG_DEMO_MAP_SIZE=small|medium 으로 같은 대본을 돌린다.
  // 데모 방은 로비를 곧바로 지나므로 준비 단계에서 고른다.
  const size = mapSize === undefined ? process.env.KKAKKUNG_DEMO_MAP_SIZE : mapSize;
  if (size === 'small' || size === 'medium' || size === 'large')
    expect((await send({ type: 'ROOM_MAP_SIZE', payload: { size } })).status).toBe('accepted');
  await send({ type: 'READY', payload: { ready: true } });
  // S15P21C204-295. 방장이 시작하고 팀 연습을 거친다. 인형 몫의 연습 보고는 서버가 대신 적는다.
  await send({ type: 'ROOM_START', payload: {} });
  await vi.waitFor(() => expect(room.state.phase).toBe('TEAM_PRACTICE'), { timeout: 15_000 });
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
  // 고른 크기가 실제로 쓰였는지: 보이는 칸이 그 격자 안에 있어야 한다.
  const grid = { small: 15, medium: 23, large: 31 }[size as 'small' | 'medium' | 'large'];
  if (grid !== undefined) {
    await vi.waitFor(() => expect(views.at(-1)?.visibleCells.length).toBeGreaterThan(0));
    for (const cell of views.at(-1)!.visibleCells)
      expect(Math.max(cell.x, cell.y)).toBeLessThan(grid);
  }
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
    // Before the match the whole list is offered and only a PLAYING tick narrows it to the
    // operator's role, so waiting for "some state arrived" can still read the opening list.
    // The list follows the operator's role: a runner cannot be shown a tagger's trace view.
    await vi.waitFor(
      () =>
        expect(demo.states.at(-1)?.available.map((item) => item.id)).not.toContain(
          'exchange-trace',
        ),
      {
        timeout: 5000,
      },
    );
    expect(demo.states.at(-1)?.available.map((item) => item.id)).toContain('trap');
    expect(demo.states.at(-1)?.available.map((item) => item.id)).toContain('capture');
    expect(demo.states.at(-1)?.available.map((item) => item.id)).toContain('exchange');
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
    expect(demo.states.at(-1)?.failureCode).toBeNull();

    // The operator alone asks for a rematch; the puppets are back and ready without a client.
    expect(
      (await demo.send({ type: 'REMATCH', payload: { mode: 'same', role: 'tagger' } })).status,
    ).toBe('accepted');
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('DEVICE_CHECK'), { timeout: 5000 });
    await demo.send({ type: 'READY', payload: { ready: true } });
    await demo.send({ type: 'ROOM_START', payload: {} });
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('TEAM_PRACTICE'), {
      timeout: 10_000,
    });
    await demo.send({ type: 'PRACTICE_READY', payload: { ready: true } });
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('GAME_LOADING'), {
      timeout: 10_000,
    });
    // The operator can choose the role for the next demo round.
    await vi.waitFor(() => expect(demo.self()?.role).toBe('tagger'));
  } finally {
    await demo.close();
  }
}, 60_000);

// S15P21C204-318. The demo plans roles around the operator, so "swap" used to keep the same role.
it('swaps the operator to the other role when the rematch asks to swap', async () => {
  const demo = await playing('runner');
  try {
    demo.room.send(PRODUCT_CLIENT_MESSAGES.demoControl, {
      matchId: demo.room.state.matchId,
      action: 'abort-round',
    });
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('ABORTED'), { timeout: 5000 });
    expect((await demo.send({ type: 'REMATCH', payload: { mode: 'swap' } })).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('DEVICE_CHECK'), { timeout: 5000 });
    await demo.send({ type: 'READY', payload: { ready: true } });
    await demo.send({ type: 'ROOM_START', payload: {} });
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('TEAM_PRACTICE'), {
      timeout: 10_000,
    });
    await demo.send({ type: 'PRACTICE_READY', payload: { ready: true } });
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('GAME_LOADING'), {
      timeout: 10_000,
    });
    await vi.waitFor(() => expect(demo.self()?.role).toBe('tagger'));
  } finally {
    await demo.close();
  }
}, 60_000);

it('lets the operator abort a demo round through the control channel', async () => {
  const demo = await playing('runner');
  try {
    demo.room.send(PRODUCT_CLIENT_MESSAGES.demoControl, {
      matchId: demo.room.state.matchId,
      action: 'abort-round',
    });
    await vi.waitFor(() => expect(demo.room.state.phase).toBe('ABORTED'), { timeout: 5000 });
    expect(demo.room.state.abortReason ?? null).toBeNull();
  } finally {
    await demo.close();
  }
}, 60_000);

// S15P21C204-321. 조립(bootstrap)이 크기별 맵을 방에 넘기지 않아 어떤 방이든 고른 크기와 상관없이
// 기본 31칸 맵으로 경기했다. 일반 방과 같은 조립을 쓰므로 여기서 함께 고정한다. 데모 방은 로비를
// 곧바로 지나므로 준비 단계에서 고른다(313).
it('plays the map size chosen in preparation', async () => {
  for (const [size, templateId] of [
    ['small', 'maze-s-v1'],
    ['medium', 'maze-m-v1'],
  ] as const) {
    const templates: string[] = [];
    const demo = await playing('runner', size, (id) => templates.push(id));
    try {
      // Practice validates its own template; the match's is the last one before PLAYING.
      expect(templates.at(-1), size).toBe(templateId);
    } finally {
      await demo.close();
    }
  }
  // 고르지 않은 방은 PRODUCT_MAP_TEMPLATE 을 따른다. 크기 기본값 'large' 로 찾으면 이것이 무시된다.
  const templates: string[] = [];
  const demo = await playing('runner', null, (id) => templates.push(id), 'master-v1');
  try {
    expect(templates.at(-1)).toBe('master-v1');
  } finally {
    await demo.close();
  }
}, 120_000);

// S15P21C204-317. The room placed puppets only, so this scenario failed on every run. Placement
// takes no walking, so it stays in the default suite.
it('places the operator at their own exit, facing the door', async () => {
  const demo = await playing('runner');
  try {
    demo.scenario('place-me-at-exit');
    await vi.waitFor(
      () => {
        const target = demo.states.at(-1)?.operatorExit;
        expect(target).toBeTruthy();
        expect(demo.self()?.cell).toEqual(target);
      },
      { timeout: 10_000 },
    );
    expect(demo.states.at(-1)?.failureCode).toBeNull();
    const me = demo.self()!;
    const exit = demo.views.at(-1)?.knownActiveExits.find((known) => known.ownerId === me.playerId);
    expect(exit && me.dir === (exit.wall.side + 2) % 4).toBe(true);
  } finally {
    await demo.close();
  }
}, 60_000);

// "내 출구로 가면 탈출이 안 된다"(현장 보고). 배치 뒤 도전을 열고 키 입력으로 끝내 실제 탈출까지 간다.
it('lets the placed operator start their exit challenge and escape', async () => {
  const demo = await playing('runner');
  try {
    demo.scenario('place-me-at-exit');
    await vi.waitFor(
      () => {
        const target = demo.states.at(-1)?.operatorExit;
        expect(target).toBeTruthy();
        expect(demo.self()?.cell).toEqual(target);
      },
      { timeout: 10_000 },
    );
    const me = demo.self()!;
    const exit = await vi.waitFor(() => {
      const found = demo.views
        .at(-1)
        ?.knownActiveExits.find((known) => known.ownerId === me.playerId);
      expect(found).toBeDefined();
      return found!;
    });
    expect((await demo.send({ type: 'EXIT_START', payload: { exitId: exit.exitId } })).status).toBe(
      'accepted',
    );
    const challenge = await vi.waitFor(() => {
      const value = demo.self()?.challenge;
      expect(value).toBeTruthy();
      return value!;
    });
    // 규칙이 정한 최소 시간이 지나야 완료 보고가 받아들여진다.
    await vi.waitFor(
      () => expect(demo.room.state.serverTick).toBeGreaterThanOrEqual(challenge.minSuccessTick),
      { timeout: 10_000 },
    );
    await demo.send({
      type: 'EXIT_PROGRESS',
      payload: { challengeId: challenge.challengeId, method: 'keys', completed: true },
    });
    await vi.waitFor(
      () => expect(demo.room.state.counts.escaped, JSON.stringify(demo.states.at(-1))).toBe(1),
      { timeout: 10_000 },
    );
    expect(demo.self()).toBeNull();
  } finally {
    await demo.close();
  }
}, 60_000);

/**
 * These run a real match in real time: a puppet walks the maze for tens of seconds while a
 * 20Hz room ticks. Running them beside the rest of the suite starves both, so they are opt-in:
 *   KKAKKUNG_DEMO_SCENARIOS=1 pnpm exec vitest run server/test/room/demo-scenarios.test.ts
 */
describe.skipIf(!process.env.KKAKKUNG_DEMO_SCENARIOS)('demo scenarios in real time', () => {
  it('lets a puppet tagger capture the operator by the ordinary rule', async () => {
    const demo = await playing('runner');
    try {
      demo.scenario('capture');
      // The capture is A's verdict on the puppet's armed grab with the operator in front (319).
      await vi.waitFor(
        () => expect(demo.room.state.counts.captured, JSON.stringify(demo.states.at(-1))).toBe(1),
        { timeout: 80_000 },
      );
      await vi.waitFor(() => expect(demo.self()).toBeNull());
      expect(demo.room.state.phase).toBe('PLAYING');
      // S15P21C204-269. The ended operator now watches a surviving puppet runner and can switch.
      await vi.waitFor(() => expect(demo.views.at(-1)?.spectating?.targetId).toBeTruthy());
      const spectating = demo.views.at(-1)!.spectating!;
      expect(spectating.candidates).toHaveLength(2);
      expect(spectating.candidates).toContain(spectating.targetId);
      const other = spectating.candidates.find((id) => id !== spectating.targetId)!;
      expect(
        (await demo.send({ type: 'SPECTATE', payload: { targetPlayerId: other } })).status,
      ).toBe('accepted');
      await vi.waitFor(() => expect(demo.views.at(-1)?.spectating?.targetId).toBe(other));
      // The spectator's body is the target's: exits, sight and memory travel with the target.
      expect(demo.views.at(-1)!.visibleCells.length).toBeGreaterThan(0);
    } finally {
      await demo.close();
    }
  }, 130_000);

  // S15P21C204-317. Each capture scenario on the real core. Before the grab step these walked
  // onto their prey, which is no capture since 319, and sat on the step budget for two minutes.
  it('moves the public tally by one puppet capture without ending the round', async () => {
    const demo = await playing('runner');
    try {
      demo.scenario('capture-one');
      await vi.waitFor(
        () => expect(demo.room.state.counts.captured, JSON.stringify(demo.states.at(-1))).toBe(1),
        { timeout: 80_000 },
      );
      await vi.waitFor(() => expect(demo.states.at(-1)?.running).toBeNull());
      expect(demo.states.at(-1)?.failureCode).toBeNull();
      expect(demo.room.state.phase).toBe('PLAYING');
      expect(demo.self()).not.toBeNull();
    } finally {
      await demo.close();
    }
  }, 130_000);

  it('captures the operator, then the runner being watched, which ends the round', async () => {
    const demo = await playing('runner');
    try {
      demo.scenario('spectate-then-capture');
      await vi.waitFor(() => expect(demo.views.at(-1)?.spectating?.targetId).toBeTruthy(), {
        timeout: 80_000,
      });
      // The second capture is the taggers' second: the rules end the round with their win.
      await vi.waitFor(
        () => expect(demo.room.state.counts.captured, JSON.stringify(demo.states.at(-1))).toBe(2),
        { timeout: 80_000 },
      );
      await vi.waitFor(() => expect(demo.room.state.phase).toBe('RESULT'), { timeout: 10_000 });
      expect(demo.room.state.result?.winner).toBe('taggers');
    } finally {
      await demo.close();
    }
  }, 190_000);

  it('captures the operator in the middle of their own exit challenge', async () => {
    const demo = await playing('runner');
    try {
      demo.scenario('place-me-at-exit');
      // Read the arrival, not `running: null`: the state from before the request says that too.
      // Waiting on it alone once passed a placement the room had refused (S15P21C204-317).
      await vi.waitFor(
        () => {
          const target = demo.states.at(-1)?.operatorExit;
          expect(target).toBeTruthy();
          expect(demo.self()?.cell).toEqual(target);
        },
        { timeout: 20_000 },
      );
      expect(demo.states.at(-1)?.failureCode).toBeNull();
      const me = demo.self()!;
      // Standing at the approach facing the door, the next view shows the operator their exit.
      const exit = await vi.waitFor(() => {
        const found = demo.views
          .at(-1)
          ?.knownActiveExits.find((known) => known.ownerId === me.playerId);
        expect(found).toBeDefined();
        return found!;
      });

      demo.scenario('caught-in-my-challenge');
      await vi.waitFor(() => expect(demo.states.at(-1)?.step).toBe('operator-starts-challenge'), {
        timeout: 80_000,
      });
      expect(
        (await demo.send({ type: 'EXIT_START', payload: { exitId: exit.exitId } })).status,
      ).toBe('accepted');
      await vi.waitFor(
        () => expect(demo.room.state.counts.captured, JSON.stringify(demo.states.at(-1))).toBe(1),
        { timeout: 30_000 },
      );
      expect(demo.self()).toBeNull();
      expect(demo.room.state.counts.escaped).toBe(0);
    } finally {
      await demo.close();
    }
  }, 160_000);

  it('restrains the operator with a puppet-installed trap', async () => {
    const demo = await playing('runner');
    try {
      demo.scenario('trap');
      // Wait for the device to be armed and the installer to have stepped off it: walking into
      // a tagger would be a capture, and an ended operator has no restraint to show.
      await vi.waitFor(() => expect(demo.states.at(-1)?.step).toBe('step-back'), {
        timeout: 80_000,
      });
      await vi.waitFor(() => expect(demo.states.at(-1)?.running).toBeNull(), { timeout: 20_000 });
      expect(demo.states.at(-1)?.failureCode).toBeNull();
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
  }, 160_000);

  it('ends the match with a real result when two puppet runners escape', async () => {
    const demo = await playing('tagger');
    try {
      demo.scenario('result-runner-win');
      await vi.waitFor(
        () => expect(demo.room.state.counts.escaped, JSON.stringify(demo.states.at(-1))).toBe(2),
        { timeout: 150_000 },
      );
      await vi.waitFor(() => expect(demo.room.state.phase).toBe('RESULT'), { timeout: 10_000 });
      expect(demo.room.state.result?.winner).toBe('runners');
    } finally {
      await demo.close();
    }
  }, 220_000);
});

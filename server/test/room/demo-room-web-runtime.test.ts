/**
 * S15P21C204-260. The demo room driven by the real web runtime (`product-runtime` with the
 * synthetic D facade) instead of a raw test client. `demo-room.test.ts` sends LOAD_READY itself,
 * which hides the client's loading gate; here the client must decide on its own that a room
 * without media needs no camera connection or face confirmation. Media is disabled: this is not
 * Cloud or device evidence.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { expect, it } from 'vitest';
import {
  DEMO_ROOM_ROUTE,
  MEDIA_ROUTES,
  demoRoomResponseSchema,
} from '@kkakkung/protocol/game-messages';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import type { MatchState } from '@kkakkung/game-core/match';
import { bindProductRoom } from '../../../apps/web/src/app/product-runtime';
import { createSyntheticInteractionFactory } from '../../../apps/web/src/app/product-integration-fixture';
import { productRoomPort } from '../../../apps/web/src/features/room/product-session';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';
import { loadProductProfile } from '../../src/game/ProductProfileLoader.js';
import { createTestOperatorAuth, TEST_OPS_TOKEN } from './test-harness.js';

it('takes the operator to PLAYING through the web runtime without any media grant', async () => {
  const config = {
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
  };
  const real = await loadProductProfile(config);
  const application = createApplication<MatchState>(config, {
    ...real,
    strictProduct: false,
    developmentAdmission: () => 'OPEN',
    createOperatorAuth: createTestOperatorAuth,
    publicWindow: { mode: 'continuous' },
    serverEpoch: 'epoch-demo-web-runtime',
    maxRooms: 2,
  });
  const port = await application.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  const created = await fetch(endpoint + DEMO_ROOM_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_OPS_TOKEN}` },
    body: JSON.stringify({ role: 'runner' }),
  });
  expect(created.status).toBe(201);
  const session = demoRoomResponseSchema.parse(await created.json());
  const room = await new Client(endpoint).joinOrCreate<unknown, PublicMatchState>(
    PRODUCT_ROOM_NAME,
    {
      token: session.sessionToken,
      roomCode: session.roomCode,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    },
  );
  room.reconnection.enabled = false;
  const mediaRequests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === MEDIA_ROUTES.grants || url === MEDIA_ROUTES.report) mediaRequests.push(url);
    return fetch(url.startsWith('/') ? endpoint + url : input, init);
  };
  const phases: string[] = [];
  const errors = new Set<string>();
  const runtime = bindProductRoom(productRoomPort(room), session, {
    now: () => performance.now(),
    uuid: randomUUID,
    changed: (snapshot) => {
      const phase = snapshot.round?.phase;
      if (phase && phases.at(-1) !== phase) phases.push(phase);
      if (snapshot.error) errors.add(snapshot.error);
    },
    fetcher,
    interactionFactory: createSyntheticInteractionFactory({
      control: () => {},
      publish: async (grant) => `FACE_${grant.mediaIdentity}`,
    }),
  });
  room.onMessage('*', () => {});
  const timer = setInterval(() => runtime.poll(), 20);
  const phase = () => runtime.getSnapshot().round?.phase;
  try {
    await expect.poll(phase, { timeout: 5000 }).toBe('DEVICE_CHECK');
    // The scenario list arrives before the match, so the client knows the room kind in time.
    await expect.poll(() => runtime.getSnapshot().demo?.available.length ?? 0).toBeGreaterThan(0);
    await runtime.startDevices(false);
    runtime.ready(true);
    await expect.poll(phase, { timeout: 10_000 }).toBe('TEAM_PRACTICE');
    // 연습 뷰가 도착해 practicePresenter 가 준비를 허용할 때까지 보고를 되풀이한다(사람은 버튼을 누른다).
    await expect
      .poll(
        () => {
          runtime.send({ type: 'PRACTICE_READY', payload: { ready: true } });
          return runtime.getSnapshot().practiceReady;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    // Before this fix the client waited for '카메라 연결 · 내 얼굴 게시 확인' here until the 30 s
    // LOADING_TIMEOUT sent everyone back to DEVICE_CHECK.
    await expect.poll(phase, { timeout: 20_000 }).toBe('PLAYING');
    expect(phases).toEqual([
      'DEVICE_CHECK',
      'TEAM_PRACTICE',
      'MAP_FINALIZING',
      'GAME_LOADING',
      'COUNTDOWN',
      'PLAYING',
    ]);
    expect(mediaRequests).toEqual([]);
    expect([...errors]).toEqual([]);
    const self = runtime.getSnapshot().view?.self;
    expect(self?.status === 'ACTIVE' && self.role).toBe('runner');
  } finally {
    clearInterval(timer);
    await runtime.leave().catch(() => {});
    await application.close();
  }
}, 60_000);

/**
 * 발표 시연 방 발급. `/showcase` 를 연 팀원 넷이 역할을 골라 한 방에 모이는 경로다.
 * 인증은 호스트 nginx 가 SSO 뒤에 써 주는 X-Demo-Admin 하나뿐이고, 운영 토큰은 받지 않는다.
 */
import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHOWCASE_ROOM_ROUTE, showcaseRoomResponseSchema } from '@kkakkung/protocol/game-messages';
import {
  createShowcaseRoutes,
  createShowcaseUnavailableRoutes,
} from '../../src/session/ShowcaseRoutes.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SHOWCASE_CAPACITY, SlotRegistry } from '../../src/session/SlotRegistry.js';
import { TEST_OPS_TOKEN } from '../room/test-harness.js';

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    endpoint: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
  };
}

describe('showcase room admission', () => {
  let server: Server;
  let endpoint: string;
  const now = 1_000_000;
  const sessions = new ProductSessionStore({ now: () => now });
  const slots = new SlotRegistry({ maxRooms: 2 });
  // S15P21C204-362. 이 묶음은 서버가 열린 상태만 본다. 닫힌 문은 아래 별도 묶음이 본다.
  const ready = true;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createShowcaseRoutes({
        sessions,
        slots,
        trustedProxy: true,
        operatorAllowed: (identity) => identity === 'member',
        monotonicNow: () => now,
        admissionTtlMs: 10 * 60_000,
        ready: () => ready,
      }),
    );
    ({ server, endpoint } = await listen(app));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (body: unknown, headers: Record<string, string> = { 'x-demo-admin': 'member' }) =>
    fetch(endpoint + SHOWCASE_ROOM_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('refuses a browser without the SSO-asserted identity, including one carrying an operations Bearer', async () => {
    expect((await post({ role: 'runner' }, {})).status).toBe(401);
    expect(
      (await post({ role: 'runner' }, { authorization: `Bearer ${TEST_OPS_TOKEN}` })).status,
    ).toBe(401);
    expect(slots.roomCodes().size).toBe(0);
  });

  it('gathers four members into one 2:2 room and turns a third same-role choice away', async () => {
    const first = await post({ role: 'runner', nickname: '연찡' });
    expect(first.status).toBe(201);
    const opened = showcaseRoomResponseSchema.parse(await first.json());
    expect(opened.role).toBe('runner');
    expect(opened.entryFragment).toMatch(/^#showcase=.+&room=[A-Z0-9]{6}&player=.+$/);
    expect(opened.entryFragment).toContain(`&room=${opened.roomCode}&`);
    expect(slots.optionsOf(opened.roomCode)).toEqual({
      capacity: SHOWCASE_CAPACITY,
      kind: 'showcase',
      operatorRole: null,
    });

    // 두 번째 도망자와 술래 둘은 같은 방에 붙는다.
    const others = await Promise.all([
      post({ role: 'runner' }),
      post({ role: 'tagger' }),
      post({ role: 'tagger' }),
    ]);
    for (const response of others) {
      expect(response.status).toBe(201);
      expect(showcaseRoomResponseSchema.parse(await response.json()).roomCode).toBe(
        opened.roomCode,
      );
    }
    expect(slots.occupied(opened.roomCode)).toBe(4);
    // 역할별 두 자리씩, 고른 그대로 기억한다.
    const roles = [...slots.requestedRoles(opened.roomCode).values()];
    expect(roles.filter((role) => role === 'runner')).toHaveLength(2);
    expect(roles.filter((role) => role === 'tagger')).toHaveLength(2);
    // 방이 찼으니 다섯째는 새 방도 얻지 못하고 CAPACITY 로 답한다(시연 방은 한 번에 하나).
    const fifth = await post({ role: 'runner' });
    expect(fifth.status).toBe(503);
    expect(await fifth.json()).toEqual({ error: 'CAPACITY' });
  });

  it('answers ROLE_FULL when the chosen side already has two, without spending a seat', async () => {
    const own = new SlotRegistry({ maxRooms: 1 });
    const store = new ProductSessionStore({ now: () => now });
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createShowcaseRoutes({
        sessions: store,
        slots: own,
        trustedProxy: true,
        operatorAllowed: (identity) => identity === 'member',
        monotonicNow: () => now,
        admissionTtlMs: 10 * 60_000,
        ready: () => ready,
      }),
    );
    const local = await listen(app);
    try {
      const call = (role: string) =>
        fetch(local.endpoint + SHOWCASE_ROOM_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-demo-admin': 'member' },
          body: JSON.stringify({ role }),
        });
      expect((await call('tagger')).status).toBe(201);
      expect((await call('tagger')).status).toBe(201);
      const third = await call('tagger');
      expect(third.status).toBe(409);
      expect(await third.json()).toEqual({ error: 'ROLE_FULL' });
      const [code] = own.roomCodes();
      expect(own.occupied(code!)).toBe(2);
      // 다른 역할은 여전히 들어간다.
      expect((await call('runner')).status).toBe(201);
    } finally {
      await new Promise<void>((resolve) => local.server.close(() => resolve()));
    }
  });

  // S15P21C204-367. 로그인 게이트는 SSAFY 계정 전체를 통과시키므로 운영자 판정은 목록이 한다.
  it('refuses a signed-in account that is not on the operator list', async () => {
    const response = await post({ role: 'runner' }, { 'x-demo-admin': 'student@example.com' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' });
  });

  it('rejects a request that names no role', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ role: 'referee' })).status).toBe(400);
  });
});

describe('showcase rooms disabled', () => {
  it('keeps the same identity check and never opens a room', async () => {
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(createShowcaseUnavailableRoutes(true, (identity) => identity === 'member'));
    const { server, endpoint } = await listen(app);
    try {
      const anonymous = await fetch(endpoint + SHOWCASE_ROOM_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'runner' }),
      });
      expect(anonymous.status).toBe(401);
      const member = await fetch(endpoint + SHOWCASE_ROOM_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-demo-admin': 'member' },
        body: JSON.stringify({ role: 'runner' }),
      });
      expect(member.status).toBe(503);
      expect(await member.json()).toEqual({ error: 'SHOWCASE_UNAVAILABLE' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('ignores the header when the server is not behind the trusted proxy', async () => {
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(createShowcaseUnavailableRoutes(false, () => true));
    const { server, endpoint } = await listen(app);
    try {
      const response = await fetch(endpoint + SHOWCASE_ROOM_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-demo-admin': 'forged' },
        body: JSON.stringify({ role: 'runner' }),
      });
      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('showcase admission gate (S15P21C204-362)', () => {
  it('answers ADMISSION_CLOSED without issuing a session while the server is not ready, then admits again', async () => {
    // 2026-09-23 배포 서버가 LOCKED 인 동안 시연 세션이 발급되어 게임 페이지에서 NOT_READY 로 튕겼다.
    // 일반 세션 발급과 같은 문을 여기서 먼저 지나, 첫 화면이 이유를 보여 준다.
    const own = new SlotRegistry({ maxRooms: 1 });
    const store = new ProductSessionStore({ now: () => 1_000_000 });
    let ready = false;
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createShowcaseRoutes({
        sessions: store,
        slots: own,
        trustedProxy: true,
        operatorAllowed: (identity) => identity === 'member',
        monotonicNow: () => 1_000_000,
        admissionTtlMs: 10 * 60_000,
        ready: () => ready,
      }),
    );
    const local = await listen(app);
    try {
      const call = (headers: Record<string, string> = { 'x-demo-admin': 'member' }) =>
        fetch(local.endpoint + SHOWCASE_ROOM_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ role: 'runner' }),
        });
      // 인증이 문보다 먼저다. 신원 없는 호출은 서버 상태를 알 수 없다.
      expect((await call({})).status).toBe(401);
      const closed = await call();
      expect(closed.status).toBe(503);
      expect(await closed.json()).toEqual({ error: 'ADMISSION_CLOSED' });
      expect(own.roomCodes().size).toBe(0);

      ready = true;
      const opened = await call();
      expect(opened.status).toBe(201);
      const seat = showcaseRoomResponseSchema.parse(await opened.json());
      expect(own.occupied(seat.roomCode)).toBe(1);
    } finally {
      await new Promise<void>((resolve) => local.server.close(() => resolve()));
    }
  });
});

describe('three showcase rooms at once (S15P21C204-361)', () => {
  it('fills the earliest open room first, opens up to three, and answers CAPACITY for a fourth', async () => {
    const own = new SlotRegistry({ maxRooms: 10, maxShowcaseRooms: 3 });
    const store = new ProductSessionStore({ now: () => 1_000_000 });
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createShowcaseRoutes({
        sessions: store,
        slots: own,
        trustedProxy: true,
        operatorAllowed: (identity) => identity === 'member',
        monotonicNow: () => 1_000_000,
        admissionTtlMs: 10 * 60_000,
        ready: () => true,
      }),
    );
    const local = await listen(app);
    try {
      const seat = async (role: 'runner' | 'tagger') => {
        const response = await fetch(local.endpoint + SHOWCASE_ROOM_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-demo-admin': 'member' },
          body: JSON.stringify({ role }),
        });
        return response.status === 201
          ? showcaseRoomResponseSchema.parse(await response.json()).roomCode
          : `${response.status}:${((await response.json()) as { error: string }).error}`;
      };
      const fill = async () => {
        const codes = await Promise.all([
          seat('runner'),
          seat('runner'),
          seat('tagger'),
          seat('tagger'),
        ]);
        expect(new Set(codes).size).toBe(1);
        return codes[0]!;
      };
      // 첫 무리 넷은 한 방. 다섯째는 새 방을 연다(한도 3).
      const first = await fill();
      const second = await seat('runner');
      expect(second).not.toBe(first);
      expect(own.formingShowcaseRooms()).toBe(2);
      // 둘째 방에 빈 자리가 있는 동안은 셋째 방을 열지 않고 거기에 앉힌다.
      expect(await seat('tagger')).toBe(second);
      expect(await seat('runner')).toBe(second);
      expect(await seat('tagger')).toBe(second);
      expect(own.occupied(second)).toBe(4);
      const third = await fill();
      expect(new Set([first, second, third]).size).toBe(3);
      expect(own.formingShowcaseRooms()).toBe(3);
      // 셋이 다 모이는 중이면 열셋째는 기다린다.
      expect(await seat('runner')).toBe('503:CAPACITY');
      // 시연 방 셋은 MAX_ROOMS 예산을 셋 쓴다.
      expect(own.roomCodes().size).toBe(3);
      // 한 방이 시작하면 모이는 중이 둘이 되어 새 방이 열린다.
      own.setPhase(first, 'TEAM_PRACTICE', 1_000_000);
      const fourth = await seat('runner');
      expect(fourth).not.toBe('503:CAPACITY');
      expect(own.roomCodes().size).toBe(4);
    } finally {
      await new Promise<void>((resolve) => local.server.close(() => resolve()));
    }
  });
});

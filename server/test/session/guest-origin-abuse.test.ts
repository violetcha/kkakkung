/**
 * S15P21C204-300. 게스트 공개 입장의 남용 방어와 오류 계약.
 *
 * 실제 HTTP 라우터·좌석 레지스트리·제한기를 조립해 돌린다. Colyseus 방·미디어·Cloud 는 쓰지
 * 않으므로 공개 인수 증거가 아니라 입장 경로의 계약 회귀다.
 *
 * 시험마다 서버와 레지스트리를 새로 만든다. 방 예산은 전역 상태라 공유하면 앞 시험이 남긴
 * 방 때문에 뒤 시험이 포화로 실패한다.
 */
import { createServer, type Server } from 'node:http';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { SESSION_ROUTE, sessionResponseSchema } from '@kkakkung/protocol/game-messages';
import { AdmissionLimiter } from '../../src/session/AdmissionLimiter.js';
import { InviteStore } from '../../src/session/InviteStore.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { createSessionRoutes } from '../../src/session/SessionRoutes.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';

const EPOCH = 1_000_000;

type Harness = Readonly<{
  slots: SlotRegistry;
  invites: InviteStore;
  /** 방을 만든다. `forwardedFor` 는 프록시를 신뢰할 때만 출처가 된다. */
  create(forwardedFor: string, nickname?: string): Promise<Response>;
  /** 초대로 기존 방에 들어간다. */
  join(
    roomCode: string,
    forwardedFor: string,
    options?: { inviteToken?: string; nickname?: string },
  ): Promise<Response>;
}>;

/** 게스트 공개 모드 라우터 하나를 띄우고 넘긴다. 서버는 끝나면 반드시 닫는다. */
async function withHarness<T>(
  options: { maxRooms?: number; maxRoomsPerOwner?: number; trustProxy?: boolean },
  run: (harness: Harness) => Promise<T>,
): Promise<T> {
  let monotonic = 0;
  const slots = new SlotRegistry({
    maxRooms: options.maxRooms ?? 4,
    maxRoomsPerOwner: options.maxRoomsPerOwner ?? 2,
  });
  const invites = new InviteStore({
    now: () => EPOCH,
    maxTtlMs: 60_000,
    publicWindow: { mode: 'continuous' },
    knownRoomCodes: () => slots.roomCodes(),
    operationsReady: () => true,
  });
  const app = express();
  app.use(express.json({ limit: '2kb' }));
  app.use(
    createSessionRoutes({
      invites,
      sessions: new ProductSessionStore({ now: () => EPOCH }),
      slots,
      // 출처별 방 상한만 보기 위해 속도 예산은 넉넉히 둔다.
      limiter: new AdmissionLimiter({ windowMs: 60_000, perInvite: 500, perIp: 500 }),
      admission: () => 'OPEN',
      monotonicNow: () => (monotonic += 1),
      trustProxy: options.trustProxy ?? true,
      admissionMode: 'guest',
    }),
  );
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const post = (body: unknown, forwardedFor: string) =>
    fetch(endpoint + SESSION_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
      body: JSON.stringify(body),
    });
  try {
    return await run({
      slots,
      invites,
      create: (forwardedFor, nickname = 'guest') =>
        post({ nickname, createRoom: true }, forwardedFor),
      join: (roomCode, forwardedFor, extra = {}) =>
        post(
          {
            nickname: extra.nickname ?? 'friend',
            createRoom: false,
            roomCode,
            ...(extra.inviteToken === undefined ? {} : { inviteToken: extra.inviteToken }),
          },
          forwardedFor,
        ),
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

/** 방이 열렸는지 확인하고 방 코드를 돌려준다. 응답이 계약을 지키는지도 함께 본다. */
async function admittedRoom(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return sessionResponseSchema.parse(await response.json()).roomCode;
}

describe('게스트 출처별 방 상한', () => {
  it('IPv6 임시 주소를 돌려도 같은 /64 는 한 출처로 센다', async () => {
    // 임시 주소(privacy extensions)는 같은 회선에서 수시로 바뀐다. 주소를 그대로 키로 쓰면
    // 상한이 사실상 없어진다.
    await withHarness({}, async ({ create }) => {
      expect((await create('2001:db8:1:2:aaaa::1')).status).toBe(201);
      expect((await create('2001:db8:1:2:bbbb::2')).status).toBe(201);
      const third = await create('2001:db8:1:2:cccc::3');
      expect(third.status).toBe(429);
      expect(await third.json()).toEqual({ error: 'TOO_MANY_ROOMS' });
    });
  });

  it('다른 /64 는 자기 상한을 따로 갖는다', async () => {
    await withHarness({}, async ({ create }) => {
      expect((await create('2001:db8:1:2::1')).status).toBe(201);
      expect((await create('2001:db8:1:2::2')).status).toBe(201);
      expect((await create('2001:db8:9:9::1')).status).toBe(201);
    });
  });

  it('IPv4-mapped IPv6 와 IPv4 를 같은 출처로 센다', async () => {
    // 같은 사람이 스택에 따라 두 표기로 도착한다. 나뉘면 상한이 두 배가 된다.
    await withHarness({}, async ({ create }) => {
      expect((await create('198.51.100.4')).status).toBe(201);
      expect((await create('::ffff:198.51.100.4')).status).toBe(201);
      expect((await create('198.51.100.4')).status).toBe(429);
    });
  });

  it('방이 닫히면 그 출처가 다시 열 수 있다', async () => {
    // 상한은 "지금 열어 둔 방"이지 누적이 아니다. 만료·정리 뒤 정상 이용이 막히면 안 된다.
    await withHarness({}, async ({ create, slots }) => {
      const first = await admittedRoom(await create('203.0.113.9'));
      expect((await create('203.0.113.9')).status).toBe(201);
      expect((await create('203.0.113.9')).status).toBe(429);
      // 좌석이 반환된 뒤에야 방이 닫힌다. 예약 정리가 하는 일과 같다.
      for (const seat of slots.members(first)) slots.release(first, seat.playerId);
      expect(slots.closeRoom(first)).toBe(true);
      expect((await create('203.0.113.9')).status).toBe(201);
    });
  });

  it('같은 망 6인이 방 하나에 초대로 모이는 흐름은 막지 않는다', async () => {
    // 공유 NAT 의 대가는 "한 회선이 동시에 여는 방 수"에만 붙는다. 정상 팀은 방을 하나만
    // 만들고 나머지는 초대로 들어오므로 상한과 무관해야 한다.
    await withHarness({}, async ({ create, join, invites, slots }) => {
      const nat = '203.0.113.50';
      const roomCode = await admittedRoom(await create(nat, 'host'));
      const issued = invites.issue({
        scope: { allowCreate: false, roomCodes: [roomCode] },
        expiresAt: EPOCH + 30_000,
      });
      if (issued.status !== 'issued') throw new Error(issued.code);
      for (let i = 0; i < 5; i++) {
        const response = await join(roomCode, nat, {
          inviteToken: issued.invitation.inviteToken,
          nickname: `friend-${i}`,
        });
        expect(response.status).toBe(201);
      }
      expect(slots.occupied(roomCode)).toBe(6);
    });
  });
});

describe('위조한 프록시 헤더', () => {
  it('프록시를 신뢰하지 않으면 붙여 보낸 헤더로 출처를 바꿀 수 없다', async () => {
    // 신뢰 경계 밖에서 온 X-Forwarded-For 를 읽으면 헤더만 바꿔 상한을 무한히 우회한다.
    // 모든 요청이 같은 루프백 소켓에서 오므로 헤더가 달라도 한 출처여야 한다.
    await withHarness({ maxRoomsPerOwner: 1, trustProxy: false }, async ({ create }) => {
      expect((await create('198.51.100.1')).status).toBe(201);
      const refused = await create('198.51.100.2');
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({ error: 'TOO_MANY_ROOMS' });
    });
  });

  it('프록시를 신뢰하면 헤더 앞 항목이 출처가 된다', async () => {
    // 호스트 nginx 가 이 헤더를 실제 접속자로 덮어쓴 뒤에만 신뢰한다.
    await withHarness({ maxRoomsPerOwner: 1 }, async ({ create }) => {
      expect((await create('198.51.100.1')).status).toBe(201);
      expect((await create('198.51.100.2')).status).toBe(201);
      expect((await create('198.51.100.1')).status).toBe(429);
    });
  });
});

describe('오류 계약', () => {
  it('내 상한과 서비스 포화를 다른 사실로 답한다', async () => {
    // 둘을 합치면 "잠시 뒤 다시"와 "쓰지 않는 방을 닫아라" 중 무엇을 해야 할지 알 수 없다.
    await withHarness({ maxRooms: 2, maxRoomsPerOwner: 1 }, async ({ create }) => {
      expect((await create('203.0.113.1')).status).toBe(201);
      const mine = await create('203.0.113.1');
      expect(mine.status).toBe(429);
      expect(await mine.json()).toEqual({ error: 'TOO_MANY_ROOMS' });

      expect((await create('203.0.113.2')).status).toBe(201);
      const full = await create('203.0.113.3');
      expect(full.status).toBe(503);
      expect(await full.json()).toEqual({ error: 'CAPACITY' });
    });
  });

  it('내부 좌석 코드를 그대로 내보내지 않는다', async () => {
    // ROOM_LIMIT·OWNER_LIMIT·SERVICE_FULL 은 레지스트리 내부 어휘다. 밖으로 나가면 구현이
    // 드러나고 클라이언트가 계약에 없는 값을 보게 된다. ROOM_FULL 은 S15P21C204-365 부터 참가
    // 경로의 공개 코드지만 방 만들기에서는 나올 일이 없어 여기서도 막는다.
    const internal = ['ROOM_LIMIT', 'OWNER_LIMIT', 'SERVICE_FULL', 'ROOM_FULL'];
    await withHarness({ maxRooms: 1, maxRoomsPerOwner: 1 }, async ({ create }) => {
      for (const origin of ['203.0.113.4', '203.0.113.4', '203.0.113.5']) {
        const body = (await (await create(origin)).json()) as { error?: string };
        if (body.error !== undefined) expect(internal).not.toContain(body.error);
      }
    });
  });

  it('토큰 없이는 방 존재 여부를 알려주지 않는다', async () => {
    // 게스트 모드에서 초대 검증이 방 조회보다 먼저다. 순서가 뒤집히면 방 코드를 대입해
    // 어떤 코드가 살아 있는지 훑을 수 있다.
    await withHarness({}, async ({ create, join }) => {
      const live = await admittedRoom(await create('203.0.113.60'));
      const existing = await join(live, '203.0.113.61');
      const missing = await join('ZZZZZZ', '203.0.113.61');
      expect(existing.status).toBe(403);
      expect(missing.status).toBe(403);
      expect(await existing.json()).toEqual(await missing.json());
    });
  });
});

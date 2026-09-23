import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_ROUTE, sessionResponseSchema } from '@kkakkung/protocol/game-messages';
import { AdmissionLimiter } from '../../src/session/AdmissionLimiter.js';
import { InviteStore } from '../../src/session/InviteStore.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import {
  createSessionRoutes,
  generateRoomCode,
  type AdmissionState,
  type SessionRouteDeps,
} from '../../src/session/SessionRoutes.js';
import { createReservationCleanup } from '../../src/session/ReservationCleanup.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';

describe('POST /api/sessions', () => {
  let server: Server;
  let endpoint: string;
  let admission: AdmissionState = 'OPEN';
  let monotonic = 0;
  const epoch = 1_000_000;
  const slots = new SlotRegistry({ maxRooms: 2 });
  const sessions = new ProductSessionStore({ now: () => epoch });
  const invites = new InviteStore({
    now: () => epoch,
    maxTtlMs: 60_000,
    publicWindow: { opensAtEpochMs: 0, closesAtEpochMs: 2_000_000 },
    knownRoomCodes: () => slots.roomCodes(),
    operationsReady: () => true,
  });
  const limiter = new AdmissionLimiter({ windowMs: 60_000, perInvite: 4, perIp: 10 });
  const token = (allowCreate: boolean, roomCodes: string[] = []) => {
    const issued = invites.issue({ scope: { allowCreate, roomCodes }, expiresAt: epoch + 30_000 });
    if (issued.status !== 'issued') throw new Error(issued.code);
    return issued.invitation.inviteToken;
  };

  beforeEach(() => {
    monotonic += 60_000;
  });

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createSessionRoutes({
        invites,
        sessions,
        slots,
        limiter,
        admission: () => admission,
        monotonicNow: () => monotonic,
        trustProxy: false,
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const post = (body: unknown) =>
    fetch(endpoint + SESSION_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('creates a room with a create-scoped invitation and lets the same invitation join it', async () => {
    const invite = token(true);
    const created = await post({ nickname: '하나', inviteToken: invite, createRoom: true });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const body = sessionResponseSchema.parse(await created.json());
    expect(body.protocolVersion).toBe('0.2.0');
    expect(slots.slotState(body.roomCode, body.playerId)).toBe('RESERVED');
    const joined = await post({
      nickname: '둘',
      inviteToken: invite,
      createRoom: false,
      roomCode: body.roomCode,
    });
    expect(joined.status).toBe(201);
    const second = sessionResponseSchema.parse(await joined.json());
    expect(second.roomCode).toBe(body.roomCode);
    expect(second.playerId).not.toBe(body.playerId);
    // A different invitation cannot enter with the room code alone.
    const stranger = await post({
      nickname: '셋',
      inviteToken: token(true),
      createRoom: false,
      roomCode: body.roomCode,
    });
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({ error: 'INVALID_INVITATION' });
    expect(slots.occupied(body.roomCode)).toBe(2);
  });

  it('rejects malformed union branches without reserving anything', async () => {
    const before = slots.totalOccupied();
    const invite = token(true);
    expect(
      (await post({ nickname: '하나', inviteToken: invite, createRoom: true, roomCode: 'ABC234' }))
        .status,
    ).toBe(400);
    expect((await post({ nickname: '하나', inviteToken: invite, createRoom: false })).status).toBe(
      400,
    );
    expect((await post({ nickname: '', inviteToken: invite, createRoom: true })).status).toBe(400);
    expect((await post({ nickname: '하나', inviteToken: 'ABC234', createRoom: true })).status).toBe(
      400,
    );
    // Invitation scope is checked before room existence so no room information leaks.
    expect(
      (await post({ nickname: '하나', inviteToken: invite, createRoom: false, roomCode: 'ZZZ999' }))
        .status,
    ).toBe(403);
    expect(slots.totalOccupied()).toBe(before);
  });

  it('limits attempts per invitation first and closes admission when draining', async () => {
    const invite = token(true);
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      monotonic += 1;
      results.push(
        (await post({ nickname: `n${i}`, inviteToken: invite, createRoom: true })).status,
      );
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    admission = 'DRAINING';
    const closed = await post({ nickname: '하나', inviteToken: token(true), createRoom: true });
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: 'ADMISSION_CLOSED' });
    admission = 'OPEN';
  });

  it('generates codes from the unambiguous alphabet and skips existing ones', () => {
    const code = generateRoomCode(() => false);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    let calls = 0;
    expect(() => generateRoomCode(() => ++calls <= 64)).toThrow('ROOM_CODE_EXHAUSTED');
  });

  it('bounds invalid-token and malformed requests before they can reserve a seat', async () => {
    const before = slots.totalOccupied();
    for (let i = 0; i < 10; i++) {
      const response = await post(
        i % 2
          ? {}
          : {
              nickname: '반복',
              inviteToken: `invalid-${String(i).padStart(40, 'x')}`,
              createRoom: true,
            },
      );
      expect([400, 403]).toContain(response.status);
    }
    const limited = await post({});
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(slots.totalOccupied()).toBe(before);
    monotonic += 60_000;
    expect((await post({})).status).toBe(400);
  });
});

describe('GitLab team admission through the trusted ingress', () => {
  let server: Server;
  let endpoint: string;
  let deps: SessionRouteDeps;
  let admission: AdmissionState;
  let monotonic: number;
  beforeEach(async () => {
    admission = 'OPEN';
    monotonic = 0;
    const slots = new SlotRegistry({ maxRooms: 1 });
    deps = {
      slots,
      sessions: new ProductSessionStore({ now: () => 1_000_000 }),
      invites: new InviteStore({
        now: () => 1_000_000,
        maxTtlMs: 60_000,
        publicWindow: { mode: 'continuous' },
        knownRoomCodes: () => slots.roomCodes(),
        operationsReady: () => true,
      }),
      limiter: new AdmissionLimiter({ windowMs: 60_000, perInvite: 3, perIp: 10 }),
      admission: () => admission,
      monotonicNow: () => monotonic,
      trustProxy: true,
      admissionMode: 'gitlab-sso',
    };
    const app = express();
    app.use(express.json());
    // Rebuild per request so refusal tests can exercise both configuration flags.
    app.use((req, res, next) => createSessionRoutes(deps)(req, res, next));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    endpoint = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0);
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(endpoint + SESSION_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const create = { nickname: 'team', createRoom: true };
  const identity = (user: string) => ({ 'x-sso-user': user });

  it('validates an explicitly supplied link for team members while retaining link-free code admission', async () => {
    const host = sessionResponseSchema.parse(await (await post(create, identity('host'))).json());
    const link = deps.invites.issue({
      scope: { allowCreate: false, roomCodes: [host.roomCode] },
      expiresAt: 1_030_000,
    });
    if (link.status !== 'issued') throw new Error(link.code);
    const request = {
      nickname: 'friend',
      createRoom: false,
      roomCode: host.roomCode,
      inviteToken: link.invitation.inviteToken,
    };
    const friend = sessionResponseSchema.parse(
      await (await post(request, identity('friend'))).json(),
    );
    expect(deps.sessions.authenticate(friend.sessionToken)?.inviteId).toBe(
      link.invitation.inviteId,
    );
    deps.invites.revoke(link.invitation.inviteId);
    const revoked = await post(request, identity('revoked-link-user'));
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toEqual({ error: 'INVALID_INVITATION' });
    expect(
      (
        await post(
          { nickname: 'code-user', createRoom: false, roomCode: host.roomCode },
          identity('code-user'),
        )
      ).status,
    ).toBe(201);
  });

  it('lets team members create and fill one room by code without operator-issued invites', async () => {
    const created = await post(create, identity('host'));
    expect(created.status).toBe(201);
    const host = sessionResponseSchema.parse(await created.json());
    const session = deps.sessions.authenticate(host.sessionToken)!;
    expect(session.inviteId).toMatch(/^sso:[a-f0-9]{64}$/);
    for (let i = 0; i < 5; i++) {
      const joined = await post(
        { nickname: 'team-' + i, createRoom: false, roomCode: host.roomCode },
        identity('member-' + i),
      );
      expect(joined.status).toBe(201);
      expect((await joined.json()).roomCode).toBe(host.roomCode);
    }
    expect(deps.slots.occupied(host.roomCode)).toBe(6);
    const seventh = await post(
      { nickname: 'seventh', createRoom: false, roomCode: host.roomCode },
      identity('member-6'),
    );
    // S15P21C204-365. 그 방이 찬 것과 서비스가 찬 것은 다른 답이다.
    expect(seventh.status).toBe(503);
    expect(await seventh.json()).toEqual({ error: 'ROOM_FULL' });
    expect(await (await post(create, identity('another-host'))).json()).toEqual({
      error: 'CAPACITY',
    });
    expect(deps.slots.totalOccupied()).toBe(6);
    deps.sessions.prune();
    expect(deps.sessions.size).toBe(6);
  });

  it('reports only this request admission method, without exposing the GitLab identity', async () => {
    const response = await fetch(endpoint + '/api/sessions/access', {
      headers: identity('member'),
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toContain('X-SSO-User');
    expect(await response.json()).toEqual({ method: 'gitlab-sso' });
    expect(await (await fetch(endpoint + '/api/sessions/access')).json()).toEqual({
      method: 'invitation',
    });
    expect((await post(create)).status).toBe(403);
    expect(deps.slots.totalOccupied()).toBe(0);
  });

  it('rejects missing, malformed and caller-supplied alternative identities without reservations', async () => {
    for (const headers of [
      {},
      identity(''),
      identity('one, two'),
      identity('x'.repeat(256)),
      { 'x-forwarded-user': 'member', 'x-auth-request-user': 'member' },
    ])
      expect((await post(create, headers)).status).toBe(403);
    expect((await post({ ...create, ssoUser: 'member' })).status).toBe(400);
    expect(deps.slots.totalOccupied()).toBe(0);
  });

  it('ignores identity headers unless both SSO mode and proxy trust are enabled', async () => {
    deps = { ...deps, admissionMode: 'invitation' };
    expect((await post(create, identity('member'))).status).toBe(403);
    deps = { ...deps, admissionMode: 'gitlab-sso', trustProxy: false };
    expect((await post(create, identity('member'))).status).toBe(403);
    expect(deps.slots.totalOccupied()).toBe(0);
  });

  it('keeps invitation scope validation for internal smoke and legacy callers', async () => {
    const issued = deps.invites.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: 1_030_000,
    });
    if (issued.status !== 'issued') throw new Error(issued.code);
    expect((await post({ ...create, inviteToken: issued.invitation.inviteToken })).status).toBe(
      201,
    );
    expect((await post({ ...create, inviteToken: 'unknown-invitation-token' })).status).toBe(403);
  });

  it('counts repeated nicknames as one SSO identity, respects IP limits and draining', async () => {
    const missing = { nickname: 'n', createRoom: false, roomCode: 'ABCDEF' };
    for (let i = 0; i < 3; i++)
      expect((await post({ ...missing, nickname: 'n-' + i }, identity('same-user'))).status).toBe(
        404,
      );
    expect((await post(missing, identity('same-user'))).status).toBe(429);
    for (let i = 0; i < 7; i++)
      expect((await post(missing, identity('other-' + i))).status).toBe(404);
    expect((await post(missing, identity('ip-over-limit'))).status).toBe(429);
    monotonic = 60_000;
    expect((await post(missing, identity('same-user'))).status).toBe(404);
    admission = 'DRAINING';
    const draining = await post(create, identity('same-user'));
    expect(draining.status).toBe(503);
    expect(await draining.json()).toEqual({ error: 'ADMISSION_CLOSED' });
    expect(deps.slots.totalOccupied()).toBe(0);
  });

  // S15P21C204-293. 공개하면 탭 몇 개로 방 예산 전체를 가져갈 수 있었다.
  it('caps how many rooms one guest origin holds and says so plainly', async () => {
    deps = { ...deps, admissionMode: 'guest', slots: new SlotRegistry({ maxRooms: 5 }) };
    const guest = { nickname: 'guest', createRoom: true };
    expect((await post(guest)).status).toBe(201);
    expect((await post(guest)).status).toBe(201);

    // 서비스에 방이 세 개 남아 있어도 같은 출처는 더 열지 못한다.
    const refused = await post(guest);
    expect(refused.status).toBe(429);
    // "가득 찼다"가 아니라 "네가 많이 열었다"라고 답해야 사용자가 무엇을 할지 안다.
    expect(await refused.json()).toEqual({ error: 'TOO_MANY_ROOMS' });
    expect(deps.slots.roomCodes().size).toBe(2);

    // 팀(SSO)은 IP 가 아니라 계정으로 센다. 같은 IP 의 게스트 방은 팀원의 몫을 줄이지 않는다.
    deps = { ...deps, admissionMode: 'gitlab-sso' };
    expect((await post({ nickname: 'team', createRoom: true }, identity('member'))).status).toBe(
      201,
    );
    expect(deps.slots.roomCodes().size).toBe(3);
  });

  // S15P21C204-366. 팀 모드에서 한 계정은 방 하나를 열고 자리 하나를 갖는다.
  describe('one SSO account, one room and one seat', () => {
    beforeEach(() => {
      const slots = new SlotRegistry({ maxRooms: 6 });
      deps = {
        ...deps,
        slots,
        cleanupReservations: createReservationCleanup({
          sessions: deps.sessions,
          slots,
          hasLiveRoom: () => false,
          onRoomClosed: () => undefined,
        }),
      };
    });
    // 시도 속도 제한은 따로 시험한다. 여기서는 요청마다 창을 넘겨 한도 규칙만 본다.
    const send = (body: unknown, user: string) => {
      monotonic += 60_000;
      return post(body, identity(user));
    };
    const admitted = async (response: Response) => {
      expect(response.status).toBe(201);
      return sessionResponseSchema.parse(await response.json());
    };
    /** 방이 하는 일을 흉내 낸다: 접속하면 자리를 JOINED 로, 끊기면 세션을 무효로 하고 자리를 푼다. */
    const connect = (seat: { roomCode: string; playerId: string }) => {
      const session = deps.sessions.getByPlayer(seat.playerId);
      if (!session) throw new Error('missing session');
      expect(deps.sessions.claimConnection(session.sessionId, 'conn-' + seat.playerId)).toBe(
        'claimed',
      );
      expect(deps.slots.markJoined(seat.roomCode, seat.playerId, monotonic)).toBe(true);
      return () => {
        deps.sessions.invalidate(session.sessionId);
        deps.slots.release(seat.roomCode, seat.playerId);
      };
    };
    const joinByCode = (roomCode: string) => ({ nickname: 'team', createRoom: false, roomCode });

    it('refuses a second seat while the account is connected, without blocking teammates', async () => {
      connect(await admitted(await send(create, 'alice')));
      const again = await send(create, 'alice');
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: 'ALREADY_IN_ROOM' });

      // 모든 요청이 같은 루프백 IP 에서 온다. 캠퍼스 NAT 뒤 다른 팀원은 자기 몫을 그대로 쓴다.
      const bob = await admitted(await send(create, 'bob'));
      await admitted(await send(create, 'carol'));
      const other = await send(joinByCode(bob.roomCode), 'alice');
      expect(other.status).toBe(409);
      expect(await other.json()).toEqual({ error: 'ALREADY_IN_ROOM' });
      expect(deps.slots.occupied(bob.roomCode)).toBe(1);
    });

    it('refuses a second window in the same room too', async () => {
      const bob = await admitted(await send(create, 'bob'));
      connect(await admitted(await send(joinByCode(bob.roomCode), 'alice')));
      const second = await send(joinByCode(bob.roomCode), 'alice');
      expect(second.status).toBe(409);
      expect(deps.slots.occupied(bob.roomCode)).toBe(2);
    });

    it('replaces a reservation that never connected and closes the room it left empty', async () => {
      // 창을 닫았거나 버튼을 두 번 누른 경우다. 붙잡힌 예약 때문에 본인이 막히면 안 된다.
      const first = await admitted(await send(create, 'alice'));
      const second = await admitted(await send(create, 'alice'));
      expect(second.roomCode).not.toBe(first.roomCode);
      expect(deps.slots.hasRoom(first.roomCode)).toBe(false);
      expect(deps.sessions.getByPlayer(first.playerId)).toBeNull();
    });

    it('lets the account in again as soon as its window closes', async () => {
      const bob = await admitted(await send(create, 'bob'));
      const leave = connect(await admitted(await send(create, 'alice')));
      leave();
      await admitted(await send(joinByCode(bob.roomCode), 'alice'));
    });

    it('still caps rooms the account opened and left to others', async () => {
      // 방을 연 사람이 나가도 남은 사람이 있으면 방은 그 계정의 몫으로 남는다.
      const alice = await admitted(await send(create, 'alice'));
      const leave = connect(alice);
      connect(await admitted(await send(joinByCode(alice.roomCode), 'bob')));
      leave();
      const refused = await send(create, 'alice');
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({ error: 'TOO_MANY_ROOMS' });

      // 명시한 생성 링크로 만든 방은 링크가 범위를 정하므로 이 몫과 무관하다.
      const link = deps.invites.issue({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: 1_030_000,
      });
      if (link.status !== 'issued') throw new Error(link.code);
      await admitted(await send({ ...create, inviteToken: link.invitation.inviteToken }, 'alice'));
    });
  });
});

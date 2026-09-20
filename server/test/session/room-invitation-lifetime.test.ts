// S15P21C204-293. 초대를 돌리는 것은 방을 쓰는 것이 아니다.
//
// 예전에는 회전이 방의 lastActivity 를 갱신했다. 로비 체류 기한이 그 값 기준이므로, 아무도 없는
// 방을 10분마다 한 번 돌리는 것만으로 영원히 붙잡을 수 있었다. 공개하면 방 예산 전체를 그렇게
// 잠글 수 있다. 여기서는 시계를 직접 돌려 기한이 늘지 않는 것을 본다.
import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ROOM_INVITATION_ROUTE } from '@kkakkung/protocol/game-messages';
import { AdmissionLimiter } from '../../src/session/AdmissionLimiter.js';
import { InviteStore } from '../../src/session/InviteStore.js';
import { ProductSessionStore } from '../../src/session/ProductSessionStore.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';
import { createSessionRoutes } from '../../src/session/SessionRoutes.js';

let server: Server;
let endpoint: string;
let monotonic = 0;
let slots: SlotRegistry;
let sessionToken: string;
let roomCode: string;

beforeEach(async () => {
  monotonic = 0;
  slots = new SlotRegistry({ maxRooms: 2 });
  const sessions = new ProductSessionStore({ now: () => 1_000_000 });
  roomCode = 'ABC234';
  const issued = sessions.issue({ nickname: 'host', inviteId: 'invite-1', roomCode });
  sessionToken = issued.sessionToken;
  slots.reserve(roomCode, issued.playerId, monotonic, { create: true });
  // 회전은 살아 있는 연결을 요구한다. 실제 경기에서는 WebSocket 이 이것을 잡는다.
  expect(sessions.claimConnection(issued.sessionId, 'conn-1')).toBe('claimed');

  const app = express();
  app.use(express.json());
  app.use(
    createSessionRoutes({
      slots,
      sessions,
      invites: new InviteStore({
        now: () => 1_000_000,
        maxTtlMs: 60_000,
        publicWindow: { mode: 'continuous' },
        knownRoomCodes: () => slots.roomCodes(),
        operationsReady: () => true,
      }),
      limiter: new AdmissionLimiter({ windowMs: 60_000, perInvite: 50, perIp: 50 }),
      admission: () => 'OPEN',
      monotonicNow: () => monotonic,
      trustProxy: false,
      admissionMode: 'gitlab-sso',
      roomInvitations: {
        rotate: (code) => ({ inviteToken: 'token-' + code, roomCode: code, expiresAt: 2_000_000 }),
        revoke: () => undefined,
      },
      canManageInvitations: () => true,
    }),
  );
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  endpoint = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const rotate = () =>
  fetch(endpoint + ROOM_INVITATION_ROUTE, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}` },
  });

it('does not extend the room deadline by rotating the invitation', async () => {
  const before = slots.lastActivity(roomCode);
  expect(before).toBe(0);

  monotonic += 300_000;
  expect((await rotate()).status).toBe(201);
  expect(slots.lastActivity(roomCode)).toBe(before);

  // 여러 번 돌려도 같다. 방 수명은 사람이 들어올 때만 는다.
  monotonic += 300_000;
  expect((await rotate()).status).toBe(201);
  expect(slots.lastActivity(roomCode)).toBe(before);

  // 실제 입장은 여전히 수명을 갱신한다.
  slots.reserve(roomCode, 'friend', monotonic);
  expect(slots.lastActivity(roomCode)).toBe(monotonic);
});

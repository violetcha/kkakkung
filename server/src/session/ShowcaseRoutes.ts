/**
 * 발표 시연 방(showcase) 발급 경로.
 *
 * 실제 사람 넷이 2:2 로 고정 소형 미로에서 3분을 온전히 뛰는 경기다. `/showcase` 를 연 팀원은
 * 모두 지금 열려 있는 시연 방 하나에 모이고(없으면 새로 연다), 역할은 각자 고른다. 한 역할은
 * 둘까지라 셋째가 같은 역할을 고르면 `ROLE_FULL` 로 다른 역할을 고르게 한다.
 *
 * 인증은 `/demo` 와 같다. 호스트 nginx 가 GitLab SSO 를 지난 뒤 로그인 이메일로 `X-Demo-Admin`
 * 을 써 주고, 서버는 그 이메일이 운영자 목록에 있을 때만 받는다(S15P21C204-367). `trustedProxy`
 * 없이는 호출자가 보낸 헤더를 신원으로 삼지 않는다. 운영 토큰은 이 경로와 무관하다.
 */
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  SHOWCASE_ROOM_ROUTE,
  showcaseRoomRequestSchema,
  type ShowcaseErrorCode,
  type ShowcaseRoomResponse,
} from '@kkakkung/protocol/game-messages';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import { isOperatorRequest, type OperatorAllowlist } from './operator-allowlist.js';
import type { ProductSessionStore } from './ProductSessionStore.js';
import { generateRoomCode } from './SessionRoutes.js';
import type { SlotRegistry } from './SlotRegistry.js';

export type ShowcaseRouteDependencies = Readonly<{
  sessions: ProductSessionStore;
  slots: SlotRegistry;
  trustedProxy: boolean;
  /** 운영자 등록 이메일 목록(S15P21C204-367). */
  operatorAllowed: OperatorAllowlist;
  monotonicNow: () => number;
  /** 세션을 받고 접속하기까지 기다려 주는 시간. 데모 방과 같은 값을 쓴다. */
  admissionTtlMs: number;
  /**
   * S15P21C204-362. 일반 세션 발급과 방 접속(onAuth 의 NOT_READY)이 함께 쓰는 문. 서버가 READY·OPEN
   * 이 아니면 세션을 만들지 않고 ADMISSION_CLOSED 로 답해, 게임 페이지까지 가서 튕기는 경로를 없앤다.
   */
  ready: () => boolean;
  cleanupReservations?: () => void;
}>;

const fail = (res: Response, status: number, code: ShowcaseErrorCode) =>
  void res.status(status).json({ error: code });

export function createShowcaseRoutes(deps: ShowcaseRouteDependencies): Router {
  const router = Router();
  router.post(SHOWCASE_ROOM_ROUTE, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isOperatorRequest(req, deps.trustedProxy, deps.operatorAllowed))
      return fail(res, 401, 'UNAUTHORIZED');
    if (!deps.ready()) return fail(res, 503, 'ADMISSION_CLOSED');
    const parsed = showcaseRoomRequestSchema.safeParse(req.body === '' ? {} : (req.body ?? {}));
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST');
    deps.cleanupReservations?.();
    const existing = deps.slots.joinableShowcaseRoom();
    // S15P21C204-361. 빈 자리가 있는 시연 방이 있으면 거기에 앉힌다. 없으면 모이는 중인 시연 방이
    // 한도(SHOWCASE_ROOMS) 미만일 때만 새 방을 열고, 한도에 닿았으면 기다리게 한다.
    if (existing === null && !deps.slots.canOpenShowcaseRoom()) return fail(res, 503, 'CAPACITY');
    let roomCode: string;
    let issued: ReturnType<ProductSessionStore['issue']>;
    try {
      roomCode = existing ?? generateRoomCode((code) => deps.slots.hasRoom(code));
      issued = deps.sessions.issue({
        nickname: parsed.data.nickname ?? (parsed.data.role === 'runner' ? '도망자' : '술래'),
        inviteId: 'showcase:' + randomUUID(),
        roomCode,
        admissionTtlMs: deps.admissionTtlMs,
      });
    } catch {
      return fail(res, 503, 'CAPACITY');
    }
    const outcome = deps.slots.reserve(roomCode, issued.playerId, deps.monotonicNow(), {
      create: existing === null,
      showcase: { role: parsed.data.role },
    });
    if (outcome !== 'reserved') {
      deps.sessions.invalidate(issued.sessionId);
      return outcome === 'ROLE_FULL' ? fail(res, 409, 'ROLE_FULL') : fail(res, 503, 'CAPACITY');
    }
    const response: ShowcaseRoomResponse = {
      sessionToken: issued.sessionToken,
      playerId: issued.playerId,
      roomCode,
      role: parsed.data.role,
      expiresAt: issued.admissionExpiresAt ?? issued.expiresAt,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
      entryFragment:
        '#showcase=' +
        encodeURIComponent(issued.sessionToken) +
        '&room=' +
        roomCode +
        '&player=' +
        encodeURIComponent(issued.playerId),
    };
    return void res.status(201).json(response);
  });
  return router;
}

/** `SHOWCASE_ROOMS=0` 인 배포. 인증은 같게 보고 방은 절대 열지 않는다. */
export function createShowcaseUnavailableRoutes(
  trustedProxy: boolean,
  operatorAllowed: OperatorAllowlist,
): Router {
  const router = Router();
  router.post(SHOWCASE_ROOM_ROUTE, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isOperatorRequest(req, trustedProxy, operatorAllowed))
      return fail(res, 401, 'UNAUTHORIZED');
    return fail(res, 503, 'SHOWCASE_UNAVAILABLE');
  });
  return router;
}

/**
 * 발표 시연 방(showcase) 발급 경로.
 *
 * 실제 사람 넷이 2:2 로 고정 소형 미로에서 3분을 온전히 뛰는 경기다. `/showcase` 를 연 팀원은
 * 모두 지금 열려 있는 시연 방 하나에 모이고(없으면 새로 연다), 역할은 각자 고른다. 한 역할은
 * 둘까지라 셋째가 같은 역할을 고르면 `ROLE_FULL` 로 다른 역할을 고르게 한다.
 *
 * 인증은 `/demo` 와 같다. 호스트 nginx 가 GitLab 프로젝트 멤버 SSO 를 지난 뒤에만 `X-Demo-Admin`
 * 을 써 주므로, `trustedProxy` 없이는 호출자가 보낸 헤더를 신원으로 삼지 않는다. 운영 토큰은
 * 이 경로와 무관하고 브라우저에 전달되지 않는다.
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
import type { ProductSessionStore } from './ProductSessionStore.js';
import { generateRoomCode } from './SessionRoutes.js';
import type { SlotRegistry } from './SlotRegistry.js';

export type ShowcaseRouteDependencies = Readonly<{
  sessions: ProductSessionStore;
  slots: SlotRegistry;
  trustedProxy: boolean;
  monotonicNow: () => number;
  /** 세션을 받고 접속하기까지 기다려 주는 시간. 데모 방과 같은 값을 쓴다. */
  admissionTtlMs: number;
  cleanupReservations?: () => void;
}>;

const fail = (res: Response, status: number, code: ShowcaseErrorCode) =>
  void res.status(status).json({ error: code });

function authorized(request: Request, trustedProxy: boolean): boolean {
  const identity = request.headers['x-demo-admin'];
  return (
    trustedProxy &&
    typeof identity === 'string' &&
    identity.trim().length > 0 &&
    identity.length <= 256
  );
}

export function createShowcaseRoutes(deps: ShowcaseRouteDependencies): Router {
  const router = Router();
  router.post(SHOWCASE_ROOM_ROUTE, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!authorized(req, deps.trustedProxy)) return fail(res, 401, 'UNAUTHORIZED');
    const parsed = showcaseRoomRequestSchema.safeParse(req.body === '' ? {} : (req.body ?? {}));
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST');
    deps.cleanupReservations?.();
    const existing = deps.slots.joinableShowcaseRoom();
    // 넷이 찬 방이 아직 시작 전이면 다섯째는 기다린다. 무리를 둘로 나누는 새 방은 열지 않는다.
    if (existing === null && deps.slots.formingShowcaseRoom()) return fail(res, 503, 'CAPACITY');
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
export function createShowcaseUnavailableRoutes(trustedProxy: boolean): Router {
  const router = Router();
  router.post(SHOWCASE_ROOM_ROUTE, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!authorized(req, trustedProxy)) return fail(res, 401, 'UNAUTHORIZED');
    return fail(res, 503, 'SHOWCASE_UNAVAILABLE');
  });
  return router;
}

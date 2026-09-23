/**
 * Operator-only demo room route (S15P21C204-258). Authorization is E's `createOperatorAuth`
 * function, the same gate as the other operations routes; a player session never passes it.
 * The route opens a one-seat room whose other five participants are server-driven puppets and
 * hands back the operator's own player session. There is no player-facing way to reach it, and
 * the route is only mounted when the deployment explicitly enables demo rooms.
 */
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  DEMO_ADMIN_ROOM_ROUTE,
  DEMO_ROOM_ROUTE,
  demoRoomRequestSchema,
  type DemoRoomResponse,
} from '@kkakkung/protocol/game-messages';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import type { OperatorAuthorize } from './InvitationRoutes.js';
import { isOperatorRequest, type OperatorAllowlist } from './operator-allowlist.js';
import type { ProductSessionStore } from './ProductSessionStore.js';
import { generateRoomCode } from './SessionRoutes.js';
import type { SlotRegistry } from './SlotRegistry.js';

type DemoRouteDependencies = {
  sessions: ProductSessionStore;
  slots: SlotRegistry;
  monotonicNow: () => number;
  demoAdmissionTtlMs: number;
  cleanupReservations?: () => void;
};

type DemoAuthorize = (request: Request) => boolean;

function requireDemoAccess(authorize: DemoAuthorize) {
  return (req: Request, res: Response, next: () => void) => {
    if (!authorize(req)) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    next();
  };
}

function createDemoRoute(
  deps: DemoRouteDependencies & Readonly<{ route: string; authorize: DemoAuthorize }>,
): Router {
  const router = Router();
  router.post(deps.route, requireDemoAccess(deps.authorize), (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = demoRoomRequestSchema.safeParse(req.body === '' ? {} : (req.body ?? {}));
    if (!parsed.success) return void res.status(400).json({ error: 'INVALID_REQUEST' });
    deps.cleanupReservations?.();
    let roomCode: string;
    let issued: ReturnType<ProductSessionStore['issue']>;
    try {
      roomCode = generateRoomCode((code) => deps.slots.hasRoom(code));
      issued = deps.sessions.issue({
        nickname: parsed.data.nickname ?? '관리자',
        inviteId: 'demo:' + randomUUID(),
        roomCode,
        admissionTtlMs: deps.demoAdmissionTtlMs,
      });
    } catch {
      return void res.status(503).json({ error: 'CAPACITY' });
    }
    const outcome = deps.slots.reserve(roomCode, issued.playerId, deps.monotonicNow(), {
      create: true,
      demo: { operatorRole: parsed.data.role },
    });
    if (outcome !== 'reserved') {
      deps.sessions.invalidate(issued.sessionId);
      // S15P21C204-312. 데모 방은 자기 예산이 따로 있다. 다른 데모 방이 열려 있어서 못 여는 것과
      // 서비스 전체가 찬 것은 운영자가 할 일이 다르므로 나눠 답한다.
      return void res
        .status(503)
        .json({ error: outcome === 'DEMO_LIMIT' ? 'DEMO_ROOM_LIMIT' : 'CAPACITY' });
    }
    const response: DemoRoomResponse = {
      sessionToken: issued.sessionToken,
      playerId: issued.playerId,
      roomCode,
      role: parsed.data.role,
      // Before the first connection this is the demo admission deadline, not the longer session
      // lease. The operator script prints this value so an unused demo seat is not mistaken for a
      // live room that may be opened later.
      expiresAt: issued.admissionExpiresAt ?? issued.expiresAt,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
      entryFragment:
        '#demo=' +
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

/** Operations/loopback entry. Its Bearer is never accepted by the browser administrator route. */
export function createDemoRoutes(
  deps: DemoRouteDependencies & { authorize: OperatorAuthorize },
): Router {
  return createDemoRoute({
    ...deps,
    route: DEMO_ROOM_ROUTE,
    authorize: (request) => deps.authorize(request.headers.authorization),
  });
}

/**
 * Public-browser administrator entry. `X-Demo-Admin` is the login email the host nginx writes
 * after GitLab SSO; the server admits it only when it is on the operator list (S15P21C204-367).
 * Requiring `trustedProxy` keeps an accidentally exposed server port from treating a
 * caller-supplied HTTP header as an administrator credential.
 */
export function createDemoAdminRoutes(
  deps: DemoRouteDependencies &
    Readonly<{ trustedProxy: boolean; operatorAllowed: OperatorAllowlist }>,
): Router {
  return createDemoRoute({
    ...deps,
    route: DEMO_ADMIN_ROOM_ROUTE,
    authorize: (request) => isOperatorRequest(request, deps.trustedProxy, deps.operatorAllowed),
  });
}

/** Mounted in place of the route when demo rooms are not enabled, so nothing is ever opened. */
export function createDemoUnavailableRoutes(authorize: OperatorAuthorize): Router {
  const router = Router();
  router.use(
    DEMO_ROOM_ROUTE,
    requireDemoAccess((request) => authorize(request.headers.authorization)),
    (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'DEMO_UNAVAILABLE' });
    },
  );
  return router;
}

/** Same unavailable response for an SSO-authorized browser administrator. */
export function createDemoAdminUnavailableRoutes(
  trustedProxy: boolean,
  operatorAllowed: OperatorAllowlist,
): Router {
  const router = Router();
  router.use(
    DEMO_ADMIN_ROOM_ROUTE,
    requireDemoAccess((request) => isOperatorRequest(request, trustedProxy, operatorAllowed)),
    (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'DEMO_UNAVAILABLE' });
    },
  );
  return router;
}

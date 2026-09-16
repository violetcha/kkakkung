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
  DEMO_ROOM_ROUTE,
  demoRoomRequestSchema,
  type DemoRoomResponse,
} from '@kkakkung/protocol/game-messages';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import { requireOperator, type OperatorAuthorize } from './InvitationRoutes.js';
import type { ProductSessionStore } from './ProductSessionStore.js';
import { generateRoomCode } from './SessionRoutes.js';
import type { SlotRegistry } from './SlotRegistry.js';

export function createDemoRoutes(deps: {
  sessions: ProductSessionStore;
  slots: SlotRegistry;
  authorize: OperatorAuthorize;
  monotonicNow: () => number;
  cleanupReservations?: () => void;
}): Router {
  const router = Router();
  router.post(DEMO_ROOM_ROUTE, requireOperator(deps.authorize), (req: Request, res: Response) => {
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
      return void res.status(503).json({ error: 'CAPACITY' });
    }
    const response: DemoRoomResponse = {
      sessionToken: issued.sessionToken,
      playerId: issued.playerId,
      roomCode,
      role: parsed.data.role,
      expiresAt: issued.expiresAt,
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

/** Mounted in place of the route when demo rooms are not enabled, so nothing is ever opened. */
export function createDemoUnavailableRoutes(authorize: OperatorAuthorize): Router {
  const router = Router();
  router.use(DEMO_ROOM_ROUTE, requireOperator(authorize), (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'DEMO_UNAVAILABLE' });
  });
  return router;
}

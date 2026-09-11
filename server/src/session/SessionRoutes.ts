/**
 * `POST /api/sessions`: strict SessionRequest union → SessionResponse. Order of checks:
 * input → admission OPEN → invitation scope → invite-first rate limit → seat reservation →
 * admission re-check → session issue. Rejections never reveal hidden room content and never
 * leave a reservation behind.
 */
import { randomInt } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import {
  SESSION_ROUTE,
  sessionRequestSchema,
  type SessionErrorCode,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import type { AdmissionLimiter } from './AdmissionLimiter.js';
import type { InvitationPort } from './invite-types.js';
import type { ProductSessionStore } from './ProductSessionStore.js';
import type { SlotRegistry } from './SlotRegistry.js';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(exists: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!exists(code)) return code;
  }
  throw new Error('ROOM_CODE_EXHAUSTED');
}

export type AdmissionState = 'OPEN' | 'DRAINING' | 'LOCKED';

export type SessionRouteDeps = Readonly<{
  invites: InvitationPort;
  sessions: ProductSessionStore;
  slots: SlotRegistry;
  /** null when F attempt limits are not configured: product admission stays LOCKED. */
  limiter: AdmissionLimiter | null;
  admission: () => AdmissionState;
  /** Monotonic ms for rate limiting. */
  monotonicNow: () => number;
  /** Only honour proxy headers when F's trusted proxy path is configured. */
  trustProxy: boolean;
  /** Reclaim expired reservations before a new admission checks capacity. */
  cleanupReservations?: () => void;
}>;

function clientIp(req: Request, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? null;
}

export function createSessionRoutes(deps: SessionRouteDeps): Router {
  const router = Router();
  const fail = (res: Response, status: number, code: SessionErrorCode) =>
    void res.status(status).json({ error: code });
  router.post(SESSION_ROUTE, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = sessionRequestSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST');
    if (deps.admission() !== 'OPEN' || deps.limiter === null)
      return fail(res, 503, 'ADMISSION_CLOSED');
    const body = parsed.data;
    const verified = deps.invites.verify(
      body.createRoom
        ? { inviteToken: body.inviteToken, createRoom: true }
        : { inviteToken: body.inviteToken, createRoom: false, roomCode: body.roomCode },
    );
    if (!verified) return fail(res, 403, 'INVALID_INVITATION');
    const verdict = deps.limiter.attempt(
      { inviteId: verified.inviteId, ip: clientIp(req, deps.trustProxy) },
      deps.monotonicNow(),
    );
    if (verdict !== 'allowed') return fail(res, 429, 'RATE_LIMITED');
    deps.cleanupReservations?.();
    const nowMs = deps.monotonicNow();
    let roomCode: string;
    let issued: ReturnType<ProductSessionStore['issue']>;
    let playerId: string;
    try {
      if (body.createRoom) {
        roomCode = generateRoomCode((code) => deps.slots.hasRoom(code));
        issued = deps.sessions.issue({
          nickname: body.nickname,
          inviteId: verified.inviteId,
          roomCode,
        });
        playerId = issued.playerId;
        const outcome = deps.slots.reserve(roomCode, issued.playerId, nowMs, { create: true });
        if (outcome !== 'reserved') {
          deps.sessions.invalidate(issued.sessionId);
          return fail(res, 503, 'CAPACITY');
        }
        deps.invites.bindCreatedRoom(verified.inviteId, roomCode);
      } else {
        roomCode = body.roomCode;
        if (!deps.slots.hasRoom(roomCode)) return fail(res, 404, 'ROOM_NOT_AVAILABLE');
        issued = deps.sessions.issue({
          nickname: body.nickname,
          inviteId: verified.inviteId,
          roomCode,
        });
        playerId = issued.playerId;
        const outcome = deps.slots.reserve(roomCode, issued.playerId, nowMs);
        if (outcome !== 'reserved') {
          deps.sessions.invalidate(issued.sessionId);
          return fail(
            res,
            outcome === 'ROOM_CLOSED' ? 404 : 503,
            outcome === 'ROOM_CLOSED' ? 'ROOM_NOT_AVAILABLE' : 'CAPACITY',
          );
        }
      }
    } catch {
      return fail(res, 503, 'CAPACITY');
    }
    // Admission may have changed while reserving; never confirm a session once draining.
    if (deps.admission() !== 'OPEN') {
      deps.slots.release(roomCode, playerId);
      deps.sessions.invalidate(issued.sessionId);
      return fail(res, 503, 'ADMISSION_CLOSED');
    }
    const response: SessionResponse = {
      sessionToken: issued.sessionToken,
      playerId: issued.playerId,
      roomCode,
      expiresAt: issued.expiresAt,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    };
    res.status(201).json(response);
  });
  return router;
}

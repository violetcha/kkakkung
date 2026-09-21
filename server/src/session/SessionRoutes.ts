/**
 * `POST /api/sessions`: strict SessionRequest union → SessionResponse. Order of checks:
 * input → admission OPEN → invitation scope → invite-first rate limit → seat reservation →
 * admission re-check → session issue. Rejections never reveal hidden room content and never
 * leave a reservation behind.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import {
  SESSION_ROUTE,
  SESSION_ACCESS_ROUTE,
  SESSION_CANCEL_ROUTE,
  ROOM_INVITATION_ROUTE,
  roomInvitationRequestSchema,
  sessionCancelRequestSchema,
  sessionRequestSchema,
  type SessionErrorCode,
  type SessionResponse,
  type RoomInvitationErrorCode,
} from '@kkakkung/protocol/game-messages';
import { AdmissionLimiter } from './AdmissionLimiter.js';
import { clientOrigin } from './client-origin.js';
import type { InvitationPort } from './invite-types.js';
import type { ProductSessionStore } from './ProductSessionStore.js';
import type { SlotRegistry } from './SlotRegistry.js';
import type { RoomInvitations } from './RoomInvitations.js';
import type { SessionAuth } from './session-types.js';

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
  /** SSO requires a trusted private ingress. Guest selection is guarded by parseConfig. */
  admissionMode?: 'invitation' | 'gitlab-sso' | 'guest';
  /** Reclaim expired reservations before a new admission checks capacity. */
  cleanupReservations?: () => void;
  roomInvitations?: RoomInvitations;
  canManageInvitations?: (session: SessionAuth) => boolean;
}>;

/**
 * S15P21C204-300. 제한과 상한은 원본 주소가 아니라 **접힌 출처 키**로만 센다. 주소를 그대로
 * 돌려주는 함수를 두지 않아, 새 호출 지점이 실수로 정규화를 건너뛸 수 없게 한다.
 */
export { clientOrigin } from './client-origin.js';

export function createSessionRoutes(deps: SessionRouteDeps): Router {
  const router = Router();
  // Bound malformed/invalid-token traffic before parsing or scanning invitation hashes.
  // Use the configured school-NAT IP budget; random tokens do not create new limiter keys.
  const requestLimiter = deps.limiter
    ? new AdmissionLimiter({
        ...deps.limiter.options,
        perInvite: deps.limiter.options.perIp,
      })
    : null;
  router.use(SESSION_ROUTE, (req, res, next) => {
    const ip = clientOrigin(req, deps.trustProxy) ?? 'unknown-peer';
    if (
      requestLimiter !== null &&
      requestLimiter.attempt({ inviteId: ip, ip: null }, deps.monotonicNow()) !== 'allowed'
    ) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', String(Math.ceil(requestLimiter.options.windowMs / 1000)));
      res.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }
    next();
  });
  const ssoPrincipal = (req: Request): string | null => {
    if (deps.admissionMode !== 'gitlab-sso' || !deps.trustProxy) return null;
    const user = req.headers['x-sso-user'];
    // Never read identity from JSON, cookies or arbitrary forwarded identity headers.
    // Reject duplicate/combined values and store only a bounded, hashed limiter identity.
    if (typeof user !== 'string' || !/^[A-Za-z0-9_.@-]{1,255}$/.test(user)) return null;
    return 'sso:' + createHash('sha256').update(user).digest('hex');
  };
  router.get(SESSION_ACCESS_ROUTE, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.vary('X-SSO-User');
    res.json({
      method:
        deps.admissionMode === 'guest' ? 'guest' : ssoPrincipal(req) ? 'gitlab-sso' : 'invitation',
    });
  });
  const manageInvitation = (req: Request, res: Response, revoke: boolean) => {
    res.setHeader('Cache-Control', 'no-store');
    const reject = (status: number, error: RoomInvitationErrorCode) =>
      void res.status(status).json({ error });
    if (!roomInvitationRequestSchema.safeParse(req.body === '' ? {} : (req.body ?? {})).success)
      return reject(400, 'INVALID_REQUEST');
    const header = req.headers.authorization;
    const session = header?.startsWith('Bearer ')
      ? deps.sessions.authenticate(header.slice(7))
      : null;
    if (!session) return reject(401, 'INVALID_SESSION');
    if (
      !deps.roomInvitations ||
      !deps.sessions.activeConnection(session.sessionId) ||
      deps.canManageInvitations?.(session) !== true
    )
      return reject(403, 'INVITATION_UNAVAILABLE');
    if (
      deps.limiter === null ||
      deps.limiter.attempt(
        { inviteId: `host-invite:${session.sessionId}`, ip: clientOrigin(req, deps.trustProxy) },
        deps.monotonicNow(),
      ) !== 'allowed'
    )
      return reject(429, 'RATE_LIMITED');
    if (revoke) {
      deps.roomInvitations.revoke(session.roomCode);
      return void res.status(204).end();
    }
    if (deps.admission() !== 'OPEN') return reject(503, 'ADMISSION_CLOSED');
    const invitation = deps.roomInvitations.rotate(session.roomCode);
    if (!invitation) return reject(503, 'INVITATION_UNAVAILABLE');
    // S15P21C204-293: 초대를 돌리는 것은 방을 쓰는 것이 아니다. 여기서 수명을 갱신하면 아무도
    // 없는 방을 10분마다 회전 한 번으로 영원히 붙잡을 수 있다. 수명은 사람이 들어올 때만 는다.
    return void res.status(201).json(invitation);
  };
  router.post(ROOM_INVITATION_ROUTE, (req, res) => manageInvitation(req, res, false));
  router.delete(ROOM_INVITATION_ROUTE, (req, res) => manageInvitation(req, res, true));
  router.delete(SESSION_CANCEL_ROUTE, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    // Cleanup remains available while admission is closed. No caller-supplied identity.
    if (!sessionCancelRequestSchema.safeParse(req.body === '' ? {} : (req.body ?? {})).success)
      return void res.status(400).json({ error: 'INVALID_REQUEST' });
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ') || header.length <= 7)
      return void res.status(401).json({ error: 'INVALID_SESSION' });
    const session = deps.sessions.authenticate(header.slice(7));
    // Expired/already-canceled credentials have no reservation to modify.
    if (!session) {
      deps.cleanupReservations?.();
      return void res.status(204).end();
    }
    const state = deps.slots.slotState(session.roomCode, session.playerId);
    if (
      deps.sessions.activeConnection(session.sessionId) ||
      state === 'JOINED' ||
      state === 'RETIRING'
    )
      return void res.status(409).json({ error: 'SESSION_IN_USE' });
    // No await between ownership/state check, slot release and session invalidation.
    if (state === 'RESERVED') deps.slots.release(session.roomCode, session.playerId);
    deps.sessions.invalidate(session.sessionId);
    deps.cleanupReservations?.();
    return void res.status(204).end();
  });
  const fail = (res: Response, status: number, code: SessionErrorCode) =>
    void res.status(status).json({ error: code });
  router.post(SESSION_ROUTE, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = sessionRequestSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST');
    if (deps.admission() !== 'OPEN' || deps.limiter === null)
      return fail(res, 503, 'ADMISSION_CLOSED');
    const body = parsed.data;
    const principal = ssoPrincipal(req);
    const guestCreate = deps.admissionMode === 'guest' && body.createRoom && !body.inviteToken;
    const ip = clientOrigin(req, deps.trustProxy);
    // A new random session is not a new attempt budget. Guest creation shares its IP bucket.
    const guestLimiter = guestCreate
      ? 'guest:' +
        createHash('sha256')
          .update(ip ?? 'unknown-peer')
          .digest('hex')
      : null;
    // An explicitly supplied link must pass its own scope/expiry checks, including for SSO.
    const verified: Readonly<{ inviteId: string; expiresAt?: number }> | null = body.inviteToken
      ? deps.invites.verify(
          body.createRoom
            ? { inviteToken: body.inviteToken, createRoom: true }
            : { inviteToken: body.inviteToken, createRoom: false, roomCode: body.roomCode },
        )
      : principal
        ? { inviteId: principal }
        : guestCreate
          ? { inviteId: 'guest:' + randomUUID() }
          : null;
    if (!verified) return fail(res, 403, 'INVALID_INVITATION');
    const verdict = deps.limiter.attempt(
      { inviteId: principal ?? guestLimiter ?? verified.inviteId, ip },
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
          ...(verified.expiresAt === undefined
            ? {}
            : { admissionDeadlineEpochMs: verified.expiresAt }),
        });
        playerId = issued.playerId;
        // S15P21C204-293: 게스트 생성만 주체를 남긴다. 팀 입장은 사람이 식별되고 한 IP 뒤에
        // 여러 명이 있을 수 있어 대상이 아니다.
        const outcome = deps.slots.reserve(roomCode, issued.playerId, nowMs, {
          create: true,
          openedBy: guestLimiter,
        });
        if (outcome !== 'reserved') {
          deps.sessions.invalidate(issued.sessionId);
          // "서비스가 찼다"와 "당신이 이미 여러 개 열어 두었다"는 다른 사실이라 다르게 답한다.
          return outcome === 'OWNER_LIMIT'
            ? fail(res, 429, 'TOO_MANY_ROOMS')
            : fail(res, 503, 'CAPACITY');
        }
        if (body.inviteToken) deps.invites.bindCreatedRoom(verified.inviteId, roomCode);
      } else {
        roomCode = body.roomCode;
        if (!deps.slots.hasRoom(roomCode)) return fail(res, 404, 'ROOM_NOT_AVAILABLE');
        issued = deps.sessions.issue({
          nickname: body.nickname,
          inviteId: verified.inviteId,
          roomCode,
          ...(verified.expiresAt === undefined
            ? {}
            : { admissionDeadlineEpochMs: verified.expiresAt }),
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

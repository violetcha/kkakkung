/**
 * Product sessions: random logical playerId/sessionId, hashed bearer token, invite and room
 * binding, activity-based lease (default 30 minutes, never beyond 2 hours from issue) and a
 * single active connection per session. The development one-use SessionStore stays for the
 * sandbox room; this store never consumes a token on lookup.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ProductSession, SessionAuth } from './session-types.js';

export type ProductSessionStoreOptions = Readonly<{
  /** Epoch milliseconds. */
  now: () => number;
  leaseTtlMs?: number;
  maxLifetimeMs?: number;
  maxEntries?: number;
}>;

export const SESSION_LIMITS = { leaseTtlMs: 30 * 60_000, maxLifetimeMs: 2 * 60 * 60_000 } as const;

export type ClaimResult = 'claimed' | 'busy' | 'invalid';

export class ProductSessionStore {
  private readonly sessions = new Map<string, ProductSession>();
  private readonly byPlayer = new Map<string, string>();
  readonly leaseTtlMs: number;
  readonly maxLifetimeMs: number;
  private readonly maxEntries: number;

  constructor(private readonly options: ProductSessionStoreOptions) {
    this.leaseTtlMs = options.leaseTtlMs ?? SESSION_LIMITS.leaseTtlMs;
    this.maxLifetimeMs = options.maxLifetimeMs ?? SESSION_LIMITS.maxLifetimeMs;
    this.maxEntries = options.maxEntries ?? 600;
    if (this.leaseTtlMs > this.maxLifetimeMs) throw new Error('INVALID_SESSION_LEASE');
  }

  get size() {
    return this.sessions.size;
  }

  issue(input: { nickname: string; inviteId: string; roomCode: string }) {
    const now = this.options.now();
    this.prune(now);
    if (this.sessions.size >= this.maxEntries) throw new Error('SESSION_CAPACITY');
    const sessionToken = randomBytes(32).toString('base64url');
    const session: ProductSession = {
      sessionId: randomUUID(),
      playerId: randomUUID(),
      tokenHash: hash(sessionToken),
      inviteId: input.inviteId,
      roomCode: input.roomCode,
      nickname: input.nickname,
      issuedAt: now,
      expiresAt: now + this.leaseTtlMs,
      activeConnectionId: null,
      invalidated: false,
    };
    this.sessions.set(session.sessionId, session);
    this.byPlayer.set(session.playerId, session.sessionId);
    return {
      sessionToken,
      playerId: session.playerId,
      sessionId: session.sessionId,
      roomCode: session.roomCode,
      expiresAt: session.expiresAt,
    };
  }

  /** Non-consuming lookup. Expired or invalidated sessions are never returned. */
  authenticate(token: unknown): SessionAuth | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > 512) return null;
    const digest = hash(token);
    let found: ProductSession | null = null;
    for (const session of this.sessions.values())
      if (timingSafeEqual(session.tokenHash, digest)) found = session;
    if (!found || !this.isLive(found)) return null;
    return toAuth(found);
  }

  get(sessionId: string): SessionAuth | null {
    const session = this.sessions.get(sessionId);
    return session && this.isLive(session) ? toAuth(session) : null;
  }

  getByPlayer(playerId: string): SessionAuth | null {
    const id = this.byPlayer.get(playerId);
    return id ? this.get(id) : null;
  }

  activeConnection(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.activeConnectionId ?? null;
  }

  /** Atomically binds one connection. A second concurrent connection is refused, not swapped. */
  claimConnection(sessionId: string, connectionId: string): ClaimResult {
    const session = this.sessions.get(sessionId);
    if (!session || !this.isLive(session)) return 'invalid';
    if (session.activeConnectionId !== null && session.activeConnectionId !== connectionId)
      return 'busy';
    session.activeConnectionId = connectionId;
    this.touch(sessionId);
    return 'claimed';
  }

  releaseConnection(sessionId: string, connectionId: string) {
    const session = this.sessions.get(sessionId);
    if (session && session.activeConnectionId === connectionId) session.activeConnectionId = null;
  }

  /** Real activity extends the lease; presenting the token alone does not. */
  touch(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || !this.isLive(session)) return;
    const now = this.options.now();
    session.expiresAt = Math.min(now + this.leaseTtlMs, session.issuedAt + this.maxLifetimeMs);
  }

  invalidate(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.invalidated = true;
      session.activeConnectionId = null;
    }
  }

  /** Room closed or match over: every session bound to the room becomes unusable. */
  invalidateRoom(roomCode: string) {
    for (const session of this.sessions.values())
      if (session.roomCode === roomCode) {
        session.invalidated = true;
        session.activeConnectionId = null;
      }
  }

  sessionsInRoom(roomCode: string): SessionAuth[] {
    const out: SessionAuth[] = [];
    for (const session of this.sessions.values())
      if (session.roomCode === roomCode && this.isLive(session)) out.push(toAuth(session));
    return out;
  }

  prune(now = this.options.now()) {
    for (const [id, session] of this.sessions) {
      if (session.invalidated || now >= session.expiresAt) {
        this.sessions.delete(id);
        this.byPlayer.delete(session.playerId);
      }
    }
  }

  private isLive(session: ProductSession) {
    return !session.invalidated && this.options.now() < session.expiresAt;
  }
}

function hash(token: string) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function toAuth(session: ProductSession): SessionAuth {
  return {
    sessionId: session.sessionId,
    playerId: session.playerId,
    roomCode: session.roomCode,
    nickname: session.nickname,
    inviteId: session.inviteId,
  };
}

import { randomBytes } from 'node:crypto';

type Session = { nickname: string; expiresAt: number };

/** Local development only. Production invitation/authentication is a separate feature. */
export class SessionStore {
  private readonly entries = new Map<string, Session>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxEntries = options.maxEntries ?? 64;
  }

  issue(nickname: string) {
    const now = this.now();
    for (const [token, session] of this.entries) {
      if (session.expiresAt <= now) this.entries.delete(token);
    }
    if (this.entries.size >= this.maxEntries) throw new Error('SESSION_CAPACITY');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + this.ttlMs;
    this.entries.set(token, { nickname, expiresAt });
    return { token, expiresAt };
  }

  consume(token: string): { nickname: string } | undefined {
    const session = this.entries.get(token);
    this.entries.delete(token);
    if (!session || session.expiresAt <= this.now()) return undefined;
    return { nickname: session.nickname };
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';
import { AdmissionLimiter } from './AdmissionLimiter.js';

export const PRODUCT_HTTP_LIMITS = {
  unauthorized: { perKey: 5, total: 20, concurrent: 4, work: 4 },
  operator: { perKey: 60, total: 120, concurrent: 16, work: 16 },
  media: { perKey: 12, total: 240, concurrent: 128, work: 128 },
} as const;
type Kind = keyof typeof PRODUCT_HTTP_LIMITS;
type Scope = { kind: Kind; key: string };

/** Credentials and caller-supplied identifiers never enter the retained buckets. */
export class ProductHttpLimiter {
  private readonly groups = Object.fromEntries(
    Object.entries(PRODUCT_HTTP_LIMITS).map(([kind, limit]) => [
      kind,
      {
        active: 0,
        work: 0,
        rejected: 0,
        keys: new AdmissionLimiter({
          windowMs: 1000,
          perInvite: limit.perKey,
          perIp: limit.total,
          maxKeys: 4096,
        }),
      },
    ]),
  ) as Record<Kind, { active: number; work: number; rejected: number; keys: AdmissionLimiter }>;

  constructor(
    private readonly options: {
      now: () => number;
      clientIp: (request: IncomingMessage) => string | null;
      authorize: (header: string | undefined) => boolean;
      sessionId: (token: string | null) => string | null;
    },
  ) {}

  private scope(request: IncomingMessage, path: string): Scope | null {
    // CORS preflight carries no bearer and performs no audit/grant/body work.
    if (request.method === 'OPTIONS') return null;
    path = path.toLowerCase().replace(/\/$/, '');
    const ops = path === '/api/operations' || path.startsWith('/api/operations/');
    const media = path === '/api/media/grants' || path === '/api/media/report';
    if (!ops && !media) return null;
    const header = request.headers.authorization;
    const authorization = typeof header === 'string' && header.length <= 4096 ? header : undefined;
    try {
      if (ops && this.options.authorize(authorization))
        return { kind: 'operator', key: 'operator' };
      const session = media
        ? this.options.sessionId(
            authorization?.startsWith('Bearer ') ? authorization.slice(7) : null,
          )
        : null;
      if (session) return { kind: 'media', key: session };
    } catch {
      /* Failed authentication uses the unauthorized bucket. */
    }
    return { kind: 'unauthorized', key: this.options.clientIp(request) ?? 'unknown-peer' };
  }

  allow(request: IncomingMessage, path: string, response: ServerResponse): boolean {
    const scope = this.scope(request, path);
    if (!scope) return true;
    const group = this.groups[scope.kind];
    const limits = PRODUCT_HTTP_LIMITS[scope.kind];
    if (
      group.active >= limits.concurrent ||
      group.keys.attempt({ inviteId: scope.key, ip: 'all' }, this.options.now()) !== 'allowed'
    ) {
      group.rejected++;
      return false;
    }
    group.active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      group.active--;
      response.off('finish', release);
      response.off('close', release);
    };
    response.once('finish', release);
    response.once('close', release);
    return true;
  }

  wrap(handler: RequestHandler): RequestHandler {
    return async (request, response, next) => {
      const scope = this.scope(request, request.originalUrl.split('?')[0] ?? '/');
      if (!scope) return handler(request, response, next);
      const group = this.groups[scope.kind];
      if (group.work >= PRODUCT_HTTP_LIMITS[scope.kind].work) {
        group.rejected++;
        response.setHeader('Cache-Control', 'no-store');
        response.status(429).json({ error: 'RATE_LIMITED' });
        return;
      }
      group.work++;
      try {
        // Disconnecting the HTTP client cannot free unfinished audit/grant work capacity.
        await handler(request, response, next);
      } finally {
        group.work--;
      }
    };
  }

  get retained() {
    return Object.fromEntries(
      Object.entries(this.groups).map(([kind, group]) => [
        kind,
        {
          active: group.active,
          work: group.work,
          rejected: group.rejected,
          ...group.keys.retained,
        },
      ]),
    );
  }

  get totals() {
    return Object.values(this.groups).reduce(
      (sum, group) => ({
        active: sum.active + group.active,
        work: sum.work + group.work,
        rejected: sum.rejected + group.rejected,
      }),
      { active: 0, work: 0, rejected: 0 },
    );
  }
}

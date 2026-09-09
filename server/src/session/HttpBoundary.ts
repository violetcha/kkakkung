/**
 * Common HTTP entry boundary installed in front of every request listener, including the
 * Colyseus matchmaking router. It runs before `/matchmake/*`, OPTIONS pre-flight and Express:
 *
 * - Origin: an absent header is allowed (development CLI/health, server-to-server); a present
 *   header must exactly match one allowed http/https origin. `null`, empty and multiple
 *   origins are rejected with 403 before any body is read or seat reserved.
 * - Body: JSON bodies on matchmaking and `/api/*` routes are capped at 2,048 UTF-8 bytes,
 *   checked by Content-Length first and by actual received bytes for chunked bodies. Oversized
 *   requests end with 413 and never reach a downstream parser. The LiveKit webhook raw-body
 *   path is excluded so E can verify the provider signature on the original bytes.
 *
 * The WebSocket transport applies the same origin policy in `beforeUpgrade`.
 */
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

export const HTTP_BODY_LIMIT_BYTES = 2048;

export type OriginVerdict = 'allowed' | 'absent' | 'rejected';

export function checkOrigin(
  origin: string | string[] | undefined,
  allowedOrigins: readonly string[],
): OriginVerdict {
  if (origin === undefined) return 'absent';
  if (Array.isArray(origin)) return 'rejected';
  if (origin === '' || origin === 'null' || origin.includes(',') || /\s/.test(origin))
    return 'rejected';
  return allowedOrigins.includes(origin) ? 'allowed' : 'rejected';
}

export type BoundaryPolicy = Readonly<{
  allowedOrigins: readonly string[];
  /** Paths whose bodies are size-capped and pre-read. Prefix match. */
  cappedPrefixes?: readonly string[];
  /** Exact paths whose bodies are left untouched (raw-body signature verification). */
  rawBodyPaths?: readonly string[];
  bodyLimitBytes?: number;
  onRejected?: (info: { path: string; status: number; code: string }) => void;
}>;

type Listener = (req: IncomingMessage, res: ServerResponse) => void;

function reject(res: ServerResponse, status: number, code: string) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: code }));
}

/**
 * Wraps every existing `request` listener on the server. Call after the Colyseus server has
 * bound its routes (after `listen()` resolves) so the boundary owns the outermost position.
 */
export function installHttpBoundary(server: HttpServer, policy: BoundaryPolicy) {
  const limit = policy.bodyLimitBytes ?? HTTP_BODY_LIMIT_BYTES;
  const cappedPrefixes = policy.cappedPrefixes ?? ['/matchmake/', '/api/'];
  const rawBodyPaths = new Set(policy.rawBodyPaths ?? []);
  const downstream = server.listeners('request') as Listener[];
  server.removeAllListeners('request');
  const run = (req: IncomingMessage, res: ServerResponse) => {
    for (const listener of downstream) {
      try {
        const result = listener.call(server, req, res) as unknown;
        if (result && typeof (result as Promise<unknown>).catch === 'function')
          (result as Promise<unknown>).catch(() => undefined);
      } catch {
        reject(res, 500, 'INTERNAL_ERROR');
      }
    }
  };
  const boundary: Listener = (req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const verdict = checkOrigin(req.headers.origin, policy.allowedOrigins);
    if (verdict === 'rejected') {
      policy.onRejected?.({ path, status: 403, code: 'ORIGIN_NOT_ALLOWED' });
      reject(res, 403, 'ORIGIN_NOT_ALLOWED');
      req.resume();
      return;
    }
    const method = req.method ?? 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    const capped =
      hasBody && !rawBodyPaths.has(path) && cappedPrefixes.some((p) => path.startsWith(p));
    if (!capped) {
      run(req, res);
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      policy.onRejected?.({ path, status: 413, code: 'PAYLOAD_TOO_LARGE' });
      reject(res, 413, 'PAYLOAD_TOO_LARGE');
      req.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let finished = false;
    req.on('data', (chunk: Buffer) => {
      if (finished) return;
      received += chunk.length;
      if (received > limit) {
        finished = true;
        policy.onRejected?.({ path, status: 413, code: 'PAYLOAD_TOO_LARGE' });
        reject(res, 413, 'PAYLOAD_TOO_LARGE');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      const contentType = String(req.headers['content-type'] ?? '');
      const target = req as IncomingMessage & { body?: unknown; _body?: boolean };
      if (contentType.includes('application/json')) {
        try {
          target.body = raw ? JSON.parse(raw) : {};
        } catch {
          policy.onRejected?.({ path, status: 400, code: 'INVALID_JSON' });
          reject(res, 400, 'INVALID_JSON');
          return;
        }
      } else target.body = raw;
      target._body = true;
      run(req, res);
    });
    req.on('error', () => {
      if (!finished) {
        finished = true;
        reject(res, 400, 'INVALID_REQUEST');
      }
    });
  };
  server.on('request', boundary);
  return { downstreamCount: downstream.length };
}

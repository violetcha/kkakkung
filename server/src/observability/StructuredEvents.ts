// Owned by F (F-07 / DP-05). Structured operational events and the Pino log guard.
//
// B assembles `pino({ ...createLogOptions(...) })` in bootstrap and passes the resulting
// logger to `createStructuredEventLogger`. E emits the same `StructuredEvent` type from its
// observability callback. Neither owner edits this file; new event names or field keys are an
// F handoff change.
//
// What the guard enforces on every log line, whether it came through the event helper or a
// direct `logger.info({...})` call:
// - keys matching a secret/identity/media pattern are removed (key name kept, value gone);
// - objects deeper than MAX_DEPTH or wider than MAX_KEYS are cut off;
// - strings longer than MAX_STRING are truncated so an SDP or a base64 frame cannot land in a
//   log file even by accident.
// The guard never throws; a failure to sanitize produces `{ observability: 'formatter_failed' }`.

import type { LoggerOptions } from 'pino';

export const EVENT_NAMES = Object.freeze([
  'server.started',
  'server.ready',
  'server.locked',
  'tick.overload',
  'media.policy.uncertain',
  'media.retirement.unresolved',
  'media.retirement.resolved',
  'media.api.rate_limited',
  'media.budget.near_limit',
  'operations.journal.write_failed',
  'operations.drain',
  'operations.resume',
  'operations.checkpoint',
  'alert.raised',
  'alert.cleared',
  'alert.notify.failed',
  'observability.dropped',
  'room.phase',
  'room.preparation_failed',
  'room.match_aborted',
  'room.command_rejected',
  'room.load_ready',
  'room.heartbeat_stall',
  'room.media_uncertain_released',
  /** S15P21C204-408. 방이 미디어 바인딩을 클라이언트에 보내지 않고 버렸다. */
  'room.media_bindings_dropped',
  'room.uncaught_exception',
  'process.fault',
  'media.prepare_failed',
  'media.api.failed',
  'media.webhook',
] as const);

export type StructuredEventName = (typeof EVENT_NAMES)[number];

export type StructuredEventLevel = 'info' | 'warn' | 'error';

/** Field keys an event may carry. Values are scalars only. */
export const EVENT_FIELD_KEYS = Object.freeze([
  'matchRef',
  'generation',
  'requestId',
  'operationId',
  'retirementId',
  'alert',
  'severity',
  'code',
  'reason',
  'state',
  'value',
  'unit',
  'limit',
  'count',
  'durationMs',
  'port',
  'stage',
  'name',
  'evidence',
  'roomRef',
  'phase',
  'outcome',
  'total',
  'reported',
  'faceConfirmed',
  'unresolvedMedia',
  'method',
  'status',
  'command',
  /** S15P21C204-370. 연결이 끊겨 무효가 된 판에서 끊긴 도망자·술래 수. */
  'lostRunners',
  'lostTaggers',
] as const);

export type StructuredEventFieldKey = (typeof EVENT_FIELD_KEYS)[number];

export type StructuredEventFields = Partial<
  Record<StructuredEventFieldKey, string | number | boolean | null>
>;

export type StructuredEvent = Readonly<{
  event: StructuredEventName;
  level: StructuredEventLevel;
  /** Monotonic server time in ms, same clock as MetricSample.atMs. */
  atMs: number;
  fields?: StructuredEventFields;
}>;

/** Keys whose value is never written to a log line. Matched case-insensitively on every nesting level. */
export const REDACTED_KEY_PATTERNS = Object.freeze([
  /token/i,
  /jwt/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /cookie/i,
  /sdp/i,
  /nickname/i,
  /identity/i,
  /^map$/i,
  /seed/i,
  /exit/i,
  /position/i,
  /^(x|y|z)$/i,
  /frame/i,
  /audio/i,
  /apiKey/i,
]);

export const LOG_LIMITS = Object.freeze({
  MAX_DEPTH: 3,
  MAX_KEYS: 32,
  MAX_STRING: 512,
  MAX_ARRAY: 32,
});

const REDACTED = '[redacted]';
const TRUNCATED = '[truncated]';

function isRedactedKey(key: string): boolean {
  return REDACTED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'string':
      return value.length > LOG_LIMITS.MAX_STRING
        ? `${value.slice(0, LOG_LIMITS.MAX_STRING)}${TRUNCATED}`
        : value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }
  if (depth >= LOG_LIMITS.MAX_DEPTH) return TRUNCATED;
  if (Array.isArray(value)) {
    const out = value.slice(0, LOG_LIMITS.MAX_ARRAY).map((v) => sanitizeValue(v, depth + 1));
    if (value.length > LOG_LIMITS.MAX_ARRAY) out.push(TRUNCATED);
    return out;
  }
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeValue(value.message, depth + 1) };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let keys = 0;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (keys >= LOG_LIMITS.MAX_KEYS) {
        out.__truncated = true;
        break;
      }
      keys += 1;
      if (isRedactedKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      const sanitized = sanitizeValue(v, depth + 1);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }
  return undefined;
}

/**
 * Sanitizes one log payload. Exported for the contract test and for E's evidence writer.
 * Never throws.
 */
export function sanitizeLogObject(input: unknown): Record<string, unknown> {
  try {
    const out = sanitizeValue(input, 0);
    if (typeof out === 'object' && out !== null && !Array.isArray(out))
      return out as Record<string, unknown>;
    return { value: out };
  } catch {
    return { observability: 'formatter_failed' };
  }
}

export type LogOptionsInput = Readonly<{
  level: string;
  /** Written as `base.service`; use the deployment namespace, not the LiveKit project alias. */
  service: string;
}>;

/**
 * Pino options with the F log guard installed. B spreads this into `pino(...)`. The `log`
 * formatter runs on every line; `redact` is kept as a second layer for well-known top-level
 * paths so an accidental change to the formatter still cannot print a bearer token.
 */
export function createLogOptions(input: LogOptionsInput): LoggerOptions {
  return {
    level: input.level,
    base: { service: input.service },
    redact: {
      paths: [
        'token',
        'jwt',
        'secret',
        'password',
        'authorization',
        'req.headers.authorization',
        'req.headers.cookie',
        'sdp',
        'rawSdp',
      ],
      censor: REDACTED,
    },
    formatters: {
      log: (object) => sanitizeLogObject(object),
    },
  };
}

export type EventValidation =
  | Readonly<{ ok: true; event: StructuredEvent }>
  | Readonly<{
      ok: false;
      reason: 'NOT_AN_OBJECT' | 'UNKNOWN_EVENT' | 'BAD_LEVEL' | 'BAD_TIME' | 'BAD_FIELD';
      field?: string;
    }>;

const LEVELS: readonly StructuredEventLevel[] = ['info', 'warn', 'error'];

/** Validates an untrusted event against the static allowlists. Pure and non-throwing. */
export function validateEvent(input: unknown): EventValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { ok: false, reason: 'NOT_AN_OBJECT' };
  const record = input as Record<string, unknown>;
  const { event, level, atMs, fields } = record;
  if (typeof event !== 'string' || !(EVENT_NAMES as readonly string[]).includes(event))
    return { ok: false, reason: 'UNKNOWN_EVENT', field: 'event' };
  if (typeof level !== 'string' || !(LEVELS as readonly string[]).includes(level))
    return { ok: false, reason: 'BAD_LEVEL', field: 'level' };
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0)
    return { ok: false, reason: 'BAD_TIME', field: 'atMs' };
  let cleanFields: StructuredEventFields | undefined;
  if (fields !== undefined) {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields))
      return { ok: false, reason: 'BAD_FIELD', field: 'fields' };
    cleanFields = {};
    for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
      if (isRedactedKey(key) || !(EVENT_FIELD_KEYS as readonly string[]).includes(key))
        return { ok: false, reason: 'BAD_FIELD', field: key };
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      )
        return { ok: false, reason: 'BAD_FIELD', field: key };
      if (typeof value === 'string' && value.length > LOG_LIMITS.MAX_STRING)
        return { ok: false, reason: 'BAD_FIELD', field: key };
      cleanFields[key as StructuredEventFieldKey] = value;
    }
  }
  return {
    ok: true,
    event: {
      event: event as StructuredEventName,
      level: level as StructuredEventLevel,
      atMs,
      ...(cleanFields ? { fields: cleanFields } : {}),
    },
  };
}

export type EventSink = Readonly<{
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}>;

export type StructuredEventLogger = Readonly<{
  /** Validates and writes one event. Returns false when the event was rejected; never throws. */
  emit: (event: unknown) => boolean;
  rejected: () => number;
}>;

/**
 * Wraps a Pino-like logger. Rejected events are counted and reported as one `warn` line with
 * the reason and field name only, so a bad producer is visible without leaking its payload.
 */
export function createStructuredEventLogger(sink: EventSink): StructuredEventLogger {
  let rejected = 0;
  return {
    emit(input) {
      try {
        const result = validateEvent(input);
        if (!result.ok) {
          rejected += 1;
          sink.warn(
            { observability: 'event_rejected', reason: result.reason, field: result.field ?? null },
            'structured event rejected',
          );
          return false;
        }
        const { event, level, atMs, fields } = result.event;
        sink[level]({ event, atMs, ...(fields ?? {}) }, event);
        return true;
      } catch {
        rejected += 1;
        return false;
      }
    },
    rejected: () => rejected,
  };
}

/**
 * Turns an unknown thrown value into a short diagnostic code for a log line: a GatewayError
 * code, an UPPER_SNAKE message such as STALE_GENERATION, or the error name. Never a message
 * body, never a secret; returns 'REQUEST_FAILED' when nothing safe is available.
 */
export function diagnosticCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z_][A-Za-z0-9_]{1,63}$/.test(code)) return code;
    if (error instanceof Error) {
      if (/^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)) return error.message;
      if (error.name && error.name !== 'Error') return error.name;
    }
  }
  return 'REQUEST_FAILED';
}

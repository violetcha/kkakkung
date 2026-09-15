import { z } from 'zod';
import { MEDIA_API_CEILINGS } from '../operations/ApiBudget.js';

// Owned by F (F-01/DP-01). B maps the parsed values into
// MediaConfiguration / admission policy; E never reads process.env directly.
//
// NODE_ENV production stays blocked until the deployment gate is accepted. The explicit
// product profile can run locally with real game modules; disabled media never implies readiness.
// New optional groups are additive. A group is either fully present or absent; a partial
// group is a configuration error, never a silent default.

const positiveSafeInt = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();
const nonEmpty = z.string().min(1).optional();
const httpUrl = z
  .string()
  .min(1)
  .refine((s) => {
    try {
      return ['http:', 'https:'].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  }, 'must be an http(s) URL')
  .optional();
const wsUrl = z
  .string()
  .min(1)
  .refine((s) => {
    try {
      return ['ws:', 'wss:'].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  }, 'must be a ws(s) URL')
  .optional();

const environment = z.object({
  NODE_ENV: z.enum(['development', 'test']).default('development'),
  SERVER_PROFILE: z.enum(['development', 'product']).default('development'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  SERVICE_AUDIENCE: z.enum(['team', 'public']).optional(),
  SESSION_ADMISSION_MODE: z.enum(['invitation', 'gitlab-sso', 'guest']).optional(),
  PRODUCT_ASSET_VERSION: z.string().min(1).default('c-primitives-1'),
  PRODUCT_CONTENT_DIR: z.string().min(1).default('server/content'),
  PRODUCT_TUNING_PATH: z.string().min(1).default('server/config/tuning/mvp-v1.json'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:2567,http://127.0.0.1:2567',
    ),
  SERVICE_NAMESPACE: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('kkakkung-local'),
  MEDIA_MODE: z.enum(['disabled', 'livekit']).default('disabled'),
  MEDIA_SUBSCRIPTION_MODE: z
    .enum(['server-controlled', 'publisher-permissions'])
    .default('server-controlled'),
  // Capacity: one room is six seats. The service cap is rooms * 6 and only rooms that were
  // actually load-tested may be opened (QA-10/QA-11 raise this step by step).
  MAX_ROOMS: z.coerce.number().int().min(1).max(10).default(1),
  MAX_SLOTS: z.coerce.number().int().min(6).max(60).default(6),
  OPS_DATA_DIR: z.string().default('./.local/operations'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  // LiveKit Cloud (E-05 / MC-02). Secrets are injected by the runtime environment only.
  LIVEKIT_HTTP_URL: httpUrl,
  LIVEKIT_WS_URL: wsUrl,
  LIVEKIT_API_KEY: nonEmpty,
  LIVEKIT_API_SECRET: nonEmpty,
  LIVEKIT_PROJECT_ALIAS: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),

  // Operator API token (E OP-07). Separate from session bearer tokens.
  OPS_TOKEN: nonEmpty,

  // Public window and budget policy (E operations).
  OPS_OPERATING_MODE: z.enum(['attested', 'continuous']).default('attested'),
  OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS: positiveSafeInt,
  OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS: positiveSafeInt,
  OPS_OFFICIAL_BUDGET_MAX_AGE_MS: positiveSafeInt,
  OPS_OPERATION_TIMEOUT_MS: positiveSafeInt,
  MEDIA_MAX_NORMAL_API_CALLS_PER_60S: z.coerce
    .number()
    .int()
    .positive()
    .max(MEDIA_API_CEILINGS.normalPer60s)
    .optional(),
  MEDIA_MAX_TOTAL_API_CALLS_PER_60S: z.coerce
    .number()
    .int()
    .positive()
    .max(MEDIA_API_CEILINGS.totalPer60s)
    .optional(),

  // Invite and admission policy (B AC-01/AC-02). No implicit defaults: unset means LOCKED.
  INVITE_MAX_TTL_MS: positiveSafeInt,
  SESSION_ATTEMPT_WINDOW_MS: positiveSafeInt,
  SESSION_ATTEMPTS_PER_INVITE: positiveSafeInt,
  SESSION_ATTEMPTS_PER_IP: positiveSafeInt,
  ROOM_IDLE_TTL_MS: positiveSafeInt,
});

type Raw = z.infer<typeof environment>;

function group<K extends keyof Raw>(raw: Raw, keys: readonly K[], name: string) {
  const present = keys.filter((k) => raw[k] !== undefined);
  if (present.length === 0) return null;
  if (present.length !== keys.length) {
    const missing = keys.filter((k) => raw[k] === undefined).join(', ');
    throw new Error(`Incomplete ${name} configuration: missing ${missing}`);
  }
  return raw as Raw & { [P in K]-?: NonNullable<Raw[P]> };
}

export function parseConfig(input: Record<string, string | undefined>) {
  // An empty value in an env file (KEY=) means "not configured", the same as an absent key.
  // Existing server/.env files from the older template keep working; a configured group must
  // still be complete, which the group checks below enforce.
  const env = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = environment.safeParse(env);
  if (!parsed.success) {
    // Report names only; never echo environment values or secrets.
    throw new Error(
      `Unsupported server configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}. NODE_ENV production remains gated on deployment verification.`,
    );
  }
  const raw = parsed.data;
  const audienceMode =
    raw.SERVICE_AUDIENCE === 'team'
      ? 'gitlab-sso'
      : raw.SERVICE_AUDIENCE === 'public'
        ? 'guest'
        : null;
  if (audienceMode && raw.SESSION_ADMISSION_MODE && raw.SESSION_ADMISSION_MODE !== audienceMode)
    throw new Error('SERVICE_AUDIENCE conflicts with SESSION_ADMISSION_MODE');
  const sessionAdmissionMode = audienceMode ?? raw.SESSION_ADMISSION_MODE ?? 'invitation';
  if (sessionAdmissionMode === 'guest' && raw.SERVICE_AUDIENCE !== 'public')
    throw new Error('Guest admission requires explicit SERVICE_AUDIENCE public');
  if (
    (raw.SERVICE_AUDIENCE !== undefined || sessionAdmissionMode === 'gitlab-sso') &&
    (raw.SERVER_PROFILE !== 'product' || raw.TRUST_PROXY_HOPS !== 1)
  )
    throw new Error('Audience admission requires the product profile and trusted proxy');
  // W02 must supply an accepted product authority path before public LiveKit can start.
  // MC-PUBLIC-02 validates a transport candidate, not these legacy product modes.
  if (raw.SERVICE_AUDIENCE === 'public' && raw.MEDIA_MODE === 'livekit')
    throw new Error('PUBLIC_MEDIA_AUTHORITY_NOT_IMPLEMENTED');
  const allowedOrigins = raw.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  if (
    !allowedOrigins.length ||
    allowedOrigins.some((s) => {
      try {
        const u = new URL(s);
        return !['http:', 'https:'].includes(u.protocol) || u.origin !== s;
      } catch {
        return true;
      }
    })
  )
    throw new Error('ALLOWED_ORIGINS must contain exact HTTP origins');
  if (raw.MAX_SLOTS !== raw.MAX_ROOMS * 6)
    throw new Error('MAX_SLOTS must equal MAX_ROOMS * 6 (six seats per room)');

  const livekit = group(
    raw,
    ['LIVEKIT_HTTP_URL', 'LIVEKIT_WS_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const,
    'LiveKit',
  );
  const publicWindow = group(
    raw,
    ['OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS', 'OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS'] as const,
    'public window',
  );
  if (
    publicWindow &&
    publicWindow.OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS >=
      publicWindow.OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS
  )
    throw new Error('OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS must be before the close time');
  const apiLimits = group(
    raw,
    ['MEDIA_MAX_NORMAL_API_CALLS_PER_60S', 'MEDIA_MAX_TOTAL_API_CALLS_PER_60S'] as const,
    'media API limit',
  );
  if (
    apiLimits &&
    apiLimits.MEDIA_MAX_NORMAL_API_CALLS_PER_60S > apiLimits.MEDIA_MAX_TOTAL_API_CALLS_PER_60S
  )
    throw new Error('MEDIA_MAX_NORMAL_API_CALLS_PER_60S must not exceed the total limit');
  const admission = group(
    raw,
    [
      'INVITE_MAX_TTL_MS',
      'SESSION_ATTEMPT_WINDOW_MS',
      'SESSION_ATTEMPTS_PER_INVITE',
      'SESSION_ATTEMPTS_PER_IP',
      'ROOM_IDLE_TTL_MS',
    ] as const,
    'admission policy',
  );

  if (raw.SERVER_PROFILE === 'development' && raw.MEDIA_MODE !== 'disabled') {
    throw new Error('MEDIA_MODE livekit requires SERVER_PROFILE product');
  }
  if (raw.SERVER_PROFILE === 'product' && !admission) {
    throw new Error('SERVER_PROFILE product requires an explicit admission policy');
  }
  if (raw.MEDIA_MODE === 'livekit') {
    const required = [
      ['LiveKit', livekit],
      ['LIVEKIT_PROJECT_ALIAS', raw.LIVEKIT_PROJECT_ALIAS],
      ['OPS_TOKEN', raw.OPS_TOKEN],
      ['public window', raw.OPS_OPERATING_MODE === 'continuous' || publicWindow],
      [
        'OPS_OFFICIAL_BUDGET_MAX_AGE_MS',
        raw.OPS_OPERATING_MODE === 'continuous' || raw.OPS_OFFICIAL_BUDGET_MAX_AGE_MS,
      ],
      ['OPS_OPERATION_TIMEOUT_MS', raw.OPS_OPERATION_TIMEOUT_MS],
      ['media API limits', apiLimits],
    ] as const;
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length)
      throw new Error(`Incomplete product media configuration: ${missing.join(', ')}`);
    const http = new URL(livekit!.LIVEKIT_HTTP_URL);
    const ws = new URL(livekit!.LIVEKIT_WS_URL);
    if (
      http.protocol !== 'https:' ||
      ws.protocol !== 'wss:' ||
      http.host !== ws.host ||
      [http, ws].some(
        (url) => url.username || url.password || url.search || url.hash || url.pathname !== '/',
      )
    ) {
      throw new Error('Product LiveKit endpoints must be matching HTTPS/WSS origins');
    }
    // Complete configuration is not Cloud proof: E still verifies durable readiness evidence.
  }

  return {
    serverProfile: raw.SERVER_PROFILE,
    trustProxyHops: raw.TRUST_PROXY_HOPS,
    assetVersion: raw.PRODUCT_ASSET_VERSION,
    contentDir: raw.PRODUCT_CONTENT_DIR,
    tuningPath: raw.PRODUCT_TUNING_PATH,
    host: raw.HOST,
    port: raw.PORT,
    allowedOrigins,
    namespace: raw.SERVICE_NAMESPACE,
    mediaMode: raw.MEDIA_MODE,
    maxRooms: raw.MAX_ROOMS,
    maxSlots: raw.MAX_SLOTS,
    opsDataDir: raw.OPS_DATA_DIR,
    logLevel: raw.LOG_LEVEL,
    livekit: livekit
      ? {
          httpUrl: livekit.LIVEKIT_HTTP_URL,
          wsUrl: livekit.LIVEKIT_WS_URL,
          apiKey: livekit.LIVEKIT_API_KEY,
          apiSecret: livekit.LIVEKIT_API_SECRET,
          projectAlias: raw.LIVEKIT_PROJECT_ALIAS ?? null,
        }
      : null,
    opsToken: raw.OPS_TOKEN ?? null,
    serviceAudience: raw.SERVICE_AUDIENCE ?? null,
    sessionAdmissionMode,
    operatingMode: raw.OPS_OPERATING_MODE,
    subscriptionMode: raw.MEDIA_SUBSCRIPTION_MODE,
    publicWindow:
      raw.OPS_OPERATING_MODE === 'continuous'
        ? { mode: 'continuous' as const }
        : publicWindow
          ? {
              opensAtEpochMs: publicWindow.OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS,
              closesAtEpochMs: publicWindow.OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS,
            }
          : null,
    officialBudgetMaxAgeMs:
      raw.OPS_OPERATING_MODE === 'continuous' ? 0 : (raw.OPS_OFFICIAL_BUDGET_MAX_AGE_MS ?? null),
    operationTimeoutMs: raw.OPS_OPERATION_TIMEOUT_MS ?? null,
    mediaApiLimits: apiLimits
      ? {
          maxNormalApiCallsPer60s: apiLimits.MEDIA_MAX_NORMAL_API_CALLS_PER_60S,
          maxTotalApiCallsPer60s: apiLimits.MEDIA_MAX_TOTAL_API_CALLS_PER_60S,
        }
      : null,
    admission: admission
      ? {
          inviteMaxTtlMs: admission.INVITE_MAX_TTL_MS,
          sessionAttemptWindowMs: admission.SESSION_ATTEMPT_WINDOW_MS,
          sessionAttemptsPerInvite: admission.SESSION_ATTEMPTS_PER_INVITE,
          sessionAttemptsPerIp: admission.SESSION_ATTEMPTS_PER_IP,
          roomIdleTtlMs: admission.ROOM_IDLE_TTL_MS,
        }
      : null,
  };
}

export type AppConfig = ReturnType<typeof parseConfig>;

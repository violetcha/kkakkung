import { z } from 'zod';
import { MEDIA_API_CEILINGS } from '../operations/ApiBudget.js';
import { validateMonthlyUsageConfig, type MonthlyUsageConfig } from '../media/MonthlyUsageMeter.js';

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
  PRODUCT_TUNING_PATH: z.string().min(1).default('server/config/tuning/mvp-v4.json'),
  // S15P21C204-267. Which certified template under PRODUCT_CONTENT_DIR the product room plays:
  // maps/<id>.json with placements/<id>-fallback.json. S15P21C204-302 made the corridor maze the
  // default; the open grid master-v1 stays certified and selectable for load and regression runs.
  PRODUCT_MAP_TEMPLATE: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('maze-v1'),
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
  // S15P21C204-372. 동시에 열어 둘 수 있는 일반 방(대기방) 수. 방 만들기가 쓰는 예산이다.
  // MAX_ROOMS 는 이제 동시에 진행하는 경기(연습~경기, LiveKit 사용) 수다. 로비는 가벼워 넉넉히
  // 두고, 경기만 부하 시험으로 검증한 수로 묶는다. 생략하면 MAX_ROOMS 와 같다(예전 동작).
  LOBBY_MAX_ROOMS: z.coerce.number().int().min(1).max(50).optional(),
  // S15P21C204-300. 한 출처(IPv4 주소 또는 IPv6 /64)가 동시에 열어 둘 수 있는 방 수. 공유
  // NAT 뒤에서는 여러 사람이 한 출처로 묶이므로 "한 사람" 이 아니라 "한 회선" 기준이다.
  // 정상 6인은 방 하나에 초대로 모이므로 영향이 없다. 올리면 전역 예산을 한 회선이 더 많이
  // 가져갈 수 있고, 내리면 같은 망에서 동시에 두 팀이 놀기 어려워진다.
  MAX_ROOMS_PER_ORIGIN: z.coerce.number().int().min(1).max(10).default(2),
  // S15P21C204-366. 한 SSO 계정이 동시에 열어 둘 수 있는 방 수. 팀원은 IP 가 아니라 계정으로
  // 식별되므로 NAT 걱정 없이 "한 사람 한 방"으로 둔다.
  MAX_ROOMS_PER_ACCOUNT: z.coerce.number().int().min(1).max(10).default(1),
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

  // External alert delivery (S15P21C204-288). Critical alert transitions are posted to this
  // incoming webhook; unset keeps alerts log-only. The URL carries its key, so it is a secret.
  ALERT_WEBHOOK_URL: httpUrl,
  ALERT_WEBHOOK_CHANNEL: z
    .string()
    .regex(/^@?[a-z0-9][a-z0-9._-]{0,63}$/)
    .optional(),

  // Demo rooms (S15P21C204-258): an operator-only room with server-driven puppets, used to show
  // game situations without six people. Off unless explicitly enabled, and always behind OPS_TOKEN.
  DEMO_ROOMS: z.enum(['0', '1']).default('0'),
  // S15P21C204-312. A demo session may wait longer for the operator to open it than a player
  // admission; claiming it still changes the session to the ordinary activity lease.
  DEMO_ADMISSION_TTL_MS: positiveSafeInt.default(10 * 60_000),
  // S15P21C204-312. Demo rooms have their own room budget, outside MAX_ROOMS: they use no media,
  // and taking a match room for a demonstration left players one room short while it was open.
  DEMO_MAX_ROOMS: z.coerce.number().int().min(1).max(3).default(1),
  // 발표 시연 방(showcase): 팀원 넷이 2:2 로 고정 소형 미로에서 3분을 뛴다. `/showcase` 는 GitLab SSO
  // 뒤에 있고 운영 토큰은 필요 없다. S15P21C204-361. 동시에 모이는 중일 수 있는 시연 방 수다. 기본 1,
  // 발표 배포는 3. 0 으로 내리면 발급 API 가 503 으로 답한다. 시연 방은 MAX_ROOMS 와 따로 센다
  // (SlotRegistry 의 maxShowcaseRooms 예산).
  SHOWCASE_ROOMS: z.coerce.number().int().min(0).max(10).default(1),
  // S15P21C204-367. `/demo`·`/showcase` 를 여는 운영자 등록 이메일 파일(한 줄에 하나). 로그인
  // 게이트는 SSAFY GitLab 계정 전체를 통과시키므로 운영자 판정은 서버가 이 목록으로 한다.
  // 없으면 두 관리 경로는 아무도 통과시키지 않는다.
  DEMO_ADMIN_EMAILS_FILE: z.string().min(1).optional(),

  // S15P21C204-364. LiveKit monthly participant-minute guard. The plan limit and the dashboard
  // baseline ("<used minutes>@<ISO time read>") come together from the private env file; with
  // neither the guard is off and the server says so at start. One without the other is refused.
  LIVEKIT_MONTHLY_MINUTES: positiveSafeInt,
  LIVEKIT_USAGE_BASELINE: z.string().trim().min(1).optional(),
  LIVEKIT_MONTHLY_RESERVE_MINUTES: z.coerce.number().int().min(0).default(300),
  LIVEKIT_BILLING_CYCLE_DAY: z.coerce.number().int().min(1).max(28).default(1),

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
  // D-2026-09-15-01: public rooms keep publisher-permissions, whose Cloud capability passed MC-01.
  // server-controlled never proved reception on Cloud, so it stays refused for public LiveKit.
  if (
    raw.SERVICE_AUDIENCE === 'public' &&
    raw.MEDIA_MODE === 'livekit' &&
    raw.MEDIA_SUBSCRIPTION_MODE !== 'publisher-permissions'
  )
    throw new Error('PUBLIC_MEDIA_REQUIRES_PUBLISHER_PERMISSIONS');
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
  // 출처 상한이 전역 방 수 이상이면 상한이 아무것도 막지 않는다. 설정 실수로 조용히 꺼지지
  // 않게 부팅에서 거절한다(S15P21C204-300).
  if (raw.LOBBY_MAX_ROOMS !== undefined && raw.LOBBY_MAX_ROOMS < raw.MAX_ROOMS)
    throw new Error('LOBBY_MAX_ROOMS must not be below MAX_ROOMS');
  if (raw.MAX_ROOMS > 1 && raw.MAX_ROOMS_PER_ORIGIN >= raw.MAX_ROOMS)
    throw new Error('MAX_ROOMS_PER_ORIGIN must be below MAX_ROOMS');
  if (raw.MAX_ROOMS > 1 && raw.MAX_ROOMS_PER_ACCOUNT >= raw.MAX_ROOMS)
    throw new Error('MAX_ROOMS_PER_ACCOUNT must be below MAX_ROOMS');
  // S15P21C204-364. The limit and the baseline mean nothing apart: a limit without a baseline
  // would count from zero and let the month overrun, a baseline without a limit guards nothing.
  if ((raw.LIVEKIT_MONTHLY_MINUTES === undefined) !== (raw.LIVEKIT_USAGE_BASELINE === undefined))
    throw new Error('LIVEKIT_MONTHLY_MINUTES and LIVEKIT_USAGE_BASELINE must be set together');
  let monthlyUsage: MonthlyUsageConfig | null = null;
  if (raw.LIVEKIT_MONTHLY_MINUTES !== undefined && raw.LIVEKIT_USAGE_BASELINE !== undefined) {
    const match = /^(\d+)@(.+)$/.exec(raw.LIVEKIT_USAGE_BASELINE);
    const readAt = match ? Date.parse(match[2]!) : Number.NaN;
    if (!match || !Number.isSafeInteger(readAt))
      throw new Error('LIVEKIT_USAGE_BASELINE must look like "<minutes>@<ISO-8601 time>"');
    monthlyUsage = validateMonthlyUsageConfig({
      limitMinutes: raw.LIVEKIT_MONTHLY_MINUTES,
      reserveMinutes: raw.LIVEKIT_MONTHLY_RESERVE_MINUTES,
      baselineMinutes: Number(match[1]),
      baselineAtEpochMs: readAt,
      cycleDay: raw.LIVEKIT_BILLING_CYCLE_DAY,
    });
  }
  if (raw.ALERT_WEBHOOK_CHANNEL !== undefined && raw.ALERT_WEBHOOK_URL === undefined)
    throw new Error('ALERT_WEBHOOK_CHANNEL requires ALERT_WEBHOOK_URL');
  if (raw.ALERT_WEBHOOK_URL !== undefined) {
    const url = new URL(raw.ALERT_WEBHOOK_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('ALERT_WEBHOOK_URL must be an https URL without credentials');
  }

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
    mapTemplate: raw.PRODUCT_MAP_TEMPLATE,
    host: raw.HOST,
    port: raw.PORT,
    allowedOrigins,
    namespace: raw.SERVICE_NAMESPACE,
    mediaMode: raw.MEDIA_MODE,
    maxRooms: raw.MAX_ROOMS,
    maxSlots: raw.MAX_SLOTS,
    lobbyMaxRooms: raw.LOBBY_MAX_ROOMS ?? raw.MAX_ROOMS,
    maxRoomsPerOrigin: raw.MAX_ROOMS_PER_ORIGIN,
    maxRoomsPerAccount: raw.MAX_ROOMS_PER_ACCOUNT,
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
    alertWebhook: raw.ALERT_WEBHOOK_URL
      ? { url: raw.ALERT_WEBHOOK_URL, channel: raw.ALERT_WEBHOOK_CHANNEL ?? null }
      : null,
    // The operator token is the only way in, so a demo room without it is never opened.
    demoRooms: raw.DEMO_ROOMS === '1' && raw.OPS_TOKEN !== undefined,
    demoAdmissionTtlMs: raw.DEMO_ADMISSION_TTL_MS,
    demoMaxRooms: raw.DEMO_MAX_ROOMS,
    livekitMonthlyUsage: monthlyUsage,
    showcaseRooms: raw.SHOWCASE_ROOMS,
    demoAdminEmailsFile: raw.DEMO_ADMIN_EMAILS_FILE ?? null,
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

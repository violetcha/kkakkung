#!/usr/bin/env node
// S15P21C204-304. Host-side LiveKit Cloud participant-minute monitor.
//
// LiveKit's Analytics API is the provider-side source of truth when the project plan exposes
// it. The API only permits a seven-day query window, so this job keeps a small, restart-safe
// month ledger keyed by session id. The first run requires an operator-provided dashboard
// baseline for the current month; later runs add only the greatest connectionMinutes observed
// for each session. No room names, participant identities, tokens or webhook URLs are written.
//
//   node scripts/check-livekit-usage.mjs --state /opt/kkakkung/livekit-usage-state.json
//   LIVEKIT_USAGE_DRY_RUN=1 node scripts/check-livekit-usage.mjs --state <file>
//
// Exit codes: 0 checked and delivered, 1 provider/notification failure, 2 configuration or
// usage error, 3 Analytics API is unavailable or credentials are rejected.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessToken } from 'livekit-server-sdk';

export const USAGE_POLICY = Object.freeze({
  pageLimit: 100,
  maxPages: 100,
  apiTimeoutMs: 15_000,
  sendTimeoutMs: 10_000,
  remindEveryMs: 60 * 60_000,
  maxCoverageGapMs: 7 * 24 * 60 * 60_000,
});

export const INITIAL_USAGE_STATE = Object.freeze({
  version: 1,
  periodId: null,
  baselineMinutes: null,
  sessions: {},
  lastSuccessfulAtMs: null,
  lastNoticeAtMs: null,
  lastLevel: 'normal',
  lastFailureCode: null,
  lastFailureNoticeAtMs: null,
});

const LEVELS = Object.freeze(['normal', 'warning', 'critical', 'exhausted']);
const PROJECT_ID = /^p_[A-Za-z0-9_-]{2,255}$/;

export class UsageMonitorError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
    this.name = 'UsageMonitorError';
  }
}

function integerNonnegative(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function monthPeriodId(atMs) {
  const date = new Date(atMs);
  if (!Number.isFinite(date.getTime())) throw new UsageMonitorError('INVALID_TIME');
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function analyticsWindow(atMs) {
  const end = new Date(atMs);
  if (!Number.isFinite(end.getTime())) throw new UsageMonitorError('INVALID_TIME');
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60_000);
  const date = (value) => value.toISOString().slice(0, 10);
  return { start: date(start), end: date(end) };
}

export function readUsageState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ...INITIAL_USAGE_STATE, sessions: {} };
  const input = value;
  const sessions = {};
  if (input.sessions && typeof input.sessions === 'object' && !Array.isArray(input.sessions)) {
    for (const [sessionId, raw] of Object.entries(input.sessions)) {
      const minutes = typeof raw === 'number' ? raw : raw?.minutes;
      const observedAtMs = typeof raw === 'object' ? raw?.observedAtMs : null;
      if (
        typeof sessionId === 'string' &&
        sessionId.length > 0 &&
        sessionId.length <= 256 &&
        integerNonnegative(minutes) &&
        integerNonnegative(observedAtMs)
      )
        sessions[sessionId] = { minutes, observedAtMs };
    }
  }
  const lastLevel = LEVELS.includes(input.lastLevel) ? input.lastLevel : 'normal';
  return {
    version: 1,
    periodId: typeof input.periodId === 'string' ? input.periodId : null,
    baselineMinutes: integerNonnegative(input.baselineMinutes) ? input.baselineMinutes : null,
    sessions,
    lastSuccessfulAtMs: integerNonnegative(input.lastSuccessfulAtMs)
      ? input.lastSuccessfulAtMs
      : null,
    lastNoticeAtMs: integerNonnegative(input.lastNoticeAtMs) ? input.lastNoticeAtMs : null,
    lastLevel,
    lastFailureCode: typeof input.lastFailureCode === 'string' ? input.lastFailureCode : null,
    lastFailureNoticeAtMs: integerNonnegative(input.lastFailureNoticeAtMs)
      ? input.lastFailureNoticeAtMs
      : null,
  };
}

export function summarizeUsage(stateValue, atMs, thresholds) {
  const state = readUsageState(stateValue);
  const periodId = monthPeriodId(atMs);
  const baselineMinutes = state.periodId === periodId ? (state.baselineMinutes ?? 0) : 0;
  const observedMinutes = Object.values(state.periodId === periodId ? state.sessions : {}).reduce(
    (sum, session) => sum + session.minutes,
    baselineMinutes,
  );
  const remainingMinutes = Math.max(0, thresholds.allowanceMinutes - observedMinutes);
  const level =
    observedMinutes >= thresholds.allowanceMinutes
      ? 'exhausted'
      : observedMinutes >= thresholds.criticalMinutes
        ? 'critical'
        : observedMinutes >= thresholds.warningMinutes
          ? 'warning'
          : 'normal';
  return {
    periodId,
    baselineMinutes,
    observedMinutes,
    remainingMinutes,
    level,
    lastSuccessfulAtMs: state.periodId === periodId ? state.lastSuccessfulAtMs : null,
  };
}

export function thresholdsFromEnv(env = process.env) {
  const read = (name) => {
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new UsageMonitorError(
        'INVALID_THRESHOLD',
        `INVALID_THRESHOLD: ${name} must be a non-negative integer`,
      );
    return value;
  };
  const allowanceMinutes = read('LIVEKIT_PARTICIPANT_MINUTES_ALLOWANCE');
  const warningMinutes = read('LIVEKIT_PARTICIPANT_MINUTES_WARNING');
  const criticalMinutes = read('LIVEKIT_PARTICIPANT_MINUTES_CRITICAL');
  if (
    allowanceMinutes < 1 ||
    warningMinutes < 1 ||
    warningMinutes >= criticalMinutes ||
    criticalMinutes > allowanceMinutes
  )
    throw new UsageMonitorError(
      'INVALID_THRESHOLD',
      'INVALID_THRESHOLD: usage thresholds are not ordered',
    );
  return { allowanceMinutes, warningMinutes, criticalMinutes };
}

export function mergeUsage(stateValue, periodId, records, atMs, baselineMinutes) {
  const previous = readUsageState(stateValue);
  const samePeriod = previous.periodId === periodId;
  const sessions = samePeriod ? { ...previous.sessions } : {};
  for (const record of records) {
    if (!record || typeof record.sessionId !== 'string' || !integerNonnegative(record.minutes))
      continue;
    const prior = sessions[record.sessionId];
    if (!prior || record.minutes > prior.minutes)
      sessions[record.sessionId] = { minutes: record.minutes, observedAtMs: atMs };
  }
  return {
    version: 1,
    periodId,
    baselineMinutes:
      samePeriod && previous.baselineMinutes !== null
        ? previous.baselineMinutes
        : (baselineMinutes ?? 0),
    sessions,
    lastSuccessfulAtMs: atMs,
    lastNoticeAtMs: samePeriod ? previous.lastNoticeAtMs : null,
    lastLevel: samePeriod ? previous.lastLevel : 'normal',
    lastFailureCode: null,
    lastFailureNoticeAtMs: null,
  };
}

export function decideUsage(previousValue, currentValue, atMs, options = {}) {
  const previous = readUsageState(previousValue);
  const current = summarizeUsage(currentValue, atMs, options.thresholds);
  const notices = [];
  const changed = current.level !== previous.lastLevel;
  const dueReminder =
    current.level !== 'normal' &&
    (previous.lastNoticeAtMs === null ||
      atMs - previous.lastNoticeAtMs >= (options.remindEveryMs ?? USAGE_POLICY.remindEveryMs));
  if (current.level !== 'normal' && (changed || dueReminder))
    notices.push({ kind: current.level.toUpperCase(), text: formatUsageNotice(current, options) });
  if (current.level === 'normal' && previous.lastLevel !== 'normal')
    notices.push({ kind: 'RECOVERED', text: formatUsageNotice(current, options) });
  return {
    current,
    notices,
    next: {
      ...readUsageState(currentValue),
      lastLevel: current.level,
      lastNoticeAtMs: notices.length ? atMs : previous.lastNoticeAtMs,
    },
  };
}

export function formatUsageNotice(current, options = {}) {
  const label = options.label ?? 'kkakkung';
  const source = options.source ?? 'LiveKit Analytics API';
  const amount = `${current.observedMinutes}/${options.thresholds?.allowanceMinutes ?? '?'}분`;
  const remaining = `${current.remainingMinutes}분 남음`;
  if (current.level === 'normal')
    return `:large_green_circle: **LiveKit 사용량 경보 해제** · ${label}\n- ${amount} · ${remaining}`;
  const title =
    current.level === 'exhausted'
      ? 'LiveKit 참가자 분 사용량 소진'
      : current.level === 'critical'
        ? 'LiveKit 참가자 분 사용량 위험'
        : 'LiveKit 참가자 분 사용량 주의';
  return [
    `:rotating_light: **${title}** · ${label}`,
    `- ${amount} · ${remaining}`,
    `- 근거: ${source} · 현재 월 ${current.periodId}`,
    '- 자동으로 입장을 차단하지 않는다. 대시보드에서 요금제·잔여량을 확인하고 필요하면 운영을 drain한다',
  ].join('\n');
}

function jsonObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UsageMonitorError(code);
  return value;
}

async function fetchJson(url, token, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? USAGE_POLICY.apiTimeoutMs,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok)
      throw new UsageMonitorError(
        response.status === 401 || response.status === 403
          ? 'ANALYTICS_UNAUTHORIZED'
          : response.status === 429
            ? 'ANALYTICS_RATE_LIMITED'
            : `ANALYTICS_HTTP_${response.status}`,
      );
    const body = jsonObject(await response.json(), 'ANALYTICS_INVALID_RESPONSE');
    await response.body?.cancel().catch(() => {});
    return body;
  } catch (error) {
    if (error instanceof UsageMonitorError) throw error;
    throw new UsageMonitorError(
      controller.signal.aborted ? 'ANALYTICS_TIMEOUT' : 'ANALYTICS_UNREACHABLE',
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function collectUsage(options) {
  if (!PROJECT_ID.test(options.projectId)) throw new UsageMonitorError('INVALID_PROJECT_ID');
  if (!options.apiKey || !options.apiSecret)
    throw new UsageMonitorError('ANALYTICS_CREDENTIALS_MISSING');
  const accessToken = new AccessToken(options.apiKey, options.apiSecret, { ttl: 60 * 60 });
  accessToken.addGrant({ roomList: true });
  const token = await accessToken.toJwt();
  const window = analyticsWindow(options.nowMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const records = [];
  for (let page = 0; page < USAGE_POLICY.maxPages; page++) {
    const url = new URL(`https://cloud-api.livekit.io/api/project/${options.projectId}/sessions`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(USAGE_POLICY.pageLimit));
    url.searchParams.set('start', window.start);
    url.searchParams.set('end', window.end);
    const body = await fetchJson(url, token, { fetchImpl, timeoutMs: options.timeoutMs });
    const sessions = Array.isArray(body.sessions) ? body.sessions : null;
    if (!sessions) throw new UsageMonitorError('ANALYTICS_INVALID_RESPONSE');
    for (const session of sessions) {
      if (!session || typeof session.sessionId !== 'string') continue;
      const detailsUrl = `https://cloud-api.livekit.io/api/project/${options.projectId}/sessions/${encodeURIComponent(session.sessionId)}`;
      const details = await fetchJson(detailsUrl, token, {
        fetchImpl,
        timeoutMs: options.timeoutMs,
      });
      if (integerNonnegative(details.connectionMinutes))
        records.push({ sessionId: session.sessionId, minutes: details.connectionMinutes });
    }
    if (sessions.length < USAGE_POLICY.pageLimit) break;
    if (page === USAGE_POLICY.maxPages - 1) throw new UsageMonitorError('ANALYTICS_TOO_MANY_PAGES');
  }
  return { window, records };
}

export function formatFailureNotice(code, label = 'kkakkung') {
  return [
    `:warning: **LiveKit 사용량 확인 실패** · ${label}`,
    `- 코드: ${code}`,
    '- Analytics API가 복구될 때까지 잔여량을 확정하지 않는다. LiveKit Cloud 대시보드에서 직접 확인한다',
  ].join('\n');
}

function loadState(path) {
  if (!existsSync(path)) return { ...INITIAL_USAGE_STATE, sessions: {} };
  try {
    return readUsageState(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { ...INITIAL_USAGE_STATE, sessions: {} };
  }
}

function saveState(path, state) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}

async function send(webhook, channel, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_POLICY.sendTimeoutMs);
  try {
    const payload = { text, username: 'kkakkung-livekit-usage' };
    if (channel) payload.channel = channel;
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => {});
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(argv) {
  const options = { state: null, label: 'kkakkung', test: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--state') options.state = argv[++i];
    else if (arg === '--label') options.label = argv[++i];
    else if (arg === '--test') options.test = true;
    else return null;
  }
  if (!options.test && !options.state) return null;
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: check-livekit-usage.mjs --state <file> [--label <name>] | --test');
    return 2;
  }
  const dryRun = process.env.LIVEKIT_USAGE_DRY_RUN === '1';
  const webhook = process.env.MM_WEBHOOK;
  if (!dryRun && !webhook) {
    console.error('usage: MM_WEBHOOK 이 없어 알릴 수 없다');
    return 2;
  }
  if (args.test) {
    const text = ':information_source: **LiveKit 사용량 알림 경로 시험** · ' + args.label;
    if (dryRun) {
      console.log(text);
      return 0;
    }
    return (await send(webhook, process.env.LIVEKIT_USAGE_CHANNEL, text)) ? 0 : 1;
  }

  let thresholds;
  try {
    thresholds = thresholdsFromEnv();
  } catch (error) {
    console.error(
      `BLOCKED: ${error instanceof UsageMonitorError ? error.message : 'invalid configuration'}`,
    );
    return 2;
  }
  const statePath = resolve(args.state);
  const previous = loadState(statePath);
  const nowMs = Date.now();
  const periodId = monthPeriodId(nowMs);
  const firstRun = previous.periodId === null;
  const baseline = process.env.LIVEKIT_USAGE_BASELINE_MINUTES;
  const baselineMinutes = baseline === undefined || baseline === '' ? null : Number(baseline);
  if (
    firstRun &&
    (!Number.isSafeInteger(baselineMinutes) ||
      baselineMinutes < 0 ||
      baselineMinutes > thresholds.allowanceMinutes)
  ) {
    console.error(
      'BLOCKED: 첫 실행은 LIVEKIT_USAGE_BASELINE_MINUTES에 현재 월 대시보드 사용량을 넣어야 한다',
    );
    return 2;
  }

  try {
    const collected = await collectUsage({
      projectId: process.env.LIVEKIT_PROJECT_ID,
      apiKey: process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_API_SECRET,
      nowMs,
    });
    const merged = mergeUsage(
      previous,
      periodId,
      collected.records,
      nowMs,
      firstRun ? baselineMinutes : undefined,
    );
    const result = decideUsage(merged, merged, nowMs, {
      label: args.label,
      thresholds,
      source: `LiveKit Analytics API (${collected.window.start}~${collected.window.end})`,
    });
    const delivered =
      dryRun ||
      (await Promise.all(
        result.notices.map((notice) =>
          send(webhook, process.env.LIVEKIT_USAGE_CHANNEL, notice.text),
        ),
      ).then((values) => values.every(Boolean)));
    if (delivered) saveState(statePath, result.next);
    console.log(
      `usage: ${result.current.level} ${result.current.observedMinutes}/${thresholds.allowanceMinutes}분 ` +
        `remaining=${result.current.remainingMinutes} notices=${result.notices.map((n) => n.kind).join(',') || '-'}`,
    );
    return delivered ? 0 : 1;
  } catch (error) {
    const code = error instanceof UsageMonitorError ? error.code : 'ANALYTICS_FAILED';
    const notice = formatFailureNotice(code, args.label);
    const failureState = {
      ...previous,
      periodId: previous.periodId ?? periodId,
      lastFailureCode: code,
      lastFailureNoticeAtMs: nowMs,
    };
    const delivered = dryRun || (await send(webhook, process.env.LIVEKIT_USAGE_CHANNEL, notice));
    if (delivered) saveState(statePath, failureState);
    console.error(`usage: ${code}`);
    return code === 'ANALYTICS_UNAUTHORIZED' ? 3 : delivered ? 1 : 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly)
  main().then(
    (code) => process.exit(code),
    () => process.exit(1),
  );

#!/usr/bin/env node
// Owned by F (F-07 / DP-05). Offline collector for exported observability lines.
//
//   node scripts/collect-observability.mjs --input .local/qa/events.ndjson --output .local/qa/metrics.json
//
// Input: one JSON object per line. A line is a MetricSample when it has `unit`, a
// StructuredEvent when it has `event`. Everything else, and every line that fails the same
// allowlist the server enforces, is counted as rejected (reason + field name only; the value is
// never printed or written). Output: per-metric distributions, the combined tick-round
// distribution QA-10/12 judge, event counts, alert threshold hits and an `incomplete` flag
// that is true whenever samples were dropped or lines were rejected.
//
// The allowlists below mirror server/src/observability/*.ts. tests/contracts/observability.test.ts
// fails if they drift apart, so the TypeScript files stay the single source of truth.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTERED_METRICS = Object.freeze({
  'tick.duration': 'ms',
  'tick.due': 'count',
  'tick.catchup': 'count',
  'tick.overload': 'count',
  'input.queueDepth': 'count',
  'input.rejected': 'count',
  'http.requests.active': 'count',
  'http.requests.work': 'count',
  'http.requests.rejected': 'count',
  'process.memory': 'bytes',
  'process.cpu': 'ratio',
  'eventLoop.lag': 'ms',
  'eventLoop.delayP99': 'ms',
  'media.api.total60s': 'count',
  'media.api.normal60s': 'count',
  'media.api.429': 'count',
  'media.policy.queueWait': 'ms',
  'media.policy.responseLatency': 'ms',
  'media.policy.effectLatency': 'ms',
  'media.retirement.unresolved': 'count',
  'media.reservation.participantMs': 'ms',
  'media.reservation.bytes': 'bytes',
  'operations.journal.writable': 'count',
  'operations.audit.events': 'count',
  'operations.audit.coalesced': 'count',
  'operations.audit.retained': 'count',
  'operations.queue.pending': 'count',
  'operations.queue.rejected': 'count',
  'observability.dropped': 'count',
});

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
  'observability.dropped',
]);

export const ALERT_THRESHOLDS = Object.freeze({
  mediaApiTotal60sNearLimit: 810,
  mediaApi429: 1,
  mediaPolicyResponseLatencyMs: 1000,
  mediaRetirementUnresolvedMs: 10_000,
});

const SAMPLE_FIELDS = ['name', 'value', 'unit', 'atMs', 'matchRef', 'generation', 'requestId'];
const FORBIDDEN = [
  /token/i,
  /jwt/i,
  /secret/i,
  /sdp/i,
  /password/i,
  /authorization/i,
  /nickname/i,
  /identity/i,
  /^map$/i,
  /seed/i,
  /exit/i,
  /position/i,
  /^(x|y|z)$/i,
  /frame/i,
  /audio/i,
];
const SAFE_LABEL = /^[A-Za-z0-9._:-]+$/;

export function validateSample(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { ok: false, reason: 'NOT_AN_OBJECT' };
  for (const key of Object.keys(input)) {
    if (FORBIDDEN.some((p) => p.test(key)))
      return { ok: false, reason: 'FORBIDDEN_FIELD', field: key };
    if (!SAMPLE_FIELDS.includes(key)) return { ok: false, reason: 'INVALID_LABEL', field: key };
  }
  const { name, value, unit, atMs, matchRef, generation, requestId } = input;
  if (typeof name !== 'string' || !Object.hasOwn(REGISTERED_METRICS, name))
    return { ok: false, reason: 'UNREGISTERED_NAME', field: 'name' };
  if (unit !== REGISTERED_METRICS[name])
    return { ok: false, reason: 'UNIT_MISMATCH', field: 'unit' };
  if (typeof value !== 'number' || !Number.isFinite(value))
    return { ok: false, reason: 'NON_FINITE_VALUE', field: 'value' };
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0)
    return { ok: false, reason: 'NON_FINITE_TIME', field: 'atMs' };
  if (value < 0 || (unit === 'ratio' && value > 1))
    return { ok: false, reason: 'OUT_OF_RANGE', field: 'value' };
  if (matchRef !== undefined && (typeof matchRef !== 'string' || !SAFE_LABEL.test(matchRef)))
    return { ok: false, reason: 'INVALID_LABEL', field: 'matchRef' };
  if (requestId !== undefined && (typeof requestId !== 'string' || !SAFE_LABEL.test(requestId)))
    return { ok: false, reason: 'INVALID_LABEL', field: 'requestId' };
  if (generation !== undefined && (!Number.isInteger(generation) || generation < 0))
    return { ok: false, reason: 'INVALID_LABEL', field: 'generation' };
  return { ok: true, sample: { name, value, unit, atMs, matchRef, generation, requestId } };
}

export function quantile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * (sorted.length - 1))));
  return sorted[rank];
}

export function describe(values) {
  if (values.length === 0) return { count: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    count: values.length,
    min,
    max,
    mean: sum / values.length,
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    p99: quantile(values, 0.99),
  };
}

export function summarizeTickRounds(samples) {
  const rounds = new Map();
  const perRoom = new Map();
  const all = [];
  for (const s of samples) {
    if (s.name !== 'tick.duration') continue;
    const r = rounds.get(s.atMs) ?? { rooms: 0, totalMs: 0 };
    r.rooms += 1;
    r.totalMs += s.value;
    rounds.set(s.atMs, r);
    all.push(s.value);
    const key = s.matchRef ?? '(none)';
    perRoom.set(key, [...(perRoom.get(key) ?? []), s.value]);
  }
  const ordered = [...rounds.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([atMs, r]) => ({ atMs, rooms: r.rooms, totalMs: r.totalMs }));
  return {
    rounds: ordered.length,
    maxRoomsPerRound: ordered.reduce((m, r) => Math.max(m, r.rooms), 0),
    combined: describe(ordered.map((r) => r.totalMs)),
    perRoom: describe(all),
    byRoom: Object.fromEntries([...perRoom.entries()].map(([k, v]) => [k, describe(v)])),
  };
}

export function collect(lines) {
  const samples = [];
  const events = {};
  const rejected = { total: 0, byReason: {}, fields: {} };
  let unparsable = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      unparsable += 1;
      continue;
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.event === 'string') {
      if (EVENT_NAMES.includes(parsed.event))
        events[parsed.event] = (events[parsed.event] ?? 0) + 1;
      else reject(rejected, 'UNKNOWN_EVENT', 'event');
      continue;
    }
    const result = validateSample(parsed);
    if (!result.ok) {
      reject(rejected, result.reason, result.field);
      continue;
    }
    samples.push(result.sample);
  }
  const byName = {};
  for (const name of Object.keys(REGISTERED_METRICS)) {
    const values = samples.filter((s) => s.name === name).map((s) => s.value);
    if (values.length > 0) byName[name] = { unit: REGISTERED_METRICS[name], ...describe(values) };
  }
  const dropped = samples
    .filter((s) => s.name === 'observability.dropped')
    .reduce((sum, s) => sum + s.value, 0);
  const alerts = evaluateThresholds(samples);
  return {
    samples: samples.length,
    unparsable,
    rejected,
    dropped,
    incomplete: dropped > 0 || rejected.total > 0 || unparsable > 0,
    metrics: byName,
    tickRounds: summarizeTickRounds(samples),
    events,
    alerts,
  };
}

function reject(rejected, reason, field) {
  rejected.total += 1;
  rejected.byReason[reason] = (rejected.byReason[reason] ?? 0) + 1;
  if (field) rejected.fields[field] = (rejected.fields[field] ?? 0) + 1;
}

export function evaluateThresholds(samples) {
  const hit = (name, predicate) => samples.some((s) => s.name === name && predicate(s.value));
  return {
    MEDIA_API_BUDGET_NEAR_LIMIT: hit(
      'media.api.total60s',
      (v) => v >= ALERT_THRESHOLDS.mediaApiTotal60sNearLimit,
    ),
    MEDIA_API_RATE_LIMITED: hit('media.api.429', (v) => v >= ALERT_THRESHOLDS.mediaApi429),
    MEDIA_POLICY_UNCERTAIN: hit(
      'media.policy.responseLatency',
      (v) => v > ALERT_THRESHOLDS.mediaPolicyResponseLatencyMs,
    ),
    MEDIA_RETIREMENT_UNRESOLVED: hit('media.retirement.unresolved', (v) => v >= 1),
    JOURNAL_NOT_WRITABLE: hit('operations.journal.writable', (v) => v === 0),
    TICK_OVERLOAD: hit('tick.overload', (v) => v >= 1),
    OBSERVABILITY_DROPPED: hit('observability.dropped', (v) => v >= 1),
  };
}

function parseArgs(argv) {
  const opt = { input: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') opt.input = argv[++i];
    else if (a === '--output') opt.output = argv[++i];
    else {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
  }
  if (!opt.input || !opt.output) {
    console.error(
      'usage: node scripts/collect-observability.mjs --input <events.ndjson> --output <metrics.json>',
    );
    process.exit(2);
  }
  return opt;
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const inputPath = resolve(opt.input);
  if (!existsSync(inputPath)) {
    console.error(`BLOCKED: 입력 파일이 없습니다: ${opt.input}`);
    process.exit(3);
  }
  const lines = readFileSync(inputPath, 'utf8').split(/\r?\n/);
  const report = {
    input: opt.input,
    generatedAt: new Date().toISOString(),
    ...collect(lines),
  };
  if (report.samples === 0) {
    console.error('BLOCKED: 유효한 metric 표본이 0개입니다 (No samples 를 성공으로 취급하지 않음)');
    process.exit(3);
  }
  mkdirSync(dirname(resolve(opt.output)), { recursive: true });
  writeFileSync(resolve(opt.output), JSON.stringify(report, null, 2) + '\n');
  const flags = Object.entries(report.alerts)
    .filter(([, on]) => on)
    .map(([id]) => id);
  console.log(
    `collect-observability: samples=${report.samples} rejected=${report.rejected.total} dropped=${report.dropped} incomplete=${report.incomplete} alerts=${flags.length ? flags.join(',') : 'none'}`,
  );
  process.exit(report.incomplete ? 1 : 0);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

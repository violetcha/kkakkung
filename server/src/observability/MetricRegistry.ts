// Owned by F (F-07 / DP-05). Central metric contract for the game server.
//
// B (bootstrap) creates one registry and injects `registry.emitMetric` into the tick
// coordinator and into E's MediaCoordinatorDeps. Producers keep computing their own
// values; this module only validates, bounds and hands the samples to a collector.
//
// Guarantees the callers rely on:
// - `emit` is synchronous, never awaits IO and never throws back into the caller.
// - Only registered name/unit pairs are stored. Anything else is rejected and counted.
// - Labels are limited to matchRef / generation / requestId. Identity, nickname, token,
//   SDP, coordinates or map data are rejected as a whole sample.
// - The queue is bounded. When it is full the sample is dropped and the drop is counted,
//   so an incomplete observation is visible as `observability.dropped`, never as zero.

export type MetricUnit = 'count' | 'ms' | 'bytes' | 'ratio';

/** The one MetricSample shape shared with B (`server/src/game/ports.ts`) and E (`server/src/media/types.ts`). */
export type MetricSample = Readonly<{
  name: string;
  value: number;
  unit: MetricUnit;
  atMs: number;
  matchRef?: string;
  generation?: number;
  requestId?: string;
}>;

export type EmitMetric = (sample: MetricSample) => void;

/** Registered names and their only accepted unit. New entries need an F handoff record. */
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
  'observability.dropped': 'count',
} as const satisfies Record<string, MetricUnit>);

export type RegisteredMetricName = keyof typeof REGISTERED_METRICS;

export const REGISTERED_METRIC_NAMES = Object.freeze(
  Object.keys(REGISTERED_METRICS) as RegisteredMetricName[],
);

/** Only these keys may appear on a sample. Anything else is a forbidden label. */
export const SAMPLE_FIELDS = Object.freeze([
  'name',
  'value',
  'unit',
  'atMs',
  'matchRef',
  'generation',
  'requestId',
] as const);

/** Field names that must never reach the collector even as unknown extras. Checked case-insensitively. */
export const FORBIDDEN_FIELD_PATTERNS = Object.freeze([
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
]);

export type RejectReason =
  | 'NOT_AN_OBJECT'
  | 'UNREGISTERED_NAME'
  | 'UNIT_MISMATCH'
  | 'NON_FINITE_VALUE'
  | 'NON_FINITE_TIME'
  | 'OUT_OF_RANGE'
  | 'FORBIDDEN_FIELD'
  | 'INVALID_LABEL';

export type ValidationResult =
  | Readonly<{ ok: true; sample: MetricSample }>
  | Readonly<{ ok: false; reason: RejectReason; field?: string }>;

const MAX_LABEL_LENGTH = 128;
const SAFE_LABEL = /^[A-Za-z0-9._:-]+$/;

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Validates an untrusted sample. Pure: never throws, never logs the offending value. The
 * returned `field` is the key name only, so a rejected secret never travels further.
 */
export function validateSample(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'NOT_AN_OBJECT' };
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (isForbiddenKey(key)) return { ok: false, reason: 'FORBIDDEN_FIELD', field: key };
    if (!(SAMPLE_FIELDS as readonly string[]).includes(key))
      return { ok: false, reason: 'INVALID_LABEL', field: key };
  }
  const { name, value, unit, atMs, matchRef, generation, requestId } = record;
  if (typeof name !== 'string' || !Object.hasOwn(REGISTERED_METRICS, name))
    return { ok: false, reason: 'UNREGISTERED_NAME', field: 'name' };
  const registeredUnit = REGISTERED_METRICS[name as RegisteredMetricName];
  if (unit !== registeredUnit) return { ok: false, reason: 'UNIT_MISMATCH', field: 'unit' };
  if (typeof value !== 'number' || !Number.isFinite(value))
    return { ok: false, reason: 'NON_FINITE_VALUE', field: 'value' };
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0)
    return { ok: false, reason: 'NON_FINITE_TIME', field: 'atMs' };
  if (value < 0) return { ok: false, reason: 'OUT_OF_RANGE', field: 'value' };
  if (unit === 'ratio' && value > 1) return { ok: false, reason: 'OUT_OF_RANGE', field: 'value' };
  if (name === 'operations.journal.writable' && value !== 0 && value !== 1)
    return { ok: false, reason: 'OUT_OF_RANGE', field: 'value' };
  if (matchRef !== undefined) {
    if (
      typeof matchRef !== 'string' ||
      matchRef.length > MAX_LABEL_LENGTH ||
      !SAFE_LABEL.test(matchRef)
    )
      return { ok: false, reason: 'INVALID_LABEL', field: 'matchRef' };
  }
  if (requestId !== undefined) {
    if (
      typeof requestId !== 'string' ||
      requestId.length > MAX_LABEL_LENGTH ||
      !SAFE_LABEL.test(requestId)
    )
      return { ok: false, reason: 'INVALID_LABEL', field: 'requestId' };
  }
  if (generation !== undefined) {
    if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0)
      return { ok: false, reason: 'INVALID_LABEL', field: 'generation' };
  }
  const sample: MetricSample = {
    name,
    value,
    unit: registeredUnit,
    atMs,
    ...(matchRef !== undefined ? { matchRef } : {}),
    ...(generation !== undefined ? { generation } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
  return { ok: true, sample };
}

export type RegistryStats = Readonly<{
  capacity: number;
  queued: number;
  accepted: number;
  dropped: number;
  rejected: number;
  rejectedByReason: Readonly<Record<RejectReason, number>>;
  /** True when any sample was dropped or rejected since creation: the observation is incomplete. */
  incomplete: boolean;
}>;

export type MetricRegistryOptions = Readonly<{
  /** Maximum queued samples between drains. Default 10 000 (well under a minute of 10-room tick output). */
  capacity?: number;
  /** Monotonic clock used to stamp the synthetic `observability.dropped` sample. */
  now?: () => number;
  /** Optional hook for tests or a logger. Receives the reason and field name only, never the value. */
  onReject?: (reason: RejectReason, field: string | undefined) => void;
}>;

const DEFAULT_CAPACITY = 10_000;

function emptyReasons(): Record<RejectReason, number> {
  return {
    NOT_AN_OBJECT: 0,
    UNREGISTERED_NAME: 0,
    UNIT_MISMATCH: 0,
    NON_FINITE_VALUE: 0,
    NON_FINITE_TIME: 0,
    OUT_OF_RANGE: 0,
    FORBIDDEN_FIELD: 0,
    INVALID_LABEL: 0,
  };
}

/**
 * Bounded, synchronous collector. `emitMetric` is the callback B injects into the tick
 * coordinator and E's media coordinator. `drain()` is what the exporter (log line writer,
 * QA collector) calls on its own timer; the registry itself never schedules IO.
 */
export class MetricRegistry {
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly onReject: MetricRegistryOptions['onReject'];
  private queue: MetricSample[] = [];
  private accepted = 0;
  private dropped = 0;
  private droppedSinceDrain = 0;
  private rejected = 0;
  private readonly rejectedByReason = emptyReasons();

  /** Bound callback. Safe to hand out as `EmitMetric` without wrapping. */
  readonly emitMetric: EmitMetric;

  constructor(options: MetricRegistryOptions = {}) {
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.capacity = Number.isInteger(capacity) && capacity > 0 ? capacity : DEFAULT_CAPACITY;
    this.now = options.now ?? (() => performance.now());
    this.onReject = options.onReject;
    this.emitMetric = (sample) => this.emit(sample);
  }

  /** Accepts an untrusted sample. Returns nothing and never throws; see `stats()` for outcomes. */
  emit(sample: unknown): void {
    try {
      const result = validateSample(sample);
      if (!result.ok) {
        this.rejected += 1;
        this.rejectedByReason[result.reason] += 1;
        this.onReject?.(result.reason, result.field);
        return;
      }
      if (this.queue.length >= this.capacity) {
        this.dropped += 1;
        this.droppedSinceDrain += 1;
        return;
      }
      this.queue.push(result.sample);
      this.accepted += 1;
    } catch {
      // Observability must never break the tick or the media control path.
      this.dropped += 1;
      this.droppedSinceDrain += 1;
    }
  }

  /**
   * Removes and returns every queued sample. When samples were dropped since the previous
   * drain, one synthetic `observability.dropped` sample is appended so the gap is exported.
   */
  drain(): MetricSample[] {
    const out = this.queue;
    this.queue = [];
    if (this.droppedSinceDrain > 0) {
      out.push({
        name: 'observability.dropped',
        value: this.droppedSinceDrain,
        unit: 'count',
        atMs: this.now(),
      });
      this.droppedSinceDrain = 0;
    }
    return out;
  }

  stats(): RegistryStats {
    return {
      capacity: this.capacity,
      queued: this.queue.length,
      accepted: this.accepted,
      dropped: this.dropped,
      rejected: this.rejected,
      rejectedByReason: { ...this.rejectedByReason },
      incomplete: this.dropped > 0 || this.rejected > 0,
    };
  }
}

export function createMetricRegistry(options?: MetricRegistryOptions): MetricRegistry {
  return new MetricRegistry(options);
}

// ---------------------------------------------------------------------------------------
// Unit conversion and aggregation helpers used by the process sampler, the QA collector and
// the contract tests. Pure functions, no IO.
// ---------------------------------------------------------------------------------------

/** perf_hooks reports nanoseconds; every `ms` metric is milliseconds. */
export function nsToMs(ns: number): number {
  return ns / 1_000_000;
}

/** Upper-rank quantile (index = ceil(p·(n−1))) on a copy of the input, so the slowest 1 % of 100 samples is p99. NaN for an empty list. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * (sorted.length - 1))));
  return sorted[rank] as number;
}

export type Distribution = Readonly<{
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}>;

export function describe(values: readonly number[]): Distribution {
  if (values.length === 0)
    return { count: 0, min: NaN, max: NaN, mean: NaN, p50: NaN, p95: NaN, p99: NaN };
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

export type TickRoundSummary = Readonly<{
  /** One entry per tick round (same `atMs`): the sum of every room's duration in that round. */
  rounds: ReadonlyArray<Readonly<{ atMs: number; rooms: number; totalMs: number }>>;
  /** Distribution of the per-round sums. This is the "10 rooms combined" figure QA-10 judges. */
  combined: Distribution;
  /** Distribution of individual room durations, reported separately and never in place of `combined`. */
  perRoom: Distribution;
  byRoom: ReadonlyMap<string, Distribution>;
}>;

/**
 * Groups `tick.duration` samples by round. The coordinator stamps every room it runs in one
 * `run()` call with the same monotonic `atMs`, so `atMs` identifies the round.
 */
export function summarizeTickRounds(samples: readonly MetricSample[]): TickRoundSummary {
  const perRound = new Map<number, { rooms: number; totalMs: number }>();
  const perRoomValues = new Map<string, number[]>();
  const all: number[] = [];
  for (const s of samples) {
    if (s.name !== 'tick.duration') continue;
    const round = perRound.get(s.atMs) ?? { rooms: 0, totalMs: 0 };
    round.rooms += 1;
    round.totalMs += s.value;
    perRound.set(s.atMs, round);
    all.push(s.value);
    const key = s.matchRef ?? '(none)';
    const list = perRoomValues.get(key) ?? [];
    list.push(s.value);
    perRoomValues.set(key, list);
  }
  const rounds = [...perRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([atMs, r]) => ({ atMs, rooms: r.rooms, totalMs: r.totalMs }));
  const byRoom = new Map<string, Distribution>();
  for (const [key, values] of perRoomValues) byRoom.set(key, describe(values));
  return {
    rounds,
    combined: describe(rounds.map((r) => r.totalMs)),
    perRoom: describe(all),
    byRoom,
  };
}

// ---------------------------------------------------------------------------------------
// Process sampler: event-loop delay, memory and CPU. The Node primitives are injected so the
// contract test can feed exact values; B wires the real `monitorEventLoopDelay()` histogram.
// ---------------------------------------------------------------------------------------

export type EventLoopDelaySource = Readonly<{
  /** Same contract as `IntervalHistogram.percentile(p)`: nanoseconds. */
  percentile: (p: number) => number;
  reset?: () => void;
}>;

export type ProcessSamplerOptions = Readonly<{
  emit: EmitMetric;
  now: () => number;
  eventLoopDelay: EventLoopDelaySource;
  memoryUsage?: () => Readonly<{ rss: number }>;
  cpuUsage?: () => Readonly<{ user: number; system: number }>;
}>;

/**
 * Returns a `sample()` function. Each call emits `eventLoop.delayP99` (ms), `process.memory` (bytes)
 * and, from the second call on, `process.cpu` as a 0–1 ratio of the wall time since the previous
 * call. Nothing here schedules a timer: the caller owns the interval.
 */
export function createProcessSampler(options: ProcessSamplerOptions): () => void {
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
  const cpuUsage = options.cpuUsage ?? (() => process.cpuUsage());
  let lastCpu: { user: number; system: number } | null = null;
  let lastAtMs: number | null = null;
  return () => {
    const atMs = options.now();
    try {
      // A histogram percentile is not a coordinator tick's now-minus-due lag. Mixing them
      // changes the sample population and invalidates the game's eventLoop.lag p95 gate.
      const delayP99Ms = nsToMs(options.eventLoopDelay.percentile(99));
      options.emit({ name: 'eventLoop.delayP99', value: delayP99Ms, unit: 'ms', atMs });
      options.eventLoopDelay.reset?.();
      options.emit({ name: 'process.memory', value: memoryUsage().rss, unit: 'bytes', atMs });
      const cpu = cpuUsage();
      if (lastCpu && lastAtMs !== null && atMs > lastAtMs) {
        const busyMicros = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
        const wallMicros = (atMs - lastAtMs) * 1000;
        const ratio = Math.min(1, Math.max(0, busyMicros / wallMicros));
        options.emit({ name: 'process.cpu', value: ratio, unit: 'ratio', atMs });
      }
      lastCpu = { user: cpu.user, system: cpu.system };
      lastAtMs = atMs;
    } catch {
      // Sampling failures are not the game's problem.
    }
  };
}

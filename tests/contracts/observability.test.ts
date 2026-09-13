// F-07 / DP-05 observability contract: registered names and units, bounded non-throwing
// collection, ns→ms conversion, per-round tick aggregation, alert semantics and the log
// guard. Nothing here starts a server, a timer or the network.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REGISTERED_METRICS,
  REGISTERED_METRIC_NAMES,
  createMetricRegistry,
  createProcessSampler,
  nsToMs,
  quantile,
  summarizeTickRounds,
  validateSample,
  type MetricSample,
} from '../../server/src/observability/MetricRegistry.ts';
import {
  ALERT_RULES,
  ALERT_THRESHOLDS,
  createAlertPolicy,
} from '../../server/src/observability/AlertPolicy.ts';
import {
  EVENT_NAMES,
  createLogOptions,
  createStructuredEventLogger,
  sanitizeLogObject,
  validateEvent,
  type StructuredEvent,
} from '../../server/src/observability/StructuredEvents.ts';
import * as collector from '../../scripts/collect-observability.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

const REQUIRED_METRICS: Record<string, string> = {
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
};

describe('metric registry allowlist', () => {
  it('registers F-07 names and units plus the separate process histogram', () => {
    expect({ ...REGISTERED_METRICS }).toEqual(REQUIRED_METRICS);
    expect([...REGISTERED_METRIC_NAMES].sort()).toEqual(Object.keys(REQUIRED_METRICS).sort());
  });

  it('matches the names B and E already emit from their own code', () => {
    const emitted = ['tick.due', 'tick.catchup', 'tick.overload', 'eventLoop.lag'];
    const tick = readFileSync(resolve(root, 'server/src/game/RoomTickCoordinator.ts'), 'utf8');
    for (const name of emitted) expect(tick).toContain(`'${name}'`);
    const media = readFileSync(resolve(root, 'server/src/media/MediaCoordinator.ts'), 'utf8');
    expect(media).toContain("'media.retirement.unresolved'");
    const subs = readFileSync(resolve(root, 'server/src/media/SubscriptionController.ts'), 'utf8');
    expect(subs).toContain("'media.policy.queueWait'");
    expect(subs).toContain("'media.policy.responseLatency'");
  });

  it('keeps the collector script allowlists identical to the TypeScript source', () => {
    expect(collector.REGISTERED_METRICS).toEqual({ ...REGISTERED_METRICS });
    expect([...collector.EVENT_NAMES]).toEqual([...EVENT_NAMES]);
    expect({ ...collector.ALERT_THRESHOLDS }).toEqual({ ...ALERT_THRESHOLDS });
  });

  it('is part of the server build (F owns server/src/observability)', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(root, 'server/tsconfig.json'), 'utf8')) as {
      include: string[];
    };
    expect(tsconfig.include).toContain('src/**/*.ts');
    const ownership = JSON.parse(
      readFileSync(resolve(root, 'docs/execution/ownership.json'), 'utf8'),
    ) as { roles: Record<string, { paths: string[] }> };
    expect(ownership.roles.F?.paths).toContain('server/src/observability/');
    for (const file of ['MetricRegistry.ts', 'StructuredEvents.ts', 'AlertPolicy.ts'])
      expect(existsSync(resolve(root, 'server/src/observability', file))).toBe(true);
  });
});

describe('validation rejects what must never be stored', () => {
  const good: MetricSample = {
    name: 'tick.due',
    value: 1,
    unit: 'count',
    atMs: 10,
    matchRef: 'm1',
  };

  it('accepts a registered sample with allowed labels only', () => {
    const r = validateSample(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sample).toEqual(good);
  });

  it.each([
    [{ ...good, name: 'tick.nope' }, 'UNREGISTERED_NAME'],
    [{ ...good, unit: 'ms' }, 'UNIT_MISMATCH'],
    [{ ...good, value: Number.NaN }, 'NON_FINITE_VALUE'],
    [{ ...good, value: Infinity }, 'NON_FINITE_VALUE'],
    [{ ...good, atMs: -1 }, 'NON_FINITE_TIME'],
    [{ name: 'process.cpu', value: 1.5, unit: 'ratio', atMs: 1 }, 'OUT_OF_RANGE'],
    [{ name: 'operations.journal.writable', value: 2, unit: 'count', atMs: 1 }, 'OUT_OF_RANGE'],
    [{ ...good, token: 'eyJ...' }, 'FORBIDDEN_FIELD'],
    [{ ...good, rawSdp: 'v=0' }, 'FORBIDDEN_FIELD'],
    [{ ...good, map: [[1, 0]] }, 'FORBIDDEN_FIELD'],
    [{ ...good, nickname: 'x' }, 'FORBIDDEN_FIELD'],
    [{ ...good, extra: 1 }, 'INVALID_LABEL'],
    [{ ...good, matchRef: 'has space' }, 'INVALID_LABEL'],
    [{ ...good, generation: 1.5 }, 'INVALID_LABEL'],
    ['not an object', 'NOT_AN_OBJECT'],
  ])('rejects %j as %s', (input, reason) => {
    const r = validateSample(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it('never returns the offending value, only the field name', () => {
    const r = validateSample({ ...good, token: 'super-secret-value' });
    expect(JSON.stringify(r)).not.toContain('super-secret-value');
    if (!r.ok) expect(r.field).toBe('token');
  });
});

describe('bounded synchronous collection', () => {
  it('emit is void and never throws for garbage, and rejections are counted per reason', () => {
    const rejections: string[] = [];
    const registry = createMetricRegistry({
      now: () => 0,
      onReject: (reason) => rejections.push(reason),
    });
    expect(() => registry.emit(null)).not.toThrow();
    expect(() =>
      registry.emit({ name: 'tick.due', value: 1, unit: 'count', atMs: 1, jwt: 'x' }),
    ).not.toThrow();
    expect(() =>
      registry.emit({ name: 'unknown', value: 1, unit: 'count', atMs: 1 }),
    ).not.toThrow();
    expect(registry.emit({ name: 'tick.due', value: 1, unit: 'count', atMs: 1 })).toBeUndefined();
    const stats = registry.stats();
    expect(stats.accepted).toBe(1);
    expect(stats.rejected).toBe(3);
    expect(stats.rejectedByReason.NOT_AN_OBJECT).toBe(1);
    expect(stats.rejectedByReason.FORBIDDEN_FIELD).toBe(1);
    expect(stats.rejectedByReason.UNREGISTERED_NAME).toBe(1);
    expect(rejections).toEqual(['NOT_AN_OBJECT', 'FORBIDDEN_FIELD', 'UNREGISTERED_NAME']);
    expect(stats.incomplete).toBe(true);
  });

  it('a saturated queue drops samples, counts them and exports observability.dropped on drain', () => {
    let now = 100;
    const registry = createMetricRegistry({ capacity: 3, now: () => now });
    for (let i = 0; i < 5; i++)
      registry.emit({ name: 'tick.due', value: 1, unit: 'count', atMs: i });
    expect(registry.stats().queued).toBe(3);
    expect(registry.stats().dropped).toBe(2);
    expect(registry.stats().incomplete).toBe(true);
    const drained = registry.drain();
    expect(drained).toHaveLength(4);
    expect(drained.at(-1)).toEqual({
      name: 'observability.dropped',
      value: 2,
      unit: 'count',
      atMs: 100,
    });
    now = 200;
    expect(registry.drain()).toEqual([]);
    registry.emit({ name: 'tick.due', value: 1, unit: 'count', atMs: 6 });
    expect(registry.drain()).toEqual([{ name: 'tick.due', value: 1, unit: 'count', atMs: 6 }]);
  });

  it('the bound emitMetric callback keeps working after being detached from the instance', () => {
    const registry = createMetricRegistry({ now: () => 0 });
    const { emitMetric } = registry;
    emitMetric({ name: 'eventLoop.lag', value: 2, unit: 'ms', atMs: 1 });
    expect(registry.stats().accepted).toBe(1);
  });
});

describe('unit conversion and aggregation', () => {
  it('converts perf_hooks nanoseconds to milliseconds (20 000 000 ns → 20 ms)', () => {
    expect(nsToMs(20_000_000)).toBe(20);
    expect(nsToMs(1_500_000)).toBe(1.5);
  });

  it('keeps the process histogram p99 separate from tick lag, with memory bytes and cpu ratio', () => {
    const out: MetricSample[] = [];
    let now = 1000;
    let cpu = { user: 0, system: 0 };
    const sample = createProcessSampler({
      emit: (s) => out.push(s),
      now: () => now,
      eventLoopDelay: {
        percentile: (p) => {
          expect(p).toBe(99);
          return 20_000_000;
        },
      },
      memoryUsage: () => ({ rss: 123_456_789 }),
      cpuUsage: () => cpu,
    });
    sample();
    expect(out).toEqual([
      { name: 'eventLoop.delayP99', value: 20, unit: 'ms', atMs: 1000 },
      { name: 'process.memory', value: 123_456_789, unit: 'bytes', atMs: 1000 },
    ]);
    now = 2000;
    cpu = { user: 300_000, system: 200_000 }; // 0.5 s busy over 1 s wall
    sample();
    expect(out.at(-1)).toEqual({ name: 'process.cpu', value: 0.5, unit: 'ratio', atMs: 2000 });
    expect(out.filter((s) => s.name === 'eventLoop.lag')).toEqual([]);
    for (const s of out) expect(validateSample(s).ok).toBe(true);
  });

  it('sums the durations of the same tick round across rooms and keeps per-room separate', () => {
    const samples: MetricSample[] = [];
    for (let round = 0; round < 3; round++)
      for (let room = 0; room < 10; room++)
        samples.push({
          name: 'tick.duration',
          value: 2,
          unit: 'ms',
          atMs: 1000 + round * 50,
          matchRef: `m${room}`,
        });
    samples.push({ name: 'tick.due', value: 1, unit: 'count', atMs: 1000 });
    const summary = summarizeTickRounds(samples);
    expect(summary.rounds).toHaveLength(3);
    expect(summary.rounds.every((r) => r.rooms === 10 && r.totalMs === 20)).toBe(true);
    expect(summary.combined.p95).toBe(20);
    expect(summary.combined.p99).toBe(20);
    expect(summary.perRoom.mean).toBe(2);
    expect(summary.perRoom.p99).toBe(2);
    expect(summary.byRoom.get('m3')?.count).toBe(3);
    // The per-room average must never stand in for the combined figure.
    expect(summary.combined.mean).not.toBe(summary.perRoom.mean);
  });

  it('quantile uses the upper rank so a slow top 1 % shows up in p99', () => {
    const values = [...Array.from({ length: 99 }, () => 5), 400];
    expect(quantile(values, 0.99)).toBe(400);
    expect(quantile(values, 0.5)).toBe(5);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe('alert policy', () => {
  const at = (
    atMs: number,
    partial: Partial<MetricSample> & Pick<MetricSample, 'name' | 'value' | 'unit'>,
  ) => ({ atMs, ...partial }) as MetricSample;

  it('UNRESOLVED raises an alert that time alone never clears; acknowledgement with evidence does', () => {
    let now = 0;
    const events: StructuredEvent[] = [];
    const policy = createAlertPolicy({ now: () => now, onEvent: (e) => events.push(e) });
    policy.observe(
      at(0, { name: 'media.retirement.unresolved', value: 1, unit: 'count', requestId: 'r1' }),
    );
    expect(policy.active().map((a) => a.id)).toEqual(['MEDIA_RETIREMENT_UNRESOLVED']);
    expect(policy.isLocked()).toBe(true);
    now = ALERT_THRESHOLDS.mediaRetirementUnresolvedMs * 100;
    policy.observe(at(now, { name: 'tick.due', value: 1, unit: 'count' }));
    policy.observe(at(now, { name: 'media.retirement.unresolved', value: 0, unit: 'count' }));
    expect(policy.isLocked()).toBe(true);
    expect(policy.acknowledgeResolved('MEDIA_RETIREMENT_UNRESOLVED', '')).toBe(false);
    expect(policy.acknowledgeResolved('MEDIA_RETIREMENT_UNRESOLVED', 'journal#42')).toBe(true);
    expect(policy.isLocked()).toBe(false);
    expect(policy.active()).toEqual([]);
    expect(events.map((e) => e.event)).toEqual(['alert.raised', 'alert.cleared']);
    expect(events[0]?.level).toBe('error');
    expect(events[0]?.fields?.requestId).toBe('r1');
    expect(ALERT_RULES.MEDIA_RETIREMENT_UNRESOLVED.requiresManualClear).toBe(true);
  });

  it('budget, 429 and journal alerts follow the metric and clear when it recovers', () => {
    const policy = createAlertPolicy({ now: () => 1 });
    policy.observe(at(1, { name: 'media.api.total60s', value: 809, unit: 'count' }));
    expect(policy.active()).toEqual([]);
    policy.observe(at(2, { name: 'media.api.total60s', value: 810, unit: 'count' }));
    policy.observe(at(2, { name: 'media.api.429', value: 1, unit: 'count' }));
    policy.observe(at(2, { name: 'operations.journal.writable', value: 0, unit: 'count' }));
    expect(
      policy
        .active()
        .map((a) => a.id)
        .sort(),
    ).toEqual(['JOURNAL_NOT_WRITABLE', 'MEDIA_API_BUDGET_NEAR_LIMIT', 'MEDIA_API_RATE_LIMITED']);
    expect(policy.isLocked()).toBe(true);
    policy.observe(at(3, { name: 'media.api.total60s', value: 100, unit: 'count' }));
    policy.observe(at(3, { name: 'media.api.429', value: 0, unit: 'count' }));
    policy.observe(at(3, { name: 'operations.journal.writable', value: 1, unit: 'count' }));
    expect(policy.active()).toEqual([]);
    expect(policy.isLocked()).toBe(false);
  });

  it.each([
    [180, 162],
    [181, 163],
    [900, 810],
  ])('warns at 90 percent of the configured %i-call ceiling', (limit, threshold) => {
    const events: StructuredEvent[] = [];
    const policy = createAlertPolicy({
      now: () => 1,
      mediaApiTotalLimit: limit,
      onEvent: (event) => events.push(event),
    });
    const observe = (value: number) =>
      policy.observe(at(1, { name: 'media.api.total60s', value, unit: 'count' }));
    observe(threshold - 1);
    expect(policy.active()).toEqual([]);
    observe(threshold);
    expect(policy.active()).toMatchObject([
      {
        id: 'MEDIA_API_BUDGET_NEAR_LIMIT',
        reason: `total60s=${threshold}; warning=${threshold}; limit=${limit}`,
      },
    ]);
    expect(policy.isLocked()).toBe(false);
    observe(limit);
    observe(threshold - 1);
    expect(policy.active()).toEqual([]);
    expect(events.map((event) => event.event)).toEqual(['alert.raised', 'alert.cleared']);
  });

  it.each([0, -1, 1.5, 901, NaN, Infinity])('rejects an invalid API ceiling %s', (limit) => {
    expect(() => createAlertPolicy({ now: () => 1, mediaApiTotalLimit: limit })).toThrow(
      'INVALID_ALERT_API_BUDGET',
    );
  });

  it('a permission response slower than 1 s is an uncertain policy outcome', () => {
    const policy = createAlertPolicy({ now: () => 1 });
    policy.observe(at(1, { name: 'media.policy.responseLatency', value: 1000, unit: 'ms' }));
    expect(policy.active()).toEqual([]);
    policy.observe(
      at(1, { name: 'media.policy.responseLatency', value: 1001, unit: 'ms', requestId: 'q9' }),
    );
    expect(policy.active()[0]?.id).toBe('MEDIA_POLICY_UNCERTAIN');
    expect(policy.active()[0]?.requestId).toBe('q9');
  });

  it('readiness LOCKED locks operations until READY is observed; tick overload needs acknowledgement', () => {
    const policy = createAlertPolicy({ now: () => 1 });
    policy.observeReadiness('LOCKED');
    expect(policy.isLocked()).toBe(true);
    policy.observeReadiness('RECOVERING');
    expect(policy.isLocked()).toBe(false);
    policy.observe(at(1, { name: 'tick.overload', value: 1, unit: 'count', matchRef: 'm7' }));
    policy.observe(at(2, { name: 'tick.due', value: 1, unit: 'count', matchRef: 'm7' }));
    expect(policy.active().map((a) => a.id)).toEqual(['TICK_OVERLOAD']);
    expect(policy.acknowledgeResolved('TICK_OVERLOAD', 'match m7 aborted, rearmed')).toBe(true);
    expect(policy.snapshot().active).toEqual([]);
  });

  it('observe never throws even for a malformed sample', () => {
    const policy = createAlertPolicy({ now: () => 1 });
    expect(() => policy.observe(undefined as unknown as MetricSample)).not.toThrow();
  });
});

describe('structured events and the log guard', () => {
  it('validates events against the static allowlists and rejects secret-looking fields', () => {
    const ok = validateEvent({
      event: 'operations.drain',
      level: 'info',
      atMs: 5,
      fields: { requestId: 'r', state: 'DRAINING' },
    });
    expect(ok.ok).toBe(true);
    const bad = validateEvent({
      event: 'operations.drain',
      level: 'info',
      atMs: 5,
      fields: { token: 'x' },
    });
    expect(bad).toEqual({ ok: false, reason: 'BAD_FIELD', field: 'token' });
    expect(validateEvent({ event: 'made.up', level: 'info', atMs: 1 }).ok).toBe(false);
    expect(validateEvent({ event: 'server.ready', level: 'debug', atMs: 1 }).ok).toBe(false);
    expect(
      validateEvent({
        event: 'server.ready',
        level: 'info',
        atMs: 1,
        fields: { value: { nested: 1 } },
      }).ok,
    ).toBe(false);
  });

  it('the event logger writes accepted events at their level and counts rejected ones without the payload', () => {
    const lines: Array<[string, Record<string, unknown>]> = [];
    const sink = {
      info: (o: Record<string, unknown>) => lines.push(['info', o]),
      warn: (o: Record<string, unknown>) => lines.push(['warn', o]),
      error: (o: Record<string, unknown>) => lines.push(['error', o]),
    };
    const log = createStructuredEventLogger(sink);
    expect(
      log.emit({
        event: 'server.locked',
        level: 'error',
        atMs: 3,
        fields: { reason: 'READINESS_UNCONFIRMED' },
      }),
    ).toBe(true);
    expect(
      log.emit({ event: 'server.locked', level: 'error', atMs: 3, fields: { secret: 'abc123' } }),
    ).toBe(false);
    expect(log.rejected()).toBe(1);
    expect(lines[0]).toEqual([
      'error',
      { event: 'server.locked', atMs: 3, reason: 'READINESS_UNCONFIRMED' },
    ]);
    expect(lines[1]?.[0]).toBe('warn');
    expect(JSON.stringify(lines)).not.toContain('abc123');
  });

  it('the pino formatter redacts secret keys, truncates long strings and cuts deep or wide payloads', () => {
    const options = createLogOptions({ level: 'info', service: 'kkakkung-test' });
    expect(options.base).toEqual({ service: 'kkakkung-test' });
    const format = options.formatters?.log;
    expect(format).toBeTypeOf('function');
    const sdp = 'v=0\r\n' + 'a=candidate '.repeat(200);
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const wide: Record<string, number> = {};
    for (let i = 0; i < 50; i++) wide[`k${i}`] = i;
    const out = format!({
      token: 'eyJabc',
      Authorization: 'Bearer x',
      rawSdp: sdp,
      note: sdp,
      deep,
      wide,
      ok: 1,
    }) as Record<string, unknown>;
    expect(out.token).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
    expect(out.rawSdp).toBe('[redacted]');
    expect(String(out.note).length).toBeLessThan(sdp.length);
    expect(String(out.note)).toContain('[truncated]');
    expect(JSON.stringify(out.deep)).toContain('[truncated]');
    expect(Object.keys(out.wide as object).length).toBeLessThanOrEqual(33);
    expect(out.ok).toBe(1);
    expect(JSON.stringify(out)).not.toContain('eyJabc');
    expect(sanitizeLogObject(undefined)).toEqual({ value: undefined });
    expect(() => sanitizeLogObject(Symbol('x'))).not.toThrow();
  });
});

describe('collect-observability script', () => {
  const script = resolve(root, 'scripts/collect-observability.mjs');
  const run = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });

  it('aggregates samples, counts rejected lines by reason/field only and flags incompleteness', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kk-obs-'));
    const input = join(dir, 'events.ndjson');
    const output = join(dir, 'out', 'metrics.json');
    const lines: string[] = [];
    for (let round = 0; round < 2; round++)
      for (let room = 0; room < 10; room++)
        lines.push(
          JSON.stringify({
            name: 'tick.duration',
            value: 2,
            unit: 'ms',
            atMs: 100 + round,
            matchRef: `m${room}`,
          }),
        );
    lines.push(JSON.stringify({ name: 'eventLoop.lag', value: 20, unit: 'ms', atMs: 100 }));
    lines.push(JSON.stringify({ name: 'eventLoop.delayP99', value: 880, unit: 'ms', atMs: 100 }));
    lines.push(JSON.stringify({ name: 'media.api.429', value: 1, unit: 'count', atMs: 101 }));
    lines.push(
      JSON.stringify({ name: 'observability.dropped', value: 3, unit: 'count', atMs: 101 }),
    );
    lines.push(
      JSON.stringify({
        event: 'alert.raised',
        level: 'error',
        atMs: 101,
        fields: { alert: 'MEDIA_API_RATE_LIMITED' },
      }),
    );
    lines.push(
      JSON.stringify({ name: 'tick.due', value: 1, unit: 'count', atMs: 1, token: 'SECRET-VALUE' }),
    );
    lines.push(JSON.stringify({ name: 'nope', value: 1, unit: 'count', atMs: 1 }));
    lines.push('{not json');
    writeFileSync(input, lines.join('\n') + '\n');
    const result = run(['--input', input, '--output', output]);
    expect(result.status).toBe(1); // incomplete → nonzero
    expect(result.stdout).toContain('samples=24');
    expect(result.stdout + result.stderr).not.toContain('SECRET-VALUE');
    const report = JSON.parse(readFileSync(output, 'utf8')) as {
      samples: number;
      incomplete: boolean;
      dropped: number;
      unparsable: number;
      rejected: { total: number; byReason: Record<string, number>; fields: Record<string, number> };
      tickRounds: { rounds: number; combined: { p99: number }; perRoom: { mean: number } };
      metrics: Record<string, { unit: string; count: number; p99: number }>;
      events: Record<string, number>;
      alerts: Record<string, boolean>;
    };
    expect(report.samples).toBe(24);
    expect(report.incomplete).toBe(true);
    expect(report.dropped).toBe(3);
    expect(report.unparsable).toBe(1);
    expect(report.rejected).toEqual({
      total: 2,
      byReason: { FORBIDDEN_FIELD: 1, UNREGISTERED_NAME: 1 },
      fields: { token: 1, name: 1 },
    });
    expect(report.tickRounds.rounds).toBe(2);
    expect(report.tickRounds.combined.p99).toBe(20);
    expect(report.tickRounds.perRoom.mean).toBe(2);
    expect(report.metrics['eventLoop.lag']).toMatchObject({ unit: 'ms', count: 1, p99: 20 });
    expect(report.metrics['eventLoop.delayP99']).toMatchObject({ unit: 'ms', count: 1, p99: 880 });
    expect(report.events).toEqual({ 'alert.raised': 1 });
    expect(report.alerts.MEDIA_API_RATE_LIMITED).toBe(true);
    expect(report.alerts.OBSERVABILITY_DROPPED).toBe(true);
    expect(report.alerts.MEDIA_RETIREMENT_UNRESOLVED).toBe(false);
    expect(JSON.stringify(report)).not.toContain('SECRET-VALUE');
  });

  it('exits BLOCKED (3) when the input is missing or holds no valid samples', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kk-obs-'));
    const missing = run(['--input', join(dir, 'none.ndjson'), '--output', join(dir, 'm.json')]);
    expect(missing.status).toBe(3);
    expect(missing.stderr).toContain('BLOCKED');
    const empty = join(dir, 'empty.ndjson');
    writeFileSync(empty, JSON.stringify({ event: 'server.ready', level: 'info', atMs: 1 }) + '\n');
    const none = run(['--input', empty, '--output', join(dir, 'n.json')]);
    expect(none.status).toBe(3);
    expect(existsSync(join(dir, 'n.json'))).toBe(false);
  });

  it('exits 0 for a complete, clean export', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kk-obs-'));
    const input = join(dir, 'clean.ndjson');
    writeFileSync(
      input,
      [
        JSON.stringify({ name: 'tick.duration', value: 1, unit: 'ms', atMs: 1, matchRef: 'm1' }),
        JSON.stringify({ name: 'operations.journal.writable', value: 1, unit: 'count', atMs: 1 }),
      ].join('\n') + '\n',
    );
    const result = run(['--input', input, '--output', join(dir, 'c.json')]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('alerts=none');
  });
});

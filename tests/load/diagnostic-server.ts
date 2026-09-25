// F-14 / QA-10 diagnostic game server. Boots B's real bootstrap with A's real engine, tuning,
// map pipeline and content on an ephemeral port, with NO media coordinator (Cloud SDK is never
// loaded) and an explicit development admission hook. Metrics from the coordinator and a process
// sampler are appended as ndjson for the runner. This profile is a diagnosis target only; it is
// not the product deployment and its readiness says nothing about MEDIA_MODE.
//
//   node --import tsx tests/load/diagnostic-server.ts --max-rooms 10 --metrics <ndjson>
//   env LOAD_OPS_TOKEN=<ephemeral token>   (created by the runner for this process only)
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  createLayoutSelector,
  createTemplateVariants,
  matchCore,
  preparePracticeLayout,
  validateTemplate,
  validateTuning,
} from '@kkakkung/game-core/match';
import { createApplication, type ProductProfile } from '../../server/src/bootstrap.ts';
import { parseConfig } from '../../server/src/config/env.ts';
import type { MetricSample } from '../../server/src/game/ports.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : fallback;
}

const maxRooms = Number(arg('--max-rooms', '10'));
const metricsPath = resolve(arg('--metrics', '.local/qa/QA-10/metrics.ndjson'));
const opsToken = process.env.LOAD_OPS_TOKEN ?? '';
if (!Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 10) {
  console.error('--max-rooms must be 1..10');
  process.exit(2);
}
if (opsToken.length < 16) {
  console.error('LOAD_OPS_TOKEN (>= 16 chars, ephemeral) is required');
  process.exit(2);
}

const tuningRaw = JSON.parse(
  readFileSync(resolve(root, 'server/config/tuning/mvp-v4.json'), 'utf8'),
);
const tuning = validateTuning(tuningRaw);
if (!tuning.ok) {
  console.error('tuning invalid', JSON.stringify(tuning.issues));
  process.exit(2);
}
const masterPath = resolve(root, 'server/content/maps/master-v1.json');
const master = JSON.parse(readFileSync(masterPath, 'utf8')) as {
  templateId: string;
  templateVersion: string | number;
};
// A's placement file wraps its variants in `fallbacks`; B's loader reads a flat array.
const fallbackRaw = JSON.parse(
  readFileSync(resolve(root, 'server/content/placements/master-v1-fallback.json'), 'utf8'),
) as { fallbacks: unknown[] };
const workDir = mkdtempSync(join(tmpdir(), 'kk-load-'));
const fallbackPath = join(workDir, 'fallback.json');
writeFileSync(fallbackPath, JSON.stringify(fallbackRaw.fallbacks));
const practiceRaw = JSON.parse(
  readFileSync(resolve(root, 'server/content/maps/practice-v1.json'), 'utf8'),
);

mkdirSync(dirname(metricsPath), { recursive: true });
const startedWallMs = Date.now();
const startedMonoMs = performance.now();
// Samples are buffered in memory and flushed once a second with one async append, so the
// exporter never puts synchronous file IO on the tick path (that would distort the lag it measures).
let buffer: string[] = [];
let flushing: Promise<void> = Promise.resolve();
const flush = () => {
  if (buffer.length === 0) return flushing;
  const chunk = buffer.join('');
  buffer = [];
  flushing = flushing.then(() => appendFile(metricsPath, chunk)).catch(() => undefined);
  return flushing;
};
const emitMetric = (sample: MetricSample) => {
  try {
    buffer.push(
      JSON.stringify({ ...sample, wallMs: startedWallMs + (sample.atMs - startedMonoMs) }) + '\n',
    );
    if (buffer.length >= 5000) void flush();
  } catch {
    // Observability never breaks the tick path.
  }
};
const flusher = setInterval(() => void flush(), 1000);
flusher.unref();

const layoutConstraints = tuning.template.layout;
const profile: ProductProfile<ReturnType<typeof matchCore.createMatch>> = {
  serverEpoch: `load-${startedWallMs}`,
  maxRooms,
  inviteMaxTtlMs: 6 * 60 * 60_000,
  publicWindow: { opensAtEpochMs: 0, closesAtEpochMs: 4_000_000_000_000 },
  sessionAttempts: { windowMs: 60_000, perInvite: 10_000, perIp: 100_000 },
  roomIdleTtlMs: 30 * 60_000,
  trustProxy: false,
  opsToken,
  createOperatorAuth: (token) => (authorization) => {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
    const presented = Buffer.from(authorization.slice(7), 'utf8');
    const expected = Buffer.from(token, 'utf8');
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  },
  createMediaCoordinator: null,
  mediaConfig: null,
  core: matchCore,
  tuning: tuning.template.match,
  practice: { port: { preparePracticeLayout }, raw: practiceRaw },
  layouts: {
    maps: {
      validateTemplate: (raw, source) =>
        validateTemplate(raw, source, { minSpawnNeighbors: layoutConstraints.minSpawnNeighbors }),
      createTemplateVariants,
    },
    selection: createLayoutSelector({
      layout: layoutConstraints,
      selection: tuning.template.selection,
    }),
    masterPath,
    fallbackPath,
    templateId: master.templateId,
    templateVersion: String(master.templateVersion),
  },
  emitMetric,
  assetVersion: 'load-diagnostic',
  developmentAdmission: () => 'OPEN',
};

const config = {
  ...parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }),
  port: 0,
};
const application = createApplication(config, profile);
const port = await application.listen();

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();
let lastCpu = process.cpuUsage();
let lastCpuAtMs = performance.now();
const sampler = setInterval(() => {
  const atMs = performance.now();
  // Server process CPU as a 0–1 ratio of wall time since the previous sample (both cores summed).
  const cpu = process.cpuUsage();
  const busyMicros = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
  const wallMicros = (atMs - lastCpuAtMs) * 1000;
  lastCpu = cpu;
  lastCpuAtMs = atMs;
  if (wallMicros > 0)
    emitMetric({ name: 'diag.cpuRatio', value: busyMicros / wallMicros, unit: 'ratio', atMs });
  // Diagnostic-only histogram of event-loop delay. Not the judged `eventLoop.lag` (that one is
  // the coordinator's per-tick lag); a 10 ms timer's p99 delay would otherwise pollute it.
  emitMetric({
    name: 'diag.eventLoopDelayP99',
    value: histogram.percentile(99) / 1_000_000,
    unit: 'ms',
    atMs,
  });
  histogram.reset();
  emitMetric({ name: 'process.memory', value: process.memoryUsage().rss, unit: 'bytes', atMs });
}, 5000);
sampler.unref();

console.log(JSON.stringify({ event: 'listening', port, maxRooms, metricsPath, pid: process.pid }));

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  clearInterval(sampler);
  clearInterval(flusher);
  histogram.disable();
  void application
    .close()
    .then(() => flush())
    .then(() => {
      console.log(JSON.stringify({ event: 'closed' }));
      process.exit(0);
    })
    .catch(() => process.exit(1));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
process.stdin.resume();

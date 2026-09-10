#!/usr/bin/env node
// Owned by F (F-14 / QA-10). Turns a run-game-load evidence directory into one summary:
// per-stage verdicts, p95/p99 of acceptance latency and lag, combined tick distribution (when
// tick.duration samples exist), memory slope, overload/abort counts, and whether the 30-minute
// final stage actually ran. Exit 0 when every stage PASSed, 1 otherwise, 3 when there is nothing
// to summarize.
//
//   node scripts/summarize-load.mjs --input .local/qa/QA-10 --output .local/qa/QA-10/summary.json

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}
const input = resolve(arg('--input', '.local/qa/QA-10'));
const output = resolve(arg('--output', resolve(input, 'summary.json')));
if (!existsSync(input)) {
  console.error(`BLOCKED: no evidence directory ${input}`);
  process.exit(3);
}
const stageFiles = readdirSync(input)
  .filter((f) => /^stage-\d+-rooms\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
if (stageFiles.length === 0) {
  console.error('BLOCKED: no stage results (run-game-load did not complete a stage)');
  process.exit(3);
}
const run = existsSync(resolve(input, 'run.json'))
  ? JSON.parse(readFileSync(resolve(input, 'run.json'), 'utf8'))
  : null;
const stages = stageFiles.map((f) => JSON.parse(readFileSync(resolve(input, f), 'utf8')));
const finalStage = stages.at(-1);
const thirtyMinuteRun = finalStage.rooms === 10 && finalStage.durationSeconds >= 1800;
const summary = {
  generatedAt: new Date().toISOString(),
  sourceCommit: run?.sourceCommit ?? finalStage.sourceCommit ?? 'unknown',
  network: run?.network ?? finalStage.network ?? null,
  cloudRequests: run?.cloudRequests ?? 0,
  serverExitCode: run?.serverExitCode ?? null,
  clientsLeftOpen: run?.clientsLeftOpen ?? null,
  thirtyMinuteRun,
  verdict: stages.every((s) => s.status === 'PASS')
    ? thirtyMinuteRun
      ? 'PASS'
      : 'PASS_PARTIAL'
    : stages.some((s) => s.status === 'FAIL')
      ? 'FAIL'
      : 'INCOMPLETE',
  highestRoomsPassed: Math.max(0, ...stages.filter((s) => s.status === 'PASS').map((s) => s.rooms)),
  stages: stages.map((s) => ({
    rooms: s.rooms,
    clients: s.clients,
    durationSeconds: s.durationSeconds,
    status: s.status,
    stopEscalation: s.stopEscalation,
    commandAck: pick(s.distributions.commandAckMs),
    lag: s.distributions.lagMs ? pick(s.distributions.lagMs) : null,
    tickCombined: s.distributions.tickCombinedMs ? pick(s.distributions.tickCombinedMs) : null,
    rssSlopeBytesPerMinute: s.distributions.rssSlopeBytesPerMinute,
    eventLoopDelayP99: s.distributions.eventLoopDelayP99Ms
      ? pick(s.distributions.eventLoopDelayP99Ms)
      : null,
    serverCpuRatio: s.distributions.serverCpuRatio ? pick(s.distributions.serverCpuRatio) : null,
    failed: s.checks.filter((c) => c.status === 'FAIL').map((c) => c.name),
    notMeasured: s.checks.filter((c) => c.status === 'NOT_MEASURED').map((c) => c.name),
  })),
  note: 'Game-only diagnosis (no Cloud). Not G6 media integration evidence. tick.combined needs B tick.duration samples (F-REQ-10).',
};
function pick(d) {
  return { count: d.count, p50: d.p50, p95: d.p95, p99: d.p99, max: d.max };
}
writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(
  `summarize-load: verdict=${summary.verdict} highestRoomsPassed=${summary.highestRoomsPassed} thirtyMinute=${thirtyMinuteRun} stages=${stages.map((s) => `${s.rooms}:${s.status}`).join(',')}`,
);
process.exit(summary.verdict === 'PASS' ? 0 : 1);

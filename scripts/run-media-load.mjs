#!/usr/bin/env node
// Owned by F (F-17 / QA-11, F-18 / QA-12). The only entry for a real-media load stage. It maps
// exactly two argument shapes to the Cloud cases, checks the preflight's stage durations and
// budget against the pure plan, and then delegates to scripts/run-cloud-check.mjs (which
// re-validates the preflight, namespace and evidence directory and runs one allowlisted file).
//
//   node scripts/run-media-load.mjs --stages 1,3,5 --preflight <file> --evidence .local/qa/QA-11
//   node scripts/run-media-load.mjs --stages 10 --duration-seconds 900 --scenario integrated-v0.0.8 \
//     --preflight <file> --evidence .local/qa/QA-12
//
// Any other stage/scenario combination exits 2. Missing durations, an unaffordable plan or a
// missing case are BLOCKED (3). Nothing here spends Cloud time by itself.

import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTool } from './lib/run-tool.mjs';
import { buildScenario } from '../tests/load/MediaLoadScenario.ts';
import { TEN_ROOM_TARGET } from '../tests/load/TenRoomSchedule.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Pure argument → case mapping. Returns { case, stages } or { error }. */
export function selectMediaCase(args) {
  const stages = String(args.stages ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  if (stages.join(',') === '1,3,5' && !args.durationSeconds && !args.scenario)
    return { case: 'QA-11', stages: [1, 3, 5] };
  if (
    stages.join(',') === '10' &&
    Number(args.durationSeconds) === TEN_ROOM_TARGET.durationSeconds &&
    args.scenario === TEN_ROOM_TARGET.scenario
  )
    return { case: 'QA-12', stages: [10] };
  return {
    error:
      'unsupported combination: use --stages 1,3,5 (QA-11) or --stages 10 --duration-seconds 900 --scenario integrated-v0.0.8 (QA-12)',
  };
}

/**
 * Budget and duration gate on the preflight document (already parsed JSON). Returns
 * { ok: true, plan } or { ok: false, reason }. Never fills a missing duration with a default.
 */
export function planMediaLoad(selected, preflight) {
  if (selected.case === 'QA-11') {
    const durations = preflight.stageDurationSeconds;
    if (!durations)
      return { ok: false, reason: 'preflight.stageDurationSeconds missing (1/3/5 required)' };
    let scenario;
    try {
      scenario = buildScenario({
        stages: [1, 3, 5],
        stageDurationSeconds: durations,
        remainingMinutes: preflight.remainingMinutes,
        remainingBytes: preflight.remainingBytes,
        reservation: preflight.budgetReservation,
      });
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (scenario.affordableStages < 3)
      return {
        ok: false,
        reason: `budget covers ${scenario.affordableStages}/3 stages (${scenario.totalParticipantMinutes} participant-minutes needed); no synthetic substitute for Cloud`,
      };
    if (preflight.maxRooms < 5 || preflight.maxParticipants < 30)
      return { ok: false, reason: 'preflight allows fewer than 5 rooms / 30 participants' };
    return { ok: true, plan: scenario };
  }
  const needMinutes = TEN_ROOM_TARGET.participantMinutes + TEN_ROOM_TARGET.planningMinutes;
  if (
    preflight.remainingMinutes < needMinutes ||
    preflight.budgetReservation.participantMinutes < needMinutes
  )
    return {
      ok: false,
      reason: `QA-12 needs ${needMinutes} participant-minutes (900 + 300 plan); remaining ${preflight.remainingMinutes}, reserved ${preflight.budgetReservation.participantMinutes}`,
    };
  if (preflight.maxRooms < 10 || preflight.maxParticipants < 60)
    return { ok: false, reason: 'preflight allows fewer than 10 rooms / 60 participants' };
  if (preflight.maxDurationSeconds < TEN_ROOM_TARGET.durationSeconds + 180)
    return {
      ok: false,
      reason: 'preflight.maxDurationSeconds must cover connection plus the 900 s window',
    };
  if (
    !Number.isSafeInteger(preflight.cleanupAllowanceSeconds) ||
    preflight.cleanupAllowanceSeconds <= 0
  )
    return {
      ok: false,
      reason: 'preflight.cleanupAllowanceSeconds must be set separately for retirement',
    };
  return { ok: true, plan: { ...TEN_ROOM_TARGET, participantMinutesReserved: needMinutes } };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stages') out.stages = argv[++i];
    else if (a === '--duration-seconds') out.durationSeconds = argv[++i];
    else if (a === '--scenario') out.scenario = argv[++i];
    else if (a === '--preflight') out.preflight = argv[++i];
    else if (a === '--evidence') out.evidence = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
  }
  return out;
}

if (basename(process.argv[1] ?? '') === 'run-media-load.mjs') {
  const args = parseArgs(process.argv.slice(2));
  const selected = selectMediaCase(args);
  if (selected.error) {
    console.error(selected.error);
    process.exit(2);
  }
  if (!args.preflight || !args.evidence) {
    console.error('--preflight and --evidence are required');
    process.exit(2);
  }
  const preflightPath = resolve(root, args.preflight);
  if (!existsSync(preflightPath)) {
    console.error(`BLOCKED: preflight not found ${args.preflight}`);
    process.exit(3);
  }
  const preflight = JSON.parse(readFileSync(preflightPath, 'utf8'));
  const planned = planMediaLoad(selected, preflight);
  if (!planned.ok) {
    console.error(`BLOCKED: ${planned.reason}`);
    process.exit(3);
  }
  console.log(JSON.stringify({ case: selected.case, plan: planned.plan }, null, 2));
  const run = runTool(
    'node',
    [
      'scripts/run-cloud-check.mjs',
      '--case',
      selected.case,
      '--preflight',
      args.preflight,
      '--evidence',
      args.evidence,
      ...(args.dryRun ? ['--dry-run'] : []),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  process.exit(run.status ?? 1);
}

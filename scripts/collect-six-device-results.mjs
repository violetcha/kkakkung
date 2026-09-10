#!/usr/bin/env node
// Owned by F (F-15 / QA-09). Validates the manual six-device five-match record described in
// tests/fixtures/manual-six-device.md and writes one report. It checks what people actually
// wrote: six distinct real devices, five consecutive finished matches, every required behaviour
// covered at least once, no growth of leftover tracks/workers/textures/rooms across matches,
// and the FPS targets per preset. Empty fields are INCOMPLETE, never PASS. Undecided items
// (PRODUCT_DECISION_PENDING) are listed but never counted as failures.
//
//   node scripts/collect-six-device-results.mjs --input .local/qa/six-device --output .local/qa/QA-09.json
//
// Exit 0 PASS, 1 FAIL or INCOMPLETE, 3 when the record files are missing.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const REQUIRED_COVERAGE = Object.freeze([
  'invite-entry',
  'camera-mic-independent',
  'mic-denied-user',
  'calibration',
  'team-practice',
  'loading-countdown',
  'three-minute-round',
  'result-screen',
  'rematch-same',
  'rematch-swap',
  'rematch-lobby',
  'map-exchange',
  'sensor',
  'trap',
  'restraint-expiry',
  'capture',
  'pose-left',
  'pose-right',
  'pose-y',
  'pose-fallback',
  'past-event-marker',
  'personal-end-leave',
  'connection-lost-notice',
]);

export const PRODUCT_DECISION_PENDING = Object.freeze([
  'MP-06',
  'EQ-06',
  'EQ-07',
  'EQ-08',
  'EQ-09',
  'EQ-12',
  'G3-C',
]);

export const FPS_TARGET = Object.freeze({ mid: 45, low: 30 });
const LEAK_FIELDS = Object.freeze(['tracks', 'workers', 'textures', 'rooms']);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Pure validation of `{ devices, matches }` (the two JSON files already parsed).
 * Returns `{ status, issues, incomplete, summary }`; `issues` fail, `incomplete` are blanks.
 */
export function validateSixDeviceRecords(input) {
  const issues = [];
  const incomplete = [];
  const devicesDoc = input.devices ?? {};
  const matchesDoc = input.matches ?? {};
  const devices = Array.isArray(devicesDoc.devices) ? devicesDoc.devices : [];
  const matches = Array.isArray(matchesDoc.matches) ? matchesDoc.matches : [];

  if (!nonEmpty(devicesDoc.sourceCommit) || !/^[0-9a-f]{40}$/.test(devicesDoc.sourceCommit))
    incomplete.push('devices.sourceCommit (40-hex) missing');
  if (!devicesDoc.network || !nonEmpty(devicesDoc.network.measured))
    incomplete.push('devices.network.measured missing');

  // Six distinct, real, described devices.
  if (devices.length !== 6) issues.push(`devices: ${devices.length} recorded, 6 required`);
  const ids = new Set();
  for (const d of devices) {
    if (!nonEmpty(d.deviceId)) incomplete.push('device without deviceId');
    else if (ids.has(d.deviceId)) issues.push(`duplicate deviceId ${d.deviceId}`);
    else ids.add(d.deviceId);
    if (d.realDevice !== true)
      issues.push(
        `${d.deviceId ?? '?'}: not a real device (browser contexts on one machine are not six devices)`,
      );
    for (const field of ['model', 'os', 'browser', 'camera', 'participant', 'verifiedAt'])
      if (!nonEmpty(d[field])) incomplete.push(`${d.deviceId ?? '?'}.${field} missing`);
    if (d.preset !== 'mid' && d.preset !== 'low')
      incomplete.push(`${d.deviceId ?? '?'}.preset must be mid|low`);
  }

  // Five consecutive finished matches, each covering all six devices.
  if (matches.length !== 5) issues.push(`matches: ${matches.length} recorded, 5 required`);
  const orders = matches.map((m) => m.order);
  if (matches.length === 5 && orders.join(',') !== '1,2,3,4,5')
    issues.push(`match order must be 1..5, got ${orders.join(',')}`);
  const matchIds = new Set();
  const covered = new Set();
  const pendingUsed = new Set();
  const leakSeries = new Map();
  const fpsByDevice = new Map();
  for (const m of matches) {
    const label = m.matchId ?? `#${m.order ?? '?'}`;
    if (!nonEmpty(m.matchId)) incomplete.push(`match ${label}: matchId missing`);
    else if (matchIds.has(m.matchId)) issues.push(`duplicate matchId ${m.matchId}`);
    else matchIds.add(m.matchId);
    if (!['two-captured', 'two-escaped', 'timeout'].includes(m.result))
      incomplete.push(`match ${label}: result missing or not a round result`);
    if (!nonEmpty(m.startedAt) || !nonEmpty(m.endedAt))
      incomplete.push(`match ${label}: startedAt/endedAt missing`);
    for (const tag of m.coverage ?? []) {
      if (PRODUCT_DECISION_PENDING.includes(tag)) pendingUsed.add(tag);
      else covered.add(tag);
    }
    for (const tag of m.pending ?? []) pendingUsed.add(tag);
    const perDevice = m.devices ?? {};
    for (const id of ids) {
      const rec = perDevice[id];
      if (!rec) {
        incomplete.push(`match ${label}: device ${id} has no record`);
        continue;
      }
      if (!finite(rec.fpsAvg) || !finite(rec.fpsMin))
        incomplete.push(`match ${label}: ${id} fps missing`);
      else {
        const list = fpsByDevice.get(id) ?? [];
        list.push(rec.fpsAvg);
        fpsByDevice.set(id, list);
      }
      if (!finite(rec.remoteFaces)) incomplete.push(`match ${label}: ${id} remoteFaces missing`);
      if (typeof rec.nearVoice !== 'boolean')
        incomplete.push(`match ${label}: ${id} nearVoice missing`);
      if (typeof rec.audioDuplicate !== 'boolean')
        incomplete.push(`match ${label}: ${id} audioDuplicate missing`);
      else if (rec.audioDuplicate) issues.push(`match ${label}: ${id} duplicated audio`);
      if (!['granted', 'denied', 'prompted'].includes(rec.playbackPermission))
        incomplete.push(`match ${label}: ${id} playbackPermission missing`);
      const after = rec.afterEnd;
      if (!after || LEAK_FIELDS.some((f) => !finite(after[f])))
        incomplete.push(`match ${label}: ${id} afterEnd counts missing`);
      else {
        const series = leakSeries.get(id) ?? [];
        series.push({ order: m.order, ...after });
        leakSeries.set(id, series);
      }
    }
  }

  // Coverage: every required behaviour at least once over the five matches.
  const missingCoverage = REQUIRED_COVERAGE.filter((tag) => !covered.has(tag));
  if (matches.length > 0 && missingCoverage.length)
    issues.push(`coverage missing: ${missingCoverage.join(', ')}`);

  // Leaks: leftover counts must not grow from one match to the next on any device.
  for (const [id, series] of leakSeries) {
    const ordered = [...series].sort((a, b) => a.order - b.order);
    for (let i = 1; i < ordered.length; i++)
      for (const f of LEAK_FIELDS)
        if (ordered[i][f] > ordered[i - 1][f])
          issues.push(
            `${id}: ${f} grew ${ordered[i - 1][f]} → ${ordered[i][f]} between match ${ordered[i - 1].order} and ${ordered[i].order} (leak)`,
          );
  }

  // FPS targets by preset, averaged over the five matches.
  const presets = new Map(devices.map((d) => [d.deviceId, d.preset]));
  const fps = {};
  for (const [id, list] of fpsByDevice) {
    const avg = list.reduce((s, v) => s + v, 0) / list.length;
    const target = FPS_TARGET[presets.get(id)] ?? null;
    fps[id] = { avg: Math.round(avg * 10) / 10, target };
    if (target !== null && avg < target)
      issues.push(`${id}: average fps ${avg.toFixed(1)} below ${presets.get(id)} target ${target}`);
  }

  const status = issues.length ? 'FAIL' : incomplete.length ? 'INCOMPLETE' : 'PASS';
  return {
    status,
    issues,
    incomplete,
    summary: {
      devices: devices.length,
      realDevices: devices.filter((d) => d.realDevice === true).length,
      matches: matches.length,
      coverage: {
        required: REQUIRED_COVERAGE.length,
        covered: REQUIRED_COVERAGE.length - missingCoverage.length,
        missing: missingCoverage,
      },
      pendingUsed: [...pendingUsed].sort(),
      fps,
      sourceCommit: devicesDoc.sourceCommit ?? null,
    },
  };
}

if (basename(process.argv[1] ?? '') === 'collect-six-device-results.mjs') {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
  };
  const input = resolve(arg('--input', '.local/qa/six-device'));
  const output = resolve(arg('--output', '.local/qa/QA-09.json'));
  const read = (name) => {
    const file = resolve(input, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };
  const devices = read('devices.json');
  const matches = read('matches.json');
  if (!devices || !matches) {
    console.error(
      `BLOCKED: devices.json and matches.json are required in ${input} (see tests/fixtures/manual-six-device.md)`,
    );
    process.exitCode = 3;
  } else {
    const result = validateSixDeviceRecords({ devices, matches });
    writeFileSync(
      output,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          input: input.replace(/\\/g, '/'),
          ...result,
          note: 'Manual six-device five-match record only. Browser-assisted QA-09 runs never make G5 PASS. Undecided items are listed, not judged.',
        },
        null,
        2,
      ) + '\n',
    );
    for (const line of result.issues) console.log(`FAIL        ${line}`);
    for (const line of result.incomplete) console.log(`INCOMPLETE  ${line}`);
    console.log(
      `collect-six-device-results: ${result.status} devices=${result.summary.realDevices}/6 matches=${result.summary.matches}/5 coverage=${result.summary.coverage.covered}/${result.summary.coverage.required}`,
    );
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  }
}

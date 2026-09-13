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
import { evidenceTime, isCommit, isCount, isObject } from './evidence-values.mjs';

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
  const devicesDoc = input?.devices ?? {};
  const matchesDoc = input?.matches ?? {};
  const devices = Array.isArray(devicesDoc.devices) ? devicesDoc.devices : [];
  const matches = Array.isArray(matchesDoc.matches) ? matchesDoc.matches : [];

  if (!isCommit(devicesDoc.sourceCommit)) incomplete.push('devices.sourceCommit (40-hex) missing');
  if (!isCommit(matchesDoc.sourceCommit)) incomplete.push('matches.sourceCommit (40-hex) missing');
  else if (matchesDoc.sourceCommit !== devicesDoc.sourceCommit)
    issues.push('records sourceCommit mismatch');
  if (!devicesDoc.network || !nonEmpty(devicesDoc.network.measured))
    incomplete.push('devices.network.measured missing');

  // Six distinct, real, described devices.
  if (devices.length !== 6) issues.push(`devices: ${devices.length} recorded, 6 required`);
  const ids = new Set();
  const verifiedTimes = new Map();
  for (const d of devices) {
    if (!isObject(d)) {
      issues.push('invalid device record');
      continue;
    }
    if (!nonEmpty(d.deviceId)) incomplete.push('device without deviceId');
    else if (ids.has(d.deviceId)) issues.push(`duplicate deviceId ${d.deviceId}`);
    else ids.add(d.deviceId);
    if (d.realDevice !== true)
      issues.push(
        `${d.deviceId ?? '?'}: not a real device (browser contexts on one machine are not six devices)`,
      );
    for (const field of ['model', 'os', 'browser', 'camera', 'participant', 'verifiedAt'])
      if (!nonEmpty(d[field])) incomplete.push(`${d.deviceId ?? '?'}.${field} missing`);
    const verified = evidenceTime(d.verifiedAt);
    if (verified === null) incomplete.push(`${d.deviceId ?? '?'}.verifiedAt invalid timestamp`);
    else verifiedTimes.set(d.deviceId, verified);
    if (d.preset !== 'mid' && d.preset !== 'low')
      incomplete.push(`${d.deviceId ?? '?'}.preset must be mid|low`);
  }

  // Five consecutive finished matches, each covering all six devices.
  if (matches.length !== 5) issues.push(`matches: ${matches.length} recorded, 5 required`);
  const orders = matches.map((m) => m?.order);
  if (matches.length === 5 && orders.join(',') !== '1,2,3,4,5')
    issues.push(`match order must be 1..5, got ${orders.join(',')}`);
  const matchIds = new Set();
  const covered = new Set();
  const pendingUsed = new Set();
  const leakSeries = new Map();
  const fpsByDevice = new Map();
  const videoReceivers = new Set();
  const audioReceivers = new Set();
  let deniedMicrophoneVerified = false;
  let previousEnd = null;
  for (const m of matches) {
    if (!isObject(m)) {
      issues.push('invalid match record');
      continue;
    }
    const label = m.matchId ?? `#${m.order ?? '?'}`;
    if (!nonEmpty(m.matchId)) incomplete.push(`match ${label}: matchId missing`);
    else if (matchIds.has(m.matchId)) issues.push(`duplicate matchId ${m.matchId}`);
    else matchIds.add(m.matchId);
    if (!['two-captured', 'two-escaped', 'timeout'].includes(m.result))
      incomplete.push(`match ${label}: result missing or not a round result`);
    if (!isCommit(m.sourceCommit)) incomplete.push(`match ${label}: sourceCommit missing`);
    else if (m.sourceCommit !== devicesDoc.sourceCommit)
      issues.push(`match ${label}: sourceCommit mismatch`);
    const started = evidenceTime(m.startedAt);
    const ended = evidenceTime(m.endedAt);
    if (started === null || ended === null)
      incomplete.push(`match ${label}: startedAt/endedAt invalid timestamp`);
    else {
      if (ended <= started) issues.push(`match ${label}: endedAt must follow startedAt`);
      if (previousEnd !== null && started < previousEnd)
        issues.push(`match ${label}: matches overlap or run out of order`);
      previousEnd = ended;
      for (const [id, verified] of verifiedTimes)
        if (verified > started) issues.push(`match ${label}: ${id} verified after match start`);
    }
    if (!Array.isArray(m.coverage)) incomplete.push(`match ${label}: coverage missing`);
    for (const tag of Array.isArray(m.coverage) ? m.coverage : []) {
      if (PRODUCT_DECISION_PENDING.includes(tag)) pendingUsed.add(tag);
      else covered.add(tag);
    }
    for (const tag of Array.isArray(m.pending) ? m.pending : []) pendingUsed.add(tag);
    if (!Array.isArray(m.failures)) incomplete.push(`match ${label}: failures record missing`);
    else if (m.failures.length)
      issues.push(`match ${label}: failures remain in the five-match run`);
    if (!['same', 'swap', 'lobby', 'none'].includes(m.rematch))
      incomplete.push(`match ${label}: rematch missing`);
    const perDevice = isObject(m.devices) ? m.devices : {};
    if (Object.keys(perDevice).some((id) => !ids.has(id)))
      issues.push(`match ${label}: unknown device record`);
    for (const id of ids) {
      const rec = perDevice[id];
      if (!isObject(rec)) {
        incomplete.push(`match ${label}: device ${id} has no record`);
        continue;
      }
      if (!finite(rec.fpsAvg) || !finite(rec.fpsMin))
        incomplete.push(`match ${label}: ${id} fps missing`);
      else if (rec.fpsAvg <= 0 || rec.fpsMin < 0 || rec.fpsMin > rec.fpsAvg)
        issues.push(`match ${label}: ${id} invalid fps range`);
      else {
        const list = fpsByDevice.get(id) ?? [];
        list.push(rec.fpsAvg);
        fpsByDevice.set(id, list);
      }
      if (!isCount(rec.remoteFaces) || rec.remoteFaces > 5)
        incomplete.push(`match ${label}: ${id} remoteFaces must be an integer 0..5`);
      if (rec.cameraReady !== true) issues.push(`match ${label}: ${id} camera not ready`);
      if (!['granted', 'denied'].includes(rec.microphonePermission))
        incomplete.push(`match ${label}: ${id} microphonePermission missing`);
      if (typeof rec.nearVoice !== 'boolean')
        incomplete.push(`match ${label}: ${id} nearVoice missing`);
      if (typeof rec.audioDuplicate !== 'boolean')
        incomplete.push(`match ${label}: ${id} audioDuplicate missing`);
      else if (rec.audioDuplicate) issues.push(`match ${label}: ${id} duplicated audio`);
      if (!['granted', 'denied', 'prompted'].includes(rec.playbackPermission))
        incomplete.push(`match ${label}: ${id} playbackPermission missing`);
      const after = rec.afterEnd;
      if (!after || LEAK_FIELDS.some((f) => !isCount(after[f])))
        incomplete.push(`match ${label}: ${id} afterEnd counts missing`);
      else {
        const series = leakSeries.get(id) ?? [];
        series.push({ order: m.order, ...after });
        leakSeries.set(id, series);
      }
    }
    const checks = Array.isArray(m.mediaChecks) ? m.mediaChecks : [];
    if (!checks.length) incomplete.push(`match ${label}: mediaChecks missing`);
    const positiveKinds = new Set();
    for (const check of checks) {
      if (!isObject(check)) {
        issues.push(`match ${label}: invalid media check`);
        continue;
      }
      const receiver = perDevice[check.receiverDeviceId];
      const sender = perDevice[check.senderDeviceId];
      const at = evidenceTime(check.observedAt);
      if (
        !ids.has(check.receiverDeviceId) ||
        !ids.has(check.senderDeviceId) ||
        check.receiverDeviceId === check.senderDeviceId ||
        !isObject(receiver) ||
        !isObject(sender) ||
        !['video', 'audio'].includes(check.kind) ||
        typeof check.allowed !== 'boolean' ||
        typeof check.observed !== 'boolean' ||
        at === null ||
        started === null ||
        ended === null ||
        at < started ||
        at > ended
      ) {
        issues.push(`match ${label}: invalid media pair or observation time`);
        continue;
      }
      if (check.allowed !== check.observed)
        issues.push(`match ${label}: ${check.kind} allowed/observed mismatch`);
      if (!check.allowed || !check.observed) continue;
      positiveKinds.add(check.kind);
      if (check.kind === 'video') {
        videoReceivers.add(check.receiverDeviceId);
        if (!(receiver.remoteFaces > 0))
          issues.push(`match ${label}: positive video has zero remoteFaces`);
      } else {
        audioReceivers.add(check.receiverDeviceId);
        if (
          !receiver.nearVoice ||
          receiver.playbackPermission !== 'granted' ||
          sender.microphonePermission !== 'granted'
        )
          issues.push(`match ${label}: positive audio contradicts device permissions or nearVoice`);
        if (
          receiver.microphonePermission === 'denied' &&
          receiver.cameraReady &&
          ['map-exchange', 'escape'].includes(receiver.micDeniedAction)
        )
          deniedMicrophoneVerified = true;
      }
    }
    for (const kind of ['video', 'audio'])
      if (!positiveKinds.has(kind))
        incomplete.push(`match ${label}: no allowed ${kind} reception verified`);
  }
  for (const id of ids) {
    if (!videoReceivers.has(id)) incomplete.push(`${id}: no allowed video reception verified`);
    if (!audioReceivers.has(id)) incomplete.push(`${id}: no allowed audio reception verified`);
  }
  if (!deniedMicrophoneVerified)
    incomplete.push('microphone-denied camera/action/received-audio path not verified');
  for (const mode of ['same', 'swap', 'lobby'])
    if (!matches.some((m) => m?.rematch === mode))
      issues.push(`rematch mode not exercised: ${mode}`);

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
  const presets = new Map(devices.filter(isObject).map((d) => [d.deviceId, d.preset]));
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
      realDevices: devices.filter((d) => d?.realDevice === true).length,
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

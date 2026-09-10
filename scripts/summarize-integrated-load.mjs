#!/usr/bin/env node
// Owned by F (F-18 / QA-12). Turns a ten-room integrated evidence directory into one summary:
// per-window tags, the measured 60-session seconds, G2/G6/cleanup verdicts on the same normal
// intervals, and the publication hold. Exit 0 only when every gate PASSes, 1 otherwise, 3 when
// the evidence is missing. Thresholds come from tests/load/TenRoomSchedule.ts and are never relaxed.
//
//   node scripts/summarize-integrated-load.mjs --input .local/qa/QA-12 --output .local/qa/QA-12-summary.json

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { evaluateIntegrated } from '../tests/load/TenRoomSchedule.ts';

/** Reads windows.json / cleanup.json / official-after.json / requirements.json from the directory. */
export function loadIntegratedEvidence(directory) {
  const read = (name) => {
    const file = resolve(directory, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };
  const windows = read('windows.json');
  if (!Array.isArray(windows)) return { error: 'windows.json missing or not an array' };
  const cleanup = read('cleanup.json');
  const requirements = read('requirements.json');
  return {
    input: {
      windows,
      unresolvedRetirements: cleanup?.unresolvedRetirements ?? Number.POSITIVE_INFINITY,
      officialAfter: read('official-after.json'),
      observedRequirements: Array.isArray(requirements) ? requirements : [],
    },
  };
}

if (basename(process.argv[1] ?? '') === 'summarize-integrated-load.mjs') {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
  };
  const input = resolve(arg('--input', '.local/qa/QA-12'));
  const output = resolve(arg('--output', '.local/qa/QA-12-summary.json'));
  // No process.exit(): an immediate exit after stderr output trips a libuv assertion on Windows
  // under the TypeScript loader. The exit code is set and the process drains on its own.
  let blocked = existsSync(input) ? null : `no evidence directory ${input}`;
  const loaded = blocked ? null : loadIntegratedEvidence(input);
  if (!blocked && loaded.error) blocked = loaded.error;
  if (blocked) {
    console.error(`BLOCKED: ${blocked}`);
    process.exitCode = 3;
  } else {
    report(loaded.input, input, output);
  }
}

function report(evidence, input, output) {
  const summary = evaluateIntegrated(evidence);
  writeFileSync(
    output,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        input: input.replace(/\\/g, '/'),
        ...summary,
        note: 'Same-interval G2/G6 judgement; transitional, reduced and destructive windows reported apart. 60 concurrent seconds are measured, never extrapolated from one room.',
      },
      null,
      2,
    ) + '\n',
  );
  const line = summary.gates.map((g) => `${g.gate}=${g.status}`).join(' ');
  console.log(
    `summarize-integrated-load: ${line} normal=${summary.normalWindows} reduced=${summary.reducedWindows} sixty=${summary.measuredSixtySeconds}s publishHold=${summary.publishHold}`,
  );
  process.exitCode = summary.gates.every((g) => g.status === 'PASS') ? 0 : 1;
}

#!/usr/bin/env node
// Owned by F (F-01 / DP-01). The only entry point that may start a Cloud test case.
//
//   node scripts/run-cloud-check.mjs --case QA-02 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-02
//
// Order: case allowlist -> preflight document -> namespace/time/budget/device checks -> one
// Vitest run of exactly the allowlisted file. Missing prerequisites exit nonzero with BLOCKED.
// Test failures and unconfirmed cleanup also exit nonzero. No secret values are printed.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runTool } from './lib/run-tool.mjs';
import { createHash } from 'node:crypto';
import {
  CLOUD_CASES,
  NON_CLOUD_CASES,
  loadCloudPreflight,
  PreflightError,
} from '../tests/cloud/CloudPreflight.ts';

// KKAKKUNG_QA_ROOT is a test seam only: the contract tests point it at an empty directory to
// exercise the "file not handed over" branch now that every registered case has a file.
const root = process.env.KKAKKUNG_QA_ROOT
  ? resolve(process.env.KKAKKUNG_QA_ROOT)
  : fileURLToPath(new URL('../', import.meta.url));

function usage(message) {
  console.error(message);
  console.error(
    'usage: node scripts/run-cloud-check.mjs --case <ID> --preflight <file> --evidence <dir> [--dry-run]',
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--case' || a === '--preflight' || a === '--evidence') {
      const v = argv[++i];
      if (!v) usage(`missing value for ${a}`);
      out[a.slice(2)] = v;
    } else usage(`unknown argument ${a}`);
  }
  if (!out.case || !out.preflight || !out.evidence)
    usage('--case, --preflight and --evidence are required');
  return out;
}

function blocked(reason, detail) {
  console.error(`BLOCKED: ${reason}`);
  if (detail) for (const line of detail) console.error(`  - ${line}`);
  process.exit(3);
}

export function selectCase(id) {
  if (NON_CLOUD_CASES.includes(id))
    return { error: `${id} is not a Cloud case (local fixture only)` };
  const file = CLOUD_CASES[id];
  if (!file) return { error: `${id} is not in the Cloud case allowlist` };
  return { file };
}

function countTests(source) {
  return (source.match(/^\s*(?:it|test)(?:\.(?:each|only|concurrent))?\s*\(/gm) ?? []).length;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = selectCase(args.case);
  if (selected.error) blocked(selected.error);
  const testFile = resolve(root, selected.file);
  if (!existsSync(testFile))
    blocked(`test file for ${args.case} has not been handed over: ${selected.file}`);
  const testCount = countTests(readFileSync(testFile, 'utf8'));
  if (testCount === 0) blocked(`no tests found in ${selected.file}`);

  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const sourceCommit = head.status === 0 ? head.stdout.trim() : undefined;
  const lockfileHash = createHash('sha256')
    .update(readFileSync(resolve(root, 'pnpm-lock.yaml')))
    .digest('hex');

  let preflight;
  try {
    preflight = loadCloudPreflight(resolve(root, args.preflight), {
      expectedCase: args.case,
      nowEpochMs: Date.now(),
      sourceCommit,
      lockfileHash,
      root,
      env: process.env,
    });
  } catch (error) {
    if (error instanceof PreflightError) blocked('preflight rejected', error.issues);
    throw error;
  }
  const evidence = relative(root, resolve(root, args.evidence)).replace(/\\/g, '/');
  if (evidence !== preflight.evidenceDir)
    blocked(`--evidence ${evidence} does not match preflight.evidenceDir ${preflight.evidenceDir}`);

  const summary = {
    case: args.case,
    file: selected.file,
    tests: testCount,
    projectAlias: preflight.projectAlias,
    namespace: preflight.namespace,
    sourceCommit,
    maxRooms: preflight.maxRooms,
    maxParticipants: preflight.maxParticipants,
    maxDurationSeconds: preflight.maxDurationSeconds,
    cleanupAllowanceSeconds: preflight.cleanupAllowanceSeconds,
    credentialEnvNames: preflight.credentialEnvNames,
  };
  console.log(
    JSON.stringify({ status: args.dryRun ? 'DRY_RUN' : 'STARTING', ...summary }, null, 2),
  );
  if (args.dryRun) return;

  mkdirSync(resolve(root, preflight.evidenceDir), { recursive: true });
  const startedAt = new Date().toISOString();
  const run = runTool(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.cloud.config.ts', selected.file],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        RUN_CLOUD_TESTS: '1',
        CLOUD_TEST_CASE: args.case,
        CLOUD_PREFLIGHT_PATH: relative(root, resolve(root, args.preflight)).replace(/\\/g, '/'),
        CLOUD_EVIDENCE_DIR: preflight.evidenceDir,
      },
    },
  );
  const result = {
    ...summary,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: run.status,
    status: run.status === 0 ? 'PASS' : 'FAIL',
  };
  writeFileSync(
    resolve(root, preflight.evidenceDir, 'run-summary.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      status: result.status,
      exitCode: run.status,
      evidenceDir: preflight.evidenceDir,
    }),
  );
  process.exit(run.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

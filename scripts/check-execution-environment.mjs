#!/usr/bin/env node
// Owned by F (F-01 / DP-01). Reports whether the execution environment is ready without
// printing any secret value: only tool versions, variable *names* with set/unset, file
// presence and the operator-confirmed facts file.
//
//   node scripts/check-execution-environment.mjs [--output .local/qa/environment.json] [--facts .local/qa/operator-facts.json]
//
// Exit code is 0 when the report was produced. Readiness is expressed per item as
// CONFIRMED / UNSET / BLOCKED so nothing missing is ever counted as passed.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

export const REQUIRED_VERSIONS = Object.freeze({
  node: '24.19.0',
  pnpm: '11.19.0',
  typescript: '6.0.3',
});

/** Variable names by group. Values are never read into the report. */
export const ENV_GROUPS = Object.freeze({
  livekit: [
    'LIVEKIT_HTTP_URL',
    'LIVEKIT_WS_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'LIVEKIT_PROJECT_ALIAS',
  ],
  operations: ['OPS_TOKEN', 'OPS_DATA_DIR', 'SERVICE_NAMESPACE'],
  publicWindow: ['OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS', 'OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS'],
  budget: [
    'OPS_OFFICIAL_BUDGET_MAX_AGE_MS',
    'OPS_OPERATION_TIMEOUT_MS',
    'MEDIA_MAX_NORMAL_API_CALLS_PER_60S',
    'MEDIA_MAX_TOTAL_API_CALLS_PER_60S',
  ],
  admission: [
    'INVITE_MAX_TTL_MS',
    'SESSION_ATTEMPT_WINDOW_MS',
    'SESSION_ATTEMPTS_PER_INVITE',
    'SESSION_ATTEMPTS_PER_IP',
    'ROOM_IDLE_TTL_MS',
  ],
  cloudRunner: ['RUN_CLOUD_TESTS', 'CLOUD_TEST_CASE', 'CLOUD_PREFLIGHT_PATH', 'CLOUD_EVIDENCE_DIR'],
});

/** Operator facts the plan requires F to record. Missing entries stay BLOCKED, never guessed. */
export const OPERATOR_FACT_KEYS = Object.freeze([
  'aws.instanceType',
  'aws.region',
  'aws.availabilityZone',
  'aws.os',
  'aws.publicIp',
  'aws.includedTransfer',
  'aws.domain',
  'aws.dnsManagedBy',
  'aws.tlsIssuer',
  'aws.tlsExpiry',
  'jenkins.url',
  'jenkins.access',
  'cloud.provider',
  'cloud.projectAlias',
  'cloud.remainingMinutes',
  'cloud.remainingBytes',
  'cloud.sharedLimits',
  'cloud.checkedAt',
  'cloud.testNamespace',
  'cloud.credentialInjection',
  'devices.representative',
  'devices.loadGenerators',
]);

const exe = (cmd) => (process.platform === 'win32' && cmd === 'pnpm' ? 'pnpm.cmd' : cmd);
function run(cmd, args) {
  const r = spawnSync(exe(cmd), args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function get(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

export function envPresence(env, names) {
  return Object.fromEntries(
    names.map((n) => [n, env[n] === undefined ? 'UNSET' : env[n] === '' ? 'EMPTY' : 'SET']),
  );
}

export function buildReport({ env = process.env, facts = null, tools = {}, files = {} } = {}) {
  const versions = {
    node: { required: REQUIRED_VERSIONS.node, actual: tools.node ?? null },
    pnpm: { required: REQUIRED_VERSIONS.pnpm, actual: tools.pnpm ?? null },
    typescript: { required: REQUIRED_VERSIONS.typescript, actual: tools.typescript ?? null },
    docker: { required: null, actual: tools.docker ?? null },
    git: { required: null, actual: tools.git ?? null },
  };
  for (const v of Object.values(versions))
    v.status =
      v.actual === null
        ? 'MISSING'
        : v.required && v.actual !== v.required
          ? 'MISMATCH'
          : 'CONFIRMED';

  const environment = Object.fromEntries(
    Object.entries(ENV_GROUPS).map(([g, names]) => [g, envPresence(env, names)]),
  );

  const operatorFacts = {};
  for (const key of OPERATOR_FACT_KEYS) {
    const value = facts ? get(facts, key) : undefined;
    operatorFacts[key] =
      value === undefined || value === null || value === ''
        ? { status: 'BLOCKED', value: null }
        : { status: 'CONFIRMED', value };
  }

  const blocked = Object.entries(operatorFacts)
    .filter(([, v]) => v.status === 'BLOCKED')
    .map(([k]) => k);
  return {
    generatedAt: new Date().toISOString(),
    versions,
    files,
    environment,
    operatorFacts,
    summary: {
      toolchainReady: ['node', 'pnpm', 'typescript'].every(
        (k) => versions[k].status === 'CONFIRMED',
      ),
      livekitConfigured: Object.values(environment.livekit)
        .slice(0, 4)
        .every((s) => s === 'SET'),
      operatorTokenConfigured: environment.operations.OPS_TOKEN === 'SET',
      blockedFacts: blocked,
      note: 'Presence and versions only. Local checks are not Cloud, device or load evidence.',
    },
  };
}

function main() {
  const argv = process.argv.slice(2);
  let output = null;
  let factsPath = resolve(root, '.local/qa/operator-facts.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output') output = argv[++i];
    else if (argv[i] === '--facts') factsPath = resolve(root, argv[++i]);
    else {
      console.error(`unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  const tsPkg = readJson(resolve(root, 'node_modules/typescript/package.json'));
  const tools = {
    node: process.versions.node,
    pnpm: run('pnpm', ['--version']),
    typescript: tsPkg?.version ?? null,
    docker: run('docker', ['version', '--format', '{{.Server.Version}}']),
    git: run('git', ['--version'])?.replace(/^git version\s*/, '') ?? null,
  };
  const files = Object.fromEntries(
    [
      'pnpm-lock.yaml',
      'vitest.cloud.config.ts',
      'tsconfig.qa.json',
      'tests/cloud/CloudPreflight.ts',
      'tests/cloud/probe.html',
      'apps/web/tsconfig.worker.json',
      'apps/web/public/models/manifest.json',
      '.local/qa/cloud-preflight.json',
    ].map((f) => [f, existsSync(resolve(root, f))]),
  );
  const facts = existsSync(factsPath) ? readJson(factsPath) : null;
  const report = buildReport({ tools, files, facts });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (output) {
    const target = resolve(root, output);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    console.log(`wrote ${output}`);
  }
  console.log(
    JSON.stringify(
      {
        ...report.summary,
        versions: Object.fromEntries(
          Object.entries(report.versions).map(([k, v]) => [k, v.status]),
        ),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

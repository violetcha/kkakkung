// Owned by F (F-01 / DP-01). Single strict parser for the Cloud preflight document that
// scripts/run-cloud-check.mjs validates before it spawns Vitest, and that every
// *.cloud.test.ts re-checks in beforeAll through requireCloudPreflight().
//
// QA material only. Product code never imports this file. Secrets are never stored here:
// the document lists the names of the environment variables a case needs, and the values are
// read from the process environment at run time.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** Cloud case allowlist. Exactly one test file per case; nothing else may run against Cloud. */
export const CLOUD_CASES = Object.freeze({
  'MC-01': 'server/test/media/capability.cloud.test.ts',
  'MC-PUBLIC-01': 'server/test/media/public-authority.cloud.test.ts',
  'QA-02': 'tests/cloud/performance.cloud.test.ts',
  'QA-03': 'tests/cloud/g1-a.cloud.test.ts',
  'QA-04': 'tests/cloud/g1-d.cloud.test.ts',
  'QA-05': 'tests/cloud/g1-b.cloud.test.ts',
  'QA-06': 'tests/cloud/g1-c.cloud.test.ts',
  'QA-08': 'tests/cloud/g4-metadata.cloud.test.ts',
  'QA-09': 'tests/cloud/mvp-flow.cloud.test.ts',
  'QA-11': 'tests/cloud/staged-load.cloud.test.ts',
  'QA-12': 'tests/cloud/ten-room-integrated.cloud.test.ts',
  'DP-06': 'tests/cloud/deployment-smoke.cloud.test.ts',
} as const);
export type CloudCase = keyof typeof CLOUD_CASES;
export const NON_CLOUD_CASES = Object.freeze(['QA-01', 'QA-07', 'QA-10', 'QA-13'] as const);

export type CloudPreflight = Readonly<{
  projectAlias: string;
  namespace: string;
  sourceCommit: string;
  lockfileHash: string;
  checkedAtEpochMs: number;
  expiresAtEpochMs: number;
  /** Only bounded DP-06 automation may rely on provider quota instead of dashboard balances. */
  budgetPolicy?: 'provider-quota';
  remainingMinutes: number | null;
  remainingBytes: number | null;
  allowedCases: readonly CloudCase[];
  budgetReservation: Readonly<{ reservationId: string; participantMinutes: number; bytes: number }>;
  credentialEnvNames: readonly string[];
  deviceManifest: Readonly<{ path: string; mode: 'synthetic' | 'representative' }>;
  evidenceDir: string;
  maxRooms: number;
  maxParticipants: number;
  maxDurationSeconds: number;
  cleanupAllowanceSeconds: number;
  stageDurationSeconds?: Readonly<{ '1': number; '3': number; '5': number }>;
}>;

export type PreflightContext = Readonly<{
  /** Case the runner is about to execute. Must be in allowedCases. */
  expectedCase: CloudCase;
  nowEpochMs: number;
  /** Actual `git rev-parse HEAD` of the checkout. */
  sourceCommit?: string;
  /** sha256 of pnpm-lock.yaml in the checkout. */
  lockfileHash?: string;
  /** Root used to resolve deviceManifest.path and evidenceDir. */
  root: string;
  /** Environment used to check credentialEnvNames presence (values are never returned). */
  env?: Record<string, string | undefined>;
}>;

export class PreflightError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super('Cloud preflight rejected: ' + issues.join('; '));
    this.name = 'PreflightError';
    this.issues = issues;
  }
}

const KNOWN_KEYS = new Set<string>([
  'projectAlias',
  'namespace',
  'sourceCommit',
  'lockfileHash',
  'checkedAtEpochMs',
  'expiresAtEpochMs',
  'remainingMinutes',
  'remainingBytes',
  'budgetPolicy',
  'allowedCases',
  'budgetReservation',
  'credentialEnvNames',
  'deviceManifest',
  'evidenceDir',
  'maxRooms',
  'maxParticipants',
  'maxDurationSeconds',
  'cleanupAllowanceSeconds',
  'stageDurationSeconds',
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const finiteInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const positiveInt = (v: unknown): v is number => finiteInt(v) && v > 0;
const nonNegativeFinite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Validate an already-parsed JSON document. Throws PreflightError listing every issue. */
export function parseCloudPreflight(input: unknown, ctx: PreflightContext): CloudPreflight {
  const issues: string[] = [];
  if (!isRecord(input)) throw new PreflightError(['document must be a JSON object']);
  for (const key of Object.keys(input))
    if (!KNOWN_KEYS.has(key)) issues.push(`unknown field ${key}`);

  const d = input;
  for (const key of ['projectAlias', 'namespace', 'sourceCommit', 'lockfileHash'] as const)
    if (!nonEmptyString(d[key])) issues.push(`${key} must be a non-empty string`);
  if (ctx.sourceCommit && d.sourceCommit !== ctx.sourceCommit)
    issues.push('sourceCommit does not match the current checkout');
  if (ctx.lockfileHash && d.lockfileHash !== ctx.lockfileHash)
    issues.push('lockfileHash does not match pnpm-lock.yaml');

  if (!finiteInt(d.checkedAtEpochMs)) issues.push('checkedAtEpochMs must be an epoch ms integer');
  if (!finiteInt(d.expiresAtEpochMs)) issues.push('expiresAtEpochMs must be an epoch ms integer');
  if (finiteInt(d.checkedAtEpochMs) && finiteInt(d.expiresAtEpochMs)) {
    if (!(d.checkedAtEpochMs <= ctx.nowEpochMs)) issues.push('checkedAtEpochMs is in the future');
    if (!(ctx.nowEpochMs < d.expiresAtEpochMs)) issues.push('preflight has expired');
  }
  if (d.budgetPolicy !== undefined && d.budgetPolicy !== 'provider-quota')
    issues.push('unknown budget policy');
  if (d.budgetPolicy === 'provider-quota') {
    if (
      ctx.expectedCase !== 'DP-06' ||
      ctx.env?.OPS_OPERATING_MODE !== 'continuous' ||
      !Array.isArray(d.allowedCases) ||
      d.allowedCases.length !== 1 ||
      d.allowedCases[0] !== 'DP-06' ||
      d.remainingMinutes !== null ||
      d.remainingBytes !== null ||
      !finiteInt(d.checkedAtEpochMs) ||
      !finiteInt(d.expiresAtEpochMs) ||
      d.checkedAtEpochMs <= 0 ||
      d.expiresAtEpochMs - d.checkedAtEpochMs > 30 * 60_000 ||
      d.maxRooms !== 1 ||
      d.maxParticipants !== 6 ||
      !positiveInt(d.maxDurationSeconds) ||
      d.maxDurationSeconds > 600 ||
      !positiveInt(d.cleanupAllowanceSeconds) ||
      d.cleanupAllowanceSeconds > 60 ||
      !isRecord(d.deviceManifest) ||
      d.deviceManifest.mode !== 'synthetic'
    )
      issues.push('provider quota policy requires bounded continuous DP-06 automation');
  } else {
    if (!nonNegativeFinite(d.remainingMinutes)) issues.push('remainingMinutes must be >= 0');
    if (!(finiteInt(d.remainingBytes) && d.remainingBytes >= 0))
      issues.push('remainingBytes must be a non-negative integer');
  }

  const cases = d.allowedCases;
  if (!Array.isArray(cases) || cases.length === 0)
    issues.push('allowedCases must be a non-empty array');
  else {
    for (const c of cases)
      if (!(typeof c === 'string' && c in CLOUD_CASES))
        issues.push(`allowedCases contains unregistered case ${String(c)}`);
    if (!cases.includes(ctx.expectedCase))
      issues.push(`allowedCases does not include ${ctx.expectedCase}`);
  }

  const r = d.budgetReservation;
  if (!isRecord(r)) issues.push('budgetReservation must be an object');
  else {
    if (!nonEmptyString(r.reservationId)) issues.push('budgetReservation.reservationId required');
    if (!(nonNegativeFinite(r.participantMinutes) && r.participantMinutes > 0))
      issues.push('budgetReservation.participantMinutes must be > 0');
    if (!positiveInt(r.bytes)) issues.push('budgetReservation.bytes must be a positive integer');
    if (
      nonNegativeFinite(d.remainingMinutes) &&
      typeof r.participantMinutes === 'number' &&
      r.participantMinutes > d.remainingMinutes
    )
      issues.push('budgetReservation exceeds remainingMinutes');
    if (finiteInt(d.remainingBytes) && positiveInt(r.bytes) && r.bytes > d.remainingBytes)
      issues.push('budgetReservation exceeds remainingBytes');
  }

  const names = d.credentialEnvNames;
  if (
    !Array.isArray(names) ||
    names.some((n) => !nonEmptyString(n) || !/^[A-Z][A-Z0-9_]*$/.test(n))
  )
    issues.push('credentialEnvNames must be an array of environment variable names');
  else if (ctx.env) {
    for (const n of names as string[]) {
      const v = ctx.env[n];
      if (v === undefined || v === '') issues.push(`credential ${n} is not set in the environment`);
    }
  }

  const m = d.deviceManifest;
  if (
    !isRecord(m) ||
    !nonEmptyString(m.path) ||
    (m.mode !== 'synthetic' && m.mode !== 'representative')
  )
    issues.push('deviceManifest must be { path, mode: synthetic | representative }');
  else if (!existsSync(resolve(ctx.root, m.path)))
    issues.push(`deviceManifest.path not found: ${m.path}`);
  if (['QA-02', 'QA-09'].includes(ctx.expectedCase) && isRecord(m) && m.mode !== 'representative')
    issues.push(`${ctx.expectedCase} requires representative devices`);

  if (!nonEmptyString(d.evidenceDir)) issues.push('evidenceDir required');
  else {
    const normalized = d.evidenceDir.replace(/\\/g, '/');
    if (!normalized.startsWith('.local/qa/')) issues.push('evidenceDir must be under .local/qa/');
    if (normalized.includes('..')) issues.push('evidenceDir must not contain ..');
  }

  for (const key of [
    'maxRooms',
    'maxParticipants',
    'maxDurationSeconds',
    'cleanupAllowanceSeconds',
  ] as const)
    if (!positiveInt(d[key])) issues.push(`${key} must be a positive integer`);
  if (
    positiveInt(d.maxRooms) &&
    positiveInt(d.maxParticipants) &&
    d.maxParticipants > d.maxRooms * 6
  )
    issues.push('maxParticipants exceeds six seats per room');
  if (
    isRecord(r) &&
    typeof r.participantMinutes === 'number' &&
    positiveInt(d.maxParticipants) &&
    positiveInt(d.maxDurationSeconds) &&
    positiveInt(d.cleanupAllowanceSeconds)
  ) {
    const needed = (d.maxParticipants * (d.maxDurationSeconds + d.cleanupAllowanceSeconds)) / 60;
    if (needed > r.participantMinutes)
      issues.push(
        'maxParticipants * (maxDurationSeconds + cleanupAllowanceSeconds) exceeds the reservation',
      );
  }

  const s = d.stageDurationSeconds;
  if (ctx.expectedCase === 'QA-11') {
    if (
      !isRecord(s) ||
      !positiveInt(s['1']) ||
      !positiveInt(s['3']) ||
      !positiveInt(s['5']) ||
      Object.keys(s).length !== 3
    )
      issues.push("QA-11 requires stageDurationSeconds { '1', '3', '5' } positive integers");
  } else if (s !== undefined) issues.push('stageDurationSeconds is only allowed for QA-11');

  if (issues.length) throw new PreflightError(issues);
  return Object.freeze(d as unknown as CloudPreflight);
}

/** Read and validate a preflight file from disk. */
export function loadCloudPreflight(path: string, ctx: PreflightContext): CloudPreflight {
  if (!existsSync(path) || !statSync(path).isFile())
    throw new PreflightError([`preflight file not found: ${path}`]);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new PreflightError([`preflight file is not valid JSON: ${path}`]);
  }
  return parseCloudPreflight(json, ctx);
}

/**
 * For *.cloud.test.ts beforeAll. Refuses to run (throws, never skips) unless the runner injected
 * RUN_CLOUD_TESTS=1, CLOUD_TEST_CASE equals expectedCase, and the preflight at
 * CLOUD_PREFLIGHT_PATH is valid for this case with CLOUD_EVIDENCE_DIR matching evidenceDir.
 */
export function requireCloudPreflight(
  expectedCase: CloudCase,
  env: Record<string, string | undefined> = process.env,
  nowEpochMs: number = Date.now(),
  root: string = process.cwd(),
): CloudPreflight {
  const issues: string[] = [];
  if (env.RUN_CLOUD_TESTS !== '1')
    issues.push('RUN_CLOUD_TESTS=1 not set (run through scripts/run-cloud-check.mjs)');
  if (env.CLOUD_TEST_CASE !== expectedCase) issues.push(`CLOUD_TEST_CASE is not ${expectedCase}`);
  if (!nonEmptyString(env.CLOUD_PREFLIGHT_PATH)) issues.push('CLOUD_PREFLIGHT_PATH not set');
  if (issues.length) throw new PreflightError(issues);
  const preflight = loadCloudPreflight(resolve(root, env.CLOUD_PREFLIGHT_PATH as string), {
    expectedCase,
    nowEpochMs,
    root,
    env,
  });
  if (env.CLOUD_EVIDENCE_DIR !== preflight.evidenceDir)
    throw new PreflightError(['CLOUD_EVIDENCE_DIR does not match preflight.evidenceDir']);
  return preflight;
}

/** Test/hook timeout for long cases: bounded by the preflight, never unlimited. */
export function caseTimeoutMs(preflight: CloudPreflight): number {
  return (preflight.maxDurationSeconds + preflight.cleanupAllowanceSeconds) * 1000;
}

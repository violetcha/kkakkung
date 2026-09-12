import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  prepareDeploymentSmoke,
  deriveDeploymentPreflight,
} from '../../scripts/lib/deployment-smoke-preflight.mjs';
import { localDeploymentDevices, localDeploymentPlan } from '../fixtures/deployment-smoke-plan.js';

const temporary: string[] = [];
afterEach(() => {
  for (const target of temporary.splice(0)) {
    const absolute = resolve(target);
    if (
      !absolute.startsWith(resolve(tmpdir()) + '/') &&
      !absolute.startsWith(resolve(tmpdir()) + '\\')
    )
      throw new Error('UNSAFE_TEST_TMP');
    rmSync(absolute, { recursive: true, force: true });
  }
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dp06-preflight-'));
  temporary.push(root);
  const nowEpochMs = 1_000_000;
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'local lock fixture');
  const plan = {
    ...localDeploymentPlan(nowEpochMs),
    lockfileHash: createHash('sha256')
      .update(readFileSync(join(root, 'pnpm-lock.yaml')))
      .digest('hex'),
    deviceManifest: { path: 'devices.json', mode: 'synthetic' },
  };
  writeFileSync(join(root, 'devices.json'), JSON.stringify(localDeploymentDevices));
  mkdirSync(join(root, '.local', 'qa'), { recursive: true });
  const preflightPath = join(root, '.local', 'qa', 'preflight.json');
  writeFileSync(preflightPath, JSON.stringify(plan));
  return {
    root,
    preflightPath,
    sourceCommit: plan.sourceCommit,
    nowEpochMs,
    env: {
      SMOKE_INTERNAL_TOKEN: 'a'.repeat(64),
      OPS_TOKEN: 'local-test-operator',
      SMOKE_INTERNAL_BASE_URL: 'http://127.0.0.1:18081',
      SMOKE_PUBLIC_BASE_URL: 'https://example.test',
    },
  };
}
it('uses the exact approved QA evidence directory instead of release/smoke', () => {
  const input = setup();
  expect(prepareDeploymentSmoke(input).evidenceDir).toBe(
    resolve(input.root, '.local/qa/local-fixture'),
  );
});
it.each(['SMOKE_INTERNAL_TOKEN', 'OPS_TOKEN'])(
  'refuses absent %s before release adapters can run',
  (key) => {
    const input = setup();
    expect(() => prepareDeploymentSmoke({ ...input, env: { ...input.env, [key]: '' } })).toThrow(
      'DP06_PREFLIGHT_OR_CREDENTIALS_MISSING',
    );
  },
);
it('refuses stale approvals or source/lock mismatch before a deployment mutation', () => {
  const input = setup();
  expect(() => prepareDeploymentSmoke({ ...input, sourceCommit: 'c'.repeat(40) })).toThrow();
  writeFileSync(join(input.root, 'pnpm-lock.yaml'), 'different lock');
  expect(() => prepareDeploymentSmoke(input)).toThrow();
});

it('derives a fresh release run while preserving approval, budget and source file', () => {
  const input = setup();
  const original = readFileSync(input.preflightPath, 'utf8');
  const base = JSON.parse(original);
  const derived = deriveDeploymentPreflight({ ...input, sourceCommit: 'c'.repeat(40) });
  expect(derived.sourceCommit).toBe('c'.repeat(40));
  expect(derived.checkedAtEpochMs).toBe(base.checkedAtEpochMs);
  expect(derived.expiresAtEpochMs).toBe(base.expiresAtEpochMs);
  expect(derived.remainingMinutes).toBe(base.remainingMinutes);
  expect(derived.remainingBytes).toBe(base.remainingBytes);
  expect(derived.budgetReservation.participantMinutes).toBe(
    base.budgetReservation.participantMinutes,
  );
  expect(derived.deviceManifest).toEqual(base.deviceManifest);
  expect(readFileSync(input.preflightPath, 'utf8')).toBe(original);
  expect(
    deriveDeploymentPreflight({ ...input, nowEpochMs: input.nowEpochMs + 1 }).evidenceDir,
  ).not.toBe(derived.evidenceDir);
  writeFileSync(input.preflightPath, JSON.stringify(derived));
  expect(prepareDeploymentSmoke({ ...input, sourceCommit: derived.sourceCommit }).evidenceDir).toBe(
    resolve(input.root, derived.evidenceDir),
  );
});
it('derivation cannot refresh expiry or bypass a changed dependency lock', () => {
  const input = setup();
  expect(() => deriveDeploymentPreflight({ ...input, nowEpochMs: 1e12 })).toThrow();
  writeFileSync(join(input.root, 'pnpm-lock.yaml'), 'changed');
  expect(() => deriveDeploymentPreflight(input)).toThrow();
});
it('builds a bounded continuous DP06 plan for the actual SHA and lock without any expiring base file', () => {
  const input = setup();
  mkdirSync(join(input.root, 'tests/cloud'), { recursive: true });
  writeFileSync(
    join(input.root, 'tests/cloud/devices.deployment-synthetic.json'),
    JSON.stringify(localDeploymentDevices),
  );
  rmSync(input.preflightPath);
  const continuous = {
    ...input,
    env: {
      ...input.env,
      OPS_OPERATING_MODE: 'continuous',
      LIVEKIT_PROJECT_ALIAS: 'fixture-project',
      SERVICE_NAMESPACE: 'fixture-namespace',
      LIVEKIT_API_KEY: 'synthetic-key',
      LIVEKIT_API_SECRET: 'synthetic-secret',
    },
  };
  const plan = deriveDeploymentPreflight(continuous);
  expect(plan).toMatchObject({
    sourceCommit: input.sourceCommit,
    budgetPolicy: 'provider-quota',
    remainingMinutes: null,
    remainingBytes: null,
    allowedCases: ['DP-06'],
    maxRooms: 1,
    maxParticipants: 6,
    maxDurationSeconds: 600,
    cleanupAllowanceSeconds: 60,
  });
  writeFileSync(input.preflightPath, JSON.stringify(plan));
  expect(prepareDeploymentSmoke(continuous).evidenceDir).toBe(
    resolve(input.root, plan.evidenceDir),
  );
  expect(() => prepareDeploymentSmoke({ ...continuous, env: input.env })).toThrow();
  expect(() =>
    prepareDeploymentSmoke({ ...continuous, nowEpochMs: plan.expiresAtEpochMs + 1 }),
  ).toThrow();
  writeFileSync(join(input.root, 'pnpm-lock.yaml'), 'next verified lock');
  expect(() => prepareDeploymentSmoke(continuous)).toThrow();
  const next = deriveDeploymentPreflight({
    ...continuous,
    sourceCommit: 'd'.repeat(40),
    nowEpochMs: input.nowEpochMs + 86400000,
  });
  expect(next.lockfileHash).not.toBe(plan.lockfileHash);
  expect(next.sourceCommit).toBe('d'.repeat(40));
  expect(next.checkedAtEpochMs).toBe(input.nowEpochMs + 86400000);
});

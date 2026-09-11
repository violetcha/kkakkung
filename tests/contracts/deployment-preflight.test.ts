import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareDeploymentSmoke } from '../../scripts/lib/deployment-smoke-preflight.mjs';
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

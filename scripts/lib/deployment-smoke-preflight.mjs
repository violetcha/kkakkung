// Read-only local validation before the release runner issues any operator or Docker mutation.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCloudPreflight } from '../../tests/cloud/CloudPreflight.ts';
import { validateDeploymentSmokePlan } from '../../tests/cloud/DeploymentSmokePlan.ts';
import { validateSmokeTarget } from './smoke-target.mjs';

export function prepareDeploymentSmoke({ root, preflightPath, sourceCommit, env, nowEpochMs }) {
  if (!preflightPath || !env.SMOKE_INTERNAL_TOKEN || !env.OPS_TOKEN)
    throw new Error('DP06_PREFLIGHT_OR_CREDENTIALS_MISSING');
  validateSmokeTarget(
    env.SMOKE_INTERNAL_BASE_URL,
    env.SMOKE_PUBLIC_BASE_URL,
    env.SMOKE_INTERNAL_TOKEN,
  );
  const preflight = loadCloudPreflight(resolve(root, preflightPath), {
    expectedCase: 'DP-06',
    nowEpochMs,
    root,
    env,
    sourceCommit,
    lockfileHash: createHash('sha256')
      .update(readFileSync(resolve(root, 'pnpm-lock.yaml')))
      .digest('hex'),
  });
  validateDeploymentSmokePlan(
    preflight,
    JSON.parse(readFileSync(resolve(root, preflight.deviceManifest.path), 'utf8')),
    nowEpochMs,
  );
  return { evidenceDir: resolve(root, preflight.evidenceDir) };
}

// Read-only local validation before the release runner issues any operator or Docker mutation.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCloudPreflight, parseCloudPreflight } from '../../tests/cloud/CloudPreflight.ts';
import {
  validateDeploymentSmokePlan,
  deploymentReservationBytes,
} from '../../tests/cloud/DeploymentSmokePlan.ts';
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

/** Derive a DP-06 run from an unexpired budget/device plan. Does not refresh evidence. */
export function deriveDeploymentPreflight(input) {
  if (!/^[a-f0-9]{40}$/.test(input.sourceCommit)) throw new Error('INVALID_RELEASE_SHA');
  if (input.env.OPS_OPERATING_MODE === 'continuous') {
    validateSmokeTarget(
      input.env.SMOKE_INTERNAL_BASE_URL,
      input.env.SMOKE_PUBLIC_BASE_URL,
      input.env.SMOKE_INTERNAL_TOKEN,
    );
    const derived = {
      projectAlias: input.env.LIVEKIT_PROJECT_ALIAS,
      namespace: input.env.SERVICE_NAMESPACE,
      sourceCommit: input.sourceCommit,
      lockfileHash: createHash('sha256')
        .update(readFileSync(resolve(input.root, 'pnpm-lock.yaml')))
        .digest('hex'),
      checkedAtEpochMs: input.nowEpochMs,
      // Each run is bounded, while the service configuration itself has no daily expiry.
      expiresAtEpochMs: input.nowEpochMs + 30 * 60_000,
      budgetPolicy: 'provider-quota',
      remainingMinutes: null,
      remainingBytes: null,
      allowedCases: ['DP-06'],
      budgetReservation: {
        reservationId: `deploy-${input.sourceCommit.slice(0, 8)}-${input.nowEpochMs}`,
        participantMinutes: 66,
        bytes: deploymentReservationBytes(660),
      },
      credentialEnvNames: [
        'OPS_TOKEN',
        'SMOKE_INTERNAL_TOKEN',
        'LIVEKIT_API_KEY',
        'LIVEKIT_API_SECRET',
      ],
      deviceManifest: { path: 'tests/cloud/devices.deployment-synthetic.json', mode: 'synthetic' },
      evidenceDir: `.local/qa/DP-06-${input.sourceCommit.slice(0, 8)}-${input.nowEpochMs}`,
      maxRooms: 1,
      maxParticipants: 6,
      maxDurationSeconds: 600,
      cleanupAllowanceSeconds: 60,
    };
    parseCloudPreflight(derived, {
      expectedCase: 'DP-06',
      ...input,
      lockfileHash: derived.lockfileHash,
    });
    validateDeploymentSmokePlan(
      derived,
      JSON.parse(readFileSync(resolve(input.root, derived.deviceManifest.path), 'utf8')),
      input.nowEpochMs,
    );
    return derived;
  }
  const base = JSON.parse(readFileSync(resolve(input.root, input.preflightPath), 'utf8'));
  prepareDeploymentSmoke({ ...input, sourceCommit: base.sourceCommit });
  const derived = {
    ...base,
    sourceCommit: input.sourceCommit,
    budgetReservation: {
      ...base.budgetReservation,
      reservationId: `deploy-${input.sourceCommit.slice(0, 8)}-${input.nowEpochMs}`,
    },
    evidenceDir: `.local/qa/DP-06-${input.sourceCommit.slice(0, 8)}-${input.nowEpochMs}`,
  };
  parseCloudPreflight(derived, {
    expectedCase: 'DP-06',
    ...input,
    lockfileHash: createHash('sha256')
      .update(readFileSync(resolve(input.root, 'pnpm-lock.yaml')))
      .digest('hex'),
  });
  return derived;
}

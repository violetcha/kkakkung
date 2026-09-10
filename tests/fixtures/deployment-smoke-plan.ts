// Local fixture only: never write this as a Cloud approval or runtime evidence file.
import type { CloudPreflight } from '../cloud/CloudPreflight.js';
import { deploymentReservationBytes } from '../cloud/DeploymentSmokePlan.js';

export function localDeploymentPlan(nowEpochMs = Date.now()): CloudPreflight {
  return {
    projectAlias: 'local-fixture',
    namespace: 'local-fixture',
    sourceCommit: 'a'.repeat(40),
    lockfileHash: 'b'.repeat(64),
    checkedAtEpochMs: nowEpochMs,
    expiresAtEpochMs: nowEpochMs + 600_000,
    remainingMinutes: 100,
    remainingBytes: 1_000_000_000,
    allowedCases: ['DP-06'],
    budgetReservation: {
      reservationId: 'local-only',
      participantMinutes: 33,
      bytes: deploymentReservationBytes(330),
    },
    credentialEnvNames: [],
    deviceManifest: { mode: 'synthetic', path: 'tests/cloud/devices.deployment-synthetic.json' },
    evidenceDir: '.local/qa/local-fixture',
    maxRooms: 1,
    maxParticipants: 6,
    maxDurationSeconds: 300,
    cleanupAllowanceSeconds: 30,
  };
}
export const localDeploymentDevices = {
  mode: 'synthetic',
  participants: Array.from({ length: 6 }, () => ({ video: 'canvas', audio: 'oscillator' })),
};

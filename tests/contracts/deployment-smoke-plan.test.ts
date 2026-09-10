import { describe, expect, it } from 'vitest';
import {
  deploymentReservationBytes,
  validateDeploymentSmokePlan,
} from '../cloud/DeploymentSmokePlan.js';
import { localDeploymentDevices, localDeploymentPlan } from '../fixtures/deployment-smoke-plan.js';
import type { CloudPreflight } from '../cloud/CloudPreflight.js';

describe('DP06 reservation gate before any IO', () => {
  const now = 1_000_000;
  it('reserves setup, real 180s round, cleanup and all directed synthetic receiver streams', () => {
    expect(deploymentReservationBytes(330)).toBe(281_531_250);
    expect(() =>
      validateDeploymentSmokePlan(localDeploymentPlan(now), localDeploymentDevices, now),
    ).not.toThrow();
  });
  it.each([
    { allowedCases: ['QA-02'] },
    { maxParticipants: 5 },
    { maxParticipants: 7 },
    { maxRooms: 2 },
    { maxDurationSeconds: 299 },
    { maxDurationSeconds: NaN },
    { cleanupAllowanceSeconds: 29 },
    { expiresAtEpochMs: now + 329_999 },
    { expiresAtEpochMs: NaN },
    { budgetReservation: { reservationId: 'local', participantMinutes: 32.9, bytes: 1e9 } },
    { budgetReservation: { reservationId: 'local', participantMinutes: NaN, bytes: 1e9 } },
    { budgetReservation: { reservationId: 'local', participantMinutes: 33, bytes: 281_531_249 } },
    { budgetReservation: { reservationId: 'local', participantMinutes: 33, bytes: NaN } },
  ])('rejects insufficient or malformed approval %j', (override) => {
    expect(() =>
      validateDeploymentSmokePlan(
        { ...localDeploymentPlan(now), ...override } as CloudPreflight,
        localDeploymentDevices,
        now,
      ),
    ).toThrow();
  });
  it.each([
    null,
    { mode: 'representative', participants: localDeploymentDevices.participants },
    { mode: 'synthetic', participants: localDeploymentDevices.participants.slice(1) },
    { mode: 'synthetic', participants: Array.from({ length: 6 }, () => ({ video: 'canvas' })) },
  ])('requires six explicitly declared synthetic audio/video sources', (manifest) => {
    expect(() => validateDeploymentSmokePlan(localDeploymentPlan(now), manifest, now)).toThrow();
  });
});

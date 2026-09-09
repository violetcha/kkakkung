import { describe, expect, it } from 'vitest';
import {
  validateCleanupCheckpoint,
  type CleanupCheckpointState,
} from '../../src/operations/RecoveryCleanupBindings.js';

const room =
  'e-fixture--11111111-1111-4111-8111-111111111111--22222222-2222-4222-8222-222222222222';
const report = {
  recordedIdentities: 1,
  observedParticipants: 1,
  revoked: 1,
  unresolved: 0,
  ownedRoomsRemaining: 0,
  historyComplete: false,
};
const valid: CleanupCheckpointState = {
  namespace: 'e-fixture',
  historyComplete: false,
  observedTargets: [{ roomName: room, identity: 'observed-identity' }],
  report,
};

describe('E-13 persistent observation schema cannot manufacture issuance history', () => {
  it('preserves unknown identities and returns detached evidence without upgrading history', () => {
    const original = structuredClone(valid);
    const value = validateCleanupCheckpoint(original);
    expect(value).toEqual(valid);
    (original.observedTargets as { roomName: string; identity: string }[])[0]!.identity =
      'modified';
    expect(value.observedTargets[0]!.identity).toBe('observed-identity');
    expect(value.historyComplete).toBe(false);
  });

  it('permits a verified empty snapshot and an unresolved snapshot before the final report', () => {
    expect(
      validateCleanupCheckpoint({
        namespace: 'e-fixture',
        historyComplete: true,
        observedTargets: [],
        report: null,
      }),
    ).toEqual({
      namespace: 'e-fixture',
      historyComplete: true,
      observedTargets: [],
      report: null,
    });
    expect(validateCleanupCheckpoint({ ...valid, report: null }).observedTargets).toHaveLength(1);
  });

  it.each([
    { ...valid, token: 'forbidden-fixture-field' },
    { ...valid, namespace: 'bad--namespace' },
    { ...valid, namespace: 'bad:namespace' },
    { ...valid, historyComplete: true },
    { ...valid, historyComplete: 'false' },
    {
      ...valid,
      observedTargets: [{ roomName: room.replace('e-fixture', 'other'), identity: 'p' }],
    },
    { ...valid, observedTargets: [{ roomName: 'e-fixture--malformed', identity: 'p' }] },
    { ...valid, observedTargets: [{ roomName: room, identity: 'unsafe/identity' }] },
    { ...valid, observedTargets: [{ roomName: room, identity: 'p', secret: 'forbidden' }] },
    { ...valid, observedTargets: [valid.observedTargets[0], valid.observedTargets[0]] },
    { ...valid, report: { ...report, historyComplete: true } },
    { ...valid, report: { ...report, unresolved: -1 } },
    { ...valid, report: { ...report, revoked: Number.NaN } },
    { ...valid, report: { ...report, observedParticipants: 0.5 } },
    {
      ...valid,
      report: { ...report, unresolved: Number.MAX_SAFE_INTEGER, ownedRoomsRemaining: 1 },
    },
    { ...valid, report: { ...report, rawError: 'forbidden' } },
  ])('rejects corrupt, foreign or invented completion evidence (%#)', (input) => {
    expect(() => validateCleanupCheckpoint(input)).toThrow();
  });
});

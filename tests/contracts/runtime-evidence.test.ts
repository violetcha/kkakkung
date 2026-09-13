import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadRuntimeEvidence as createRuntimeEvidence,
  officialCheckpointDigest,
  type RuntimeEvidence,
  type RuntimeEvidenceOptions,
  type RuntimeEvidenceServices,
} from '../../server/src/config/RuntimeEvidence.js';
import type { OfficialBudgetCheckpoint } from '../../server/src/media/types.js';

// Deliberately synthetic evidence, confined to a test-owned temp directory. Never Cloud proof.
const NOW = 1_800_000_000_000;
const official: OfficialBudgetCheckpoint = {
  projectAlias: 'fixture-project',
  remainingMinutes: 60,
  remainingBytes: 1_000_000,
  checkedAtEpochMs: NOW - 100,
  source: 'cloud-dashboard',
  checkedBy: '검증자',
};
const valid = (): RuntimeEvidence => ({
  version: 1,
  attestationId: 'fixture-attestation-1',
  projectAlias: official.projectAlias,
  namespace: 'fixture-namespace',
  checkedBy: '검증자',
  checkedAtEpochMs: NOW - 100,
  expiresAtEpochMs: NOW + 1000,
  evidenceRefs: {
    namespaceOwnership: 'fixture/ownership',
    firstInstallation: 'fixture/install',
    firstAudit: 'fixture/audit',
  },
  officialBudget: {
    checkpointSha256: officialCheckpointDigest(official),
    periodId: 'fixture-period',
    version: 7,
    evidenceRef: 'fixture/billing-7',
  },
});
const directories: string[] = [];
const providers: RuntimeEvidenceServices[] = [];
async function loadRuntimeEvidence(options: RuntimeEvidenceOptions) {
  const provider = await createRuntimeEvidence(options);
  providers.push(provider);
  return provider;
}
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
  vi.restoreAllMocks();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture(value: unknown = valid()) {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-evidence-'));
  directories.push(directory);
  const path = join(directory, 'runtime-evidence.json');
  if (value !== undefined) writeFileSync(path, JSON.stringify(value));
  let now = NOW;
  const options = {
    opsDataDir: directory,
    projectAlias: 'fixture-project',
    namespace: 'fixture-namespace',
    nowEpochMs: () => now,
    maxAgeMs: 500,
  };
  return {
    directory,
    path,
    options,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('F runtime evidence provider', () => {
  it('keeps missing evidence locked without creating any provisioning marker', async () => {
    const f = fixture();
    rmSync(f.path);
    const services = await loadRuntimeEvidence(f.options);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(await services.firstInstallationConfirmed()).toBe(false);
    expect(services.firstAuditConfirmed()).toBe(false);
    expect(services.getOfficialRevision(official)).toBeNull();
    expect(readdirSync(f.directory)).toEqual([]);
  });

  it('returns only the attested official revision bound to every official checkpoint field', async () => {
    const f = fixture();
    const services = await loadRuntimeEvidence(f.options);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    expect(services.getOfficialRevision(official)).toEqual({
      periodId: 'fixture-period',
      version: 7,
    });
    const variants: OfficialBudgetCheckpoint[] = [
      { ...official, projectAlias: 'other-project' },
      { ...official, remainingMinutes: 61 },
      { ...official, remainingBytes: 1_000_001 },
      { ...official, checkedAtEpochMs: NOW - 99 },
      { ...official, checkedBy: '다른검증자' },
      { ...official, source: 'untrusted' as 'cloud-dashboard' },
    ];
    for (const input of variants) expect(services.getOfficialRevision(input)).toBeNull();
    expect(readdirSync(f.directory)).toEqual(['runtime-evidence.json']);
  });

  it('hashes all six official fields canonically and rejects extra data', () => {
    const reordered = Object.fromEntries(
      Object.entries(official).reverse(),
    ) as OfficialBudgetCheckpoint;
    expect(officialCheckpointDigest(reordered)).toBe(officialCheckpointDigest(official));
    expect(() =>
      officialCheckpointDigest({ ...official, version: 7 } as OfficialBudgetCheckpoint),
    ).toThrow();
  });

  it('consumes separate installation and audit attestations once across process reloads', async () => {
    const f = fixture();
    const services = await loadRuntimeEvidence(f.options);
    expect(await services.firstInstallationConfirmed()).toBe(true);
    expect(await services.firstInstallationConfirmed()).toBe(false);
    expect(services.firstAuditConfirmed()).toBe(true);
    expect(services.firstAuditConfirmed()).toBe(false);
    const marker = JSON.parse(
      readFileSync(join(f.directory, 'runtime-firstInstallation-consumed.json'), 'utf8'),
    );
    expect(marker).toMatchObject({
      purpose: 'firstInstallation',
      attestationId: valid().attestationId,
      namespace: f.options.namespace,
    });
    const reloaded = await loadRuntimeEvidence(f.options);
    expect(await reloaded.firstInstallationConfirmed()).toBe(false);
    expect(reloaded.firstAuditConfirmed()).toBe(false);
    expect(reloaded.namespaceOwnershipConfirmed()).toBe(true);
    // Another attestation cannot restore a consumed first-install permission.
    writeFileSync(f.path, JSON.stringify({ ...valid(), attestationId: 'fixture-attestation-2' }));
    const rotated = await loadRuntimeEvidence(f.options);
    expect(await rotated.firstInstallationConfirmed()).toBe(false);
    expect(rotated.firstAuditConfirmed()).toBe(false);
  });

  it('never treats an incomplete consumption marker as permission to initialize history', async () => {
    const f = fixture();
    writeFileSync(join(f.directory, 'runtime-firstInstallation-consumed.json'), '');
    writeFileSync(join(f.directory, 'runtime-firstAudit-consumed.json'), '{');
    const services = await loadRuntimeEvidence(f.options);
    expect(await services.firstInstallationConfirmed()).toBe(false);
    expect(services.firstAuditConfirmed()).toBe(false);
  });

  it('requires each purpose-specific reference and never creates a marker for an omitted purpose', async () => {
    const record = valid();
    record.evidenceRefs = { namespaceOwnership: 'fixture/ownership' };
    const f = fixture(record);
    const services = await loadRuntimeEvidence(f.options);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    expect(await services.firstInstallationConfirmed()).toBe(false);
    expect(services.firstAuditConfirmed()).toBe(false);
    expect(readdirSync(f.directory)).toEqual(['runtime-evidence.json']);
  });

  it('locks on changed or missing evidence and requires a restart to load another attestation', async () => {
    const f = fixture();
    const services = await loadRuntimeEvidence(f.options);
    writeFileSync(f.path, JSON.stringify({ ...valid(), checkedBy: '다른검증자' }));
    await services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    writeFileSync(f.path, JSON.stringify(valid()));
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getOfficialRevision(official)).toBeNull();
    expect(await services.firstInstallationConfirmed()).toBe(false);
    const reloaded = await loadRuntimeEvidence(f.options);
    rmSync(f.path);
    await reloaded.refresh();
    expect(reloaded.namespaceOwnershipConfirmed()).toBe(false);
  });

  it('uses the verified memory snapshot on hot paths and rejects an unrefreshed lease', async () => {
    const f = fixture({ ...valid(), expiresAtEpochMs: NOW + 10_000 });
    const services = await loadRuntimeEvidence({ ...f.options, maxAgeMs: 20_000 });
    rmSync(f.path);
    // No event-loop turn occurs here: file IO is deferred to the bounded refresh.
    for (let call = 0; call < 1000; call++) {
      expect(services.namespaceOwnershipConfirmed()).toBe(true);
    }
    f.setNow(NOW + 5000);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    writeFileSync(f.path, JSON.stringify(valid()));
    await services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
  });

  it('renews the lease only after an unchanged file is verified asynchronously', async () => {
    const f = fixture({ ...valid(), expiresAtEpochMs: NOW + 10_000 });
    const services = await loadRuntimeEvidence({ ...f.options, maxAgeMs: 20_000 });
    f.setNow(NOW + 4000);
    await services.refresh();
    f.setNow(NOW + 7000);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    f.setNow(NOW + 9000);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
  });

  it('denies stale proof and recovers only after a fresh inspection of the identical file', async () => {
    const f = fixture({ ...valid(), expiresAtEpochMs: NOW + 20_000 });
    const services = await loadRuntimeEvidence({ ...f.options, maxAgeMs: 30_000 });
    f.setNow(NOW + 5000);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(await services.firstInstallationConfirmed()).toBe(false);
    expect(services.firstAuditConfirmed()).toBe(false);
    expect(services.getOfficialRevision(official)).toBeNull();
    expect(readdirSync(f.directory)).toEqual(['runtime-evidence.json']);
    const refreshing = services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getDiagnostic()).toMatchObject({
      reason: 'EPOCH_LEASE_EXPIRED',
      firstFailureReason: 'EPOCH_LEASE_EXPIRED',
      refreshPending: true,
      leaseRecoveryCount: 0,
    });
    expect(services.refresh()).toBe(refreshing);
    await refreshing;
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    expect(services.getOfficialRevision(official)).toEqual({
      periodId: 'fixture-period',
      version: 7,
    });
    expect(services.getDiagnostic()).toMatchObject({
      reason: null,
      firstFailureReason: 'EPOCH_LEASE_EXPIRED',
      refreshPending: false,
      leaseRecoveryCount: 1,
      refreshCount: 1,
    });
    expect(await services.firstInstallationConfirmed()).toBe(true);
    expect(await services.firstInstallationConfirmed()).toBe(false);
  });

  it('restores permission after a verified lease delay without restarting the provider', async () => {
    const f = fixture({ ...valid(), expiresAtEpochMs: NOW + 20_000 });
    const services = await loadRuntimeEvidence({ ...f.options, maxAgeMs: 30_000 });
    f.setNow(NOW + 5000);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    await services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
  });

  it('refuses an over-age read, then verifies again without overlapping pending reads', async () => {
    const f = fixture({ ...valid(), expiresAtEpochMs: NOW + 20_000 });
    const services = await loadRuntimeEvidence({ ...f.options, maxAgeMs: 30_000 });
    const oldRead = services.refresh();
    f.setNow(NOW + 5000);
    expect(services.refresh()).toBe(oldRead);
    await oldRead;
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getDiagnostic()).toMatchObject({
      reason: 'EPOCH_LEASE_EXPIRED',
      refreshCount: 0,
      refreshPending: false,
    });
    await services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    expect(services.getDiagnostic()).toMatchObject({ refreshCount: 1, leaseRecoveryCount: 1 });
  });

  it('keeps the independent monotonic boundary even when the epoch clock does not advance', async () => {
    const monotonic = vi.spyOn(performance, 'now').mockReturnValue(100);
    const f = fixture({ ...valid(), expiresAtEpochMs: NOW + 20_000 });
    const services = await loadRuntimeEvidence({ ...f.options, maxAgeMs: 30_000 });
    const oldRead = services.refresh();
    monotonic.mockReturnValue(5100);
    await oldRead;
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getDiagnostic()).toMatchObject({
      reason: 'MONOTONIC_LEASE_EXPIRED',
      refreshCount: 0,
      maxRefreshDurationMs: 5000,
    });
    await services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    monotonic.mockReturnValue(10100);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
  });

  it.each(['changed', 'missing', 'expired', 'rollback', 'closed'] as const)(
    'does not use lease recovery to reopen %s evidence',
    async (failure) => {
      const record = { ...valid(), expiresAtEpochMs: NOW + 20_000 };
      const f = fixture(record);
      const services = await loadRuntimeEvidence({ ...f.options, maxAgeMs: 30_000 });
      f.setNow(NOW + 5000);
      expect(services.namespaceOwnershipConfirmed()).toBe(false);
      if (failure === 'changed')
        writeFileSync(f.path, JSON.stringify({ ...record, checkedBy: 'changed' }));
      if (failure === 'missing') rmSync(f.path);
      if (failure === 'expired') f.setNow(NOW + 20_000);
      if (failure === 'rollback') f.setNow(NOW - 6);
      if (failure === 'closed') await services.close();
      await services.refresh();
      const reason = services.getDiagnostic().reason;
      expect(reason).toBe(
        {
          changed: 'FILE_CHANGED',
          missing: 'FILE_READ_FAILED',
          expired: 'EVIDENCE_EXPIRED',
          rollback: 'CLOCK_ROLLBACK',
          closed: 'CLOSED',
        }[failure],
      );
      writeFileSync(f.path, JSON.stringify(record));
      f.setNow(NOW + 6000);
      await services.refresh();
      expect(services.namespaceOwnershipConfirmed()).toBe(false);
      expect(services.getDiagnostic()).toMatchObject({
        reason,
        firstFailureReason: 'EPOCH_LEASE_EXPIRED',
        leaseRecoveryCount: 0,
      });
    },
  );

  it('closes immediately, awaits pending refresh and never reopens after repeated close', async () => {
    const f = fixture();
    const services = await loadRuntimeEvidence(f.options);
    const refreshing = services.refresh();
    const closing = services.close();
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    await Promise.all([refreshing, closing, services.close()]);
    await services.refresh();
    expect(services.getOfficialRevision(official)).toBeNull();
    expect(await services.firstInstallationConfirmed()).toBe(false);
    expect(services.firstAuditConfirmed()).toBe(false);
    expect(readdirSync(f.directory)).toEqual(['runtime-evidence.json']);
  });

  it('rechecks changed evidence before a first-use marker can be created', async () => {
    const f = fixture();
    const services = await loadRuntimeEvidence(f.options);
    writeFileSync(f.path, JSON.stringify({ ...valid(), checkedBy: '다른검증자' }));
    expect(services.firstAuditConfirmed()).toBe(false);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(readdirSync(f.directory)).toEqual(['runtime-evidence.json']);
  });

  it('expires the evidence at its boundary, rejects stale evidence and rejects clock rollback', async () => {
    const f = fixture();
    const services = await loadRuntimeEvidence({ ...f.options, maxAgeMs: 2000 });
    f.setNow(NOW + 1000);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    const stale = fixture();
    stale.setNow(NOW + 401);
    expect((await loadRuntimeEvidence(stale.options)).namespaceOwnershipConfirmed()).toBe(false);
    const rollback = fixture();
    const active = await loadRuntimeEvidence(rollback.options);
    rollback.setNow(NOW - 6);
    expect(active.namespaceOwnershipConfirmed()).toBe(false);
  });

  it.each([2, 5])(
    'retains verified policy during a bounded %ims clock correction',
    async (delta) => {
      const f = fixture();
      const services = await loadRuntimeEvidence(f.options);
      f.setNow(NOW - delta);
      expect(services.namespaceOwnershipConfirmed()).toBe(true);
      expect(services.getDiagnostic()).toMatchObject({
        reason: null,
        clockRollbackMs: 0,
        clockCorrectionCount: 1,
        maxClockCorrectionMs: delta,
      });
      f.setNow(NOW + 1);
      expect(services.namespaceOwnershipConfirmed()).toBe(true);
    },
  );

  it('does not accumulate small backwards steps or restore a large rollback', async () => {
    const f = fixture();
    const services = await loadRuntimeEvidence(f.options);
    f.setNow(NOW + 20);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    for (const delta of [2, 4, 5]) {
      f.setNow(NOW + 20 - delta);
      expect(services.namespaceOwnershipConfirmed()).toBe(true);
    }
    f.setNow(NOW + 14);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    f.setNow(NOW + 21);
    await services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getDiagnostic()).toMatchObject({
      reason: 'CLOCK_ROLLBACK',
      clockRollbackMs: 6,
      clockCorrectionCount: 3,
      maxClockCorrectionMs: 5,
    });
  });

  it('retains the original expiry and cannot revive it using a small correction', async () => {
    const f = fixture({ ...valid(), expiresAtEpochMs: NOW + 10 });
    const services = await loadRuntimeEvidence(f.options);
    f.setNow(NOW + 9);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    f.setNow(NOW + 6);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    f.setNow(NOW + 10);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    f.setNow(NOW + 8);
    await services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getDiagnostic().reason).toBe('EVIDENCE_EXPIRED');
  });

  it('keeps the monotonic verification lease during a correction', async () => {
    const monotonic = vi.spyOn(performance, 'now').mockReturnValue(100);
    const f = fixture();
    const services = await loadRuntimeEvidence(f.options);
    f.setNow(NOW - 2);
    monotonic.mockReturnValue(5100);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getDiagnostic().reason).toBe('MONOTONIC_LEASE_EXPIRED');
  });

  it('does not bypass stale or changed evidence after a correction', async () => {
    const f = fixture();
    const services = await loadRuntimeEvidence(f.options);
    f.setNow(NOW + 399);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    f.setNow(NOW + 397);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    f.setNow(NOW + 401);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getDiagnostic().reason).toBe('EVIDENCE_STALE');
    const changed = fixture();
    const second = await loadRuntimeEvidence(changed.options);
    changed.setNow(NOW - 2);
    expect(second.namespaceOwnershipConfirmed()).toBe(true);
    writeFileSync(changed.path, JSON.stringify({ ...valid(), checkedBy: 'changed' }));
    await second.refresh();
    expect(second.namespaceOwnershipConfirmed()).toBe(false);
    expect(second.getDiagnostic().reason).toBe('FILE_CHANGED');
  });

  it.each([
    { namespace: 'foreign-namespace' },
    { projectAlias: 'foreign-project' },
    { checkedBy: 'unknown' },
    { checkedAtEpochMs: NOW + 1 },
    { expiresAtEpochMs: NOW },
    { firstInstallationConfirmed: true },
    { evidenceRefs: { namespaceOwnership: 'fixture/ownership', firstInstallation: true } },
    {
      officialBudget: {
        checkpointSha256: 'bad-hash',
        periodId: 'fixture-period',
        version: 7,
        evidenceRef: 'fixture/billing',
      },
    },
    { officialBudget: { ...valid().officialBudget, version: 0 } },
  ])('rejects invalid or mismatched attestation: %j', async (override) => {
    const f = fixture({ ...valid(), ...override });
    const services = await loadRuntimeEvidence(f.options);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getOfficialRevision(official)).toBeNull();
    expect(await services.firstInstallationConfirmed()).toBe(false);
    expect(readdirSync(f.directory)).toEqual(['runtime-evidence.json']);
  });
});
describe('continuous service configuration', () => {
  function continuous() {
    const f = fixture();
    const legacy = valid();
    const scope = {
      attestationId: legacy.attestationId,
      projectAlias: legacy.projectAlias,
      namespace: legacy.namespace,
      checkedBy: legacy.checkedBy,
      evidenceRefs: legacy.evidenceRefs,
    };
    const policy = {
      ...scope,
      version: 2,
      operatingMode: 'continuous',
      budgetPolicy: 'provider-quota',
      cloudHttpOrigin: 'https://fixture.livekit.cloud',
      checkedAtEpochMs: NOW - 7 * 86400000,
    };
    const path = join(f.directory, 'service-operations.json');
    writeFileSync(path, JSON.stringify(policy));
    rmSync(f.path);
    return {
      ...f,
      path,
      policy,
      options: {
        ...f.options,
        operatingMode: 'continuous' as const,
        cloudHttpOrigin: policy.cloudHttpOrigin,
        maxAgeMs: 0,
      },
    };
  }
  it('accepts a week-old configuration on restart without claiming official billing or replaying first use', async () => {
    const f = continuous();
    const first = await loadRuntimeEvidence(f.options);
    expect(first.namespaceOwnershipConfirmed()).toBe(true);
    expect(first.getOfficialRevision(official)).toBeNull();
    expect(await first.firstInstallationConfirmed()).toBe(true);
    expect(first.firstAuditConfirmed()).toBe(true);
    await first.close();
    f.setNow(NOW + 30 * 86400000);
    const restarted = await loadRuntimeEvidence(f.options);
    expect(restarted.namespaceOwnershipConfirmed()).toBe(true);
    expect(await restarted.firstInstallationConfirmed()).toBe(false);
    expect(restarted.firstAuditConfirmed()).toBe(false);
  });
  it('keeps continuous policy through bounded clock corrections but locks a larger reversal', async () => {
    const f = continuous();
    const services = await loadRuntimeEvidence(f.options);
    f.setNow(NOW - 5);
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    f.setNow(NOW - 6);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    expect(services.getDiagnostic()).toMatchObject({
      reason: 'CLOCK_ROLLBACK',
      clockRollbackMs: 6,
      maxClockCorrectionMs: 5,
    });
  });
  it('rejects a changed project even if the replacement configuration and environment agree', async () => {
    const f = continuous();
    const first = await loadRuntimeEvidence(f.options);
    expect(await first.firstInstallationConfirmed()).toBe(true);
    await first.close();
    writeFileSync(f.path, JSON.stringify({ ...f.policy, projectAlias: 'other-project' }));
    const restarted = await loadRuntimeEvidence({ ...f.options, projectAlias: 'other-project' });
    expect(restarted.namespaceOwnershipConfirmed()).toBe(false);
  });
  it('recovers a delayed automatic inspection of the same continuous policy without a new approval', async () => {
    const f = continuous();
    const services = await loadRuntimeEvidence(f.options);
    f.setNow(NOW + 5000);
    expect(services.namespaceOwnershipConfirmed()).toBe(false);
    await services.refresh();
    expect(services.namespaceOwnershipConfirmed()).toBe(true);
    expect(services.getOfficialRevision(official)).toBeNull();
    expect(services.getDiagnostic()).toMatchObject({
      reason: null,
      firstFailureReason: 'EPOCH_LEASE_EXPIRED',
      leaseRecoveryCount: 1,
    });
    expect(readdirSync(f.directory)).toEqual(['service-operations.json']);
  });
  it('still locks on a changed, missing or wrong-origin configuration', async () => {
    const f = continuous();
    expect(
      (
        await loadRuntimeEvidence({ ...f.options, cloudHttpOrigin: 'https://other.livekit.cloud' })
      ).namespaceOwnershipConfirmed(),
    ).toBe(false);
    const first = await loadRuntimeEvidence(f.options);
    writeFileSync(f.path, JSON.stringify({ ...f.policy, checkedBy: 'changed-operator' }));
    await first.refresh();
    expect(first.namespaceOwnershipConfirmed()).toBe(false);
    rmSync(f.path);
    expect((await loadRuntimeEvidence(f.options)).namespaceOwnershipConfirmed()).toBe(false);
  });
});

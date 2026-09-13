import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { MediaCoordinatorServices } from '../media/MediaCoordinator.js';
import type { OfficialBudgetCheckpoint } from '../media/types.js';
import { checksum } from '../operations/CheckpointStore.js';
import { validateOfficialBudget } from '../operations/UsageCheckpoint.js';

/** Operator-controlled provisioning evidence, not a client request or QA preflight. */
const reference = z
  .string()
  .min(4)
  .max(512)
  .refine(
    (value) =>
      value === value.trim() &&
      !/[\r\n\0]/.test(value) &&
      !/^(example|dummy|sample|placeholder|test|unknown|todo|pending)$/i.test(value),
  );
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/);
const epoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const evidenceSchema = z
  .object({
    version: z.literal(1),
    attestationId: identifier,
    projectAlias: identifier,
    namespace: identifier,
    checkedBy: z
      .string()
      .min(1)
      .max(128)
      .refine(
        (value) =>
          value === value.trim() &&
          !/[\r\n\0]/.test(value) &&
          !/^(example|dummy|sample|placeholder|test|unknown|todo|pending)$/i.test(value),
      ),
    checkedAtEpochMs: epoch,
    expiresAtEpochMs: epoch,
    evidenceRefs: z
      .object({
        namespaceOwnership: reference,
        firstInstallation: reference.optional(),
        firstAudit: reference.optional(),
      })
      .strict(),
    officialBudget: z
      .object({
        checkpointSha256: z.string().regex(/^[a-f0-9]{64}$/),
        periodId: identifier,
        version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        evidenceRef: reference,
      })
      .strict()
      .optional(),
  })
  .strict();

export type RuntimeEvidence = z.infer<typeof evidenceSchema>;
export const RUNTIME_EVIDENCE_FAILURES = [
  'INITIAL_VALIDATION_FAILED',
  'CLOCK_INVALID',
  'CLOCK_ROLLBACK',
  'EVIDENCE_FUTURE',
  'EVIDENCE_EXPIRED',
  'EVIDENCE_STALE',
  'EPOCH_LEASE_EXPIRED',
  'MONOTONIC_LEASE_EXPIRED',
  'FILE_INVALID',
  'FILE_CHANGED',
  'FILE_READ_FAILED',
  'CLOSED',
] as const;
export type RuntimeEvidenceDiagnostic = Readonly<{
  reason: (typeof RUNTIME_EVIDENCE_FAILURES)[number] | null;
  firstFailureReason: (typeof RUNTIME_EVIDENCE_FAILURES)[number] | null;
  refreshCount: number;
  leaseRecoveryCount: number;
  refreshPending: boolean;
  maxRefreshDurationMs: number;
  clockRollbackMs: number;
  clockCorrectionCount: number;
  maxClockCorrectionMs: number;
}>;
// A deployment configuration, not a periodically renewed statement of Cloud usage.
// The provider enforces its quota; no remaining allowance or billing timestamp is invented.
const servicePolicySchema = evidenceSchema
  .omit({ expiresAtEpochMs: true, officialBudget: true, version: true })
  .extend({
    version: z.literal(2),
    operatingMode: z.literal('continuous'),
    budgetPolicy: z.literal('provider-quota'),
    cloudHttpOrigin: z.string().url(),
  })
  .strict();
export type RuntimeEvidenceServices = Required<
  Pick<
    MediaCoordinatorServices,
    | 'namespaceOwnershipConfirmed'
    | 'firstInstallationConfirmed'
    | 'firstAuditConfirmed'
    | 'getOfficialRevision'
  >
> & {
  getDiagnostic(): RuntimeEvidenceDiagnostic;
  refresh(): Promise<void>;
  close(): Promise<void>;
};
export type RuntimeEvidenceOptions = Readonly<{
  operatingMode?: 'attested' | 'continuous';
  cloudHttpOrigin?: string;
  opsDataDir: string;
  projectAlias: string;
  namespace: string;
  nowEpochMs: () => number;
  maxAgeMs: number;
}>;

const EVIDENCE_FILE = 'runtime-evidence.json';
const MAX_BYTES = 32 * 1024;
// Initial policy for a static operator attestation, not a deployment SLA or media deadline.
// Five inspection opportunities tolerate local IO scheduling; actual evidence expiry is separate.
const REFRESH_INTERVAL_MS = 1000;
const VERIFIED_LEASE_MS = 5000;
// Date.now can briefly regress during host clock correction (2ms observed in integration).
// Compare against the accepted high-water mark, not the previous raw sample, so repeated
// corrections cannot accumulate. This does not change attestation or verification deadlines.
const MAX_CLOCK_CORRECTION_MS = 5;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const LOCKED: RuntimeEvidenceServices = Object.freeze({
  getDiagnostic: () => ({
    reason: 'INITIAL_VALIDATION_FAILED' as const,
    firstFailureReason: 'INITIAL_VALIDATION_FAILED' as const,
    refreshCount: 0,
    leaseRecoveryCount: 0,
    refreshPending: false,
    maxRefreshDurationMs: 0,
    clockRollbackMs: 0,
    clockCorrectionCount: 0,
    maxClockCorrectionMs: 0,
  }),
  namespaceOwnershipConfirmed: () => false,
  firstInstallationConfirmed: async () => false,
  firstAuditConfirmed: () => false,
  getOfficialRevision: () => null,
  refresh: async () => {},
  close: async () => {},
});

/** Canonical SHA-256 of all six validated official fields; JSON whitespace/order is irrelevant. */
export function officialCheckpointDigest(checkpoint: OfficialBudgetCheckpoint): string {
  return checksum(validateOfficialBudget(checkpoint));
}

function regularFile(path: string): boolean {
  const stat = lstatSync(path);
  return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_BYTES;
}

/**
 * Freeze the verified scope configuration (or legacy expiring attestation) for this process.
 * Changed/missing files lock this instance; configuration changes require a new validation.
 * Continuous scope has no daily expiry. File contents
 * are never logged. Normal getters only check a bounded in-memory lease. An asynchronous
 * refresh verifies the unchanged file and may recover an expired verification lease.
 * Invalid evidence remains latched; first-use callbacks alone perform durable marker IO.
 */
export async function loadRuntimeEvidence(
  options: RuntimeEvidenceOptions,
): Promise<RuntimeEvidenceServices> {
  const continuous = options.operatingMode === 'continuous';
  const path = join(options.opsDataDir, continuous ? 'service-operations.json' : EVIDENCE_FILE);
  let evidence: RuntimeEvidence | z.infer<typeof servicePolicySchema>;
  let originalDigest: string;
  let lastNow = 0;
  try {
    if (
      !isAbsolute(options.opsDataDir) ||
      (!continuous && (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs <= 0))
    )
      return LOCKED;
    if (!regularFile(path)) return LOCKED;
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_BYTES) return LOCKED;
    evidence = (continuous ? servicePolicySchema : evidenceSchema).parse(
      JSON.parse(bytes.toString('utf8')),
    );
    originalDigest = digest(bytes);
    if (evidence.projectAlias !== options.projectAlias || evidence.namespace !== options.namespace)
      return LOCKED;
    if (evidence.version === 1 && evidence.checkedAtEpochMs >= evidence.expiresAtEpochMs)
      return LOCKED;
    if (
      evidence.version === 2 &&
      (evidence.cloudHttpOrigin !== options.cloudHttpOrigin ||
        new URL(evidence.cloudHttpOrigin).origin !== evidence.cloudHttpOrigin ||
        new URL(evidence.cloudHttpOrigin).protocol !== 'https:')
    )
      return LOCKED;
    if (evidence.version === 2) {
      // Preserve the project binding even for a quota ledger that has no official checkpoint.
      // Read-only preparation must never create or replace these one-use markers.
      for (const purpose of ['firstInstallation', 'firstAudit']) {
        const markerPath = join(options.opsDataDir, `runtime-${purpose}-consumed.json`);
        if (!existsSync(markerPath)) continue;
        if (!regularFile(markerPath)) return LOCKED;
        const marker = JSON.parse(await readFile(markerPath, 'utf8'));
        if (
          marker.version !== 1 ||
          marker.purpose !== purpose ||
          marker.projectAlias !== evidence.projectAlias ||
          marker.namespace !== evidence.namespace ||
          (marker.cloudHttpOrigin !== undefined &&
            marker.cloudHttpOrigin !== evidence.cloudHttpOrigin)
        )
          return LOCKED;
      }
    }
  } catch {
    return LOCKED;
  }
  let locked = false;
  let reason: RuntimeEvidenceDiagnostic['reason'] = null;
  let firstFailureReason: RuntimeEvidenceDiagnostic['reason'] = null;
  let refreshCount = 0;
  let leaseRecoveryCount = 0;
  let maxRefreshDurationMs = 0;
  let clockRollbackMs = 0;
  let clockCorrectionCount = 0;
  let maxClockCorrectionMs = 0;
  const invalidate = (failure: NonNullable<RuntimeEvidenceDiagnostic['reason']>) => {
    if (locked) return false;
    firstFailureReason ??= failure;
    reason = failure;
    locked = true;
    return false;
  };
  const expireLease = (failure: 'EPOCH_LEASE_EXPIRED' | 'MONOTONIC_LEASE_EXPIRED') => {
    firstFailureReason ??= failure;
    reason = failure;
    return false;
  };
  let verifiedUntilEpochMs = Number.POSITIVE_INFINITY;
  let verifiedUntilMonotonicMs = Number.POSITIVE_INFINITY;
  const current = (verifyLease = true): boolean => {
    if (locked) return false;
    try {
      const rawNow = options.nowEpochMs();
      if (!Number.isSafeInteger(rawNow)) return invalidate('CLOCK_INVALID');
      if (rawNow < lastNow) {
        const correction = lastNow - rawNow;
        if (correction > MAX_CLOCK_CORRECTION_MS) {
          clockRollbackMs = correction;
          return invalidate('CLOCK_ROLLBACK');
        }
        clockCorrectionCount++;
        maxClockCorrectionMs = Math.max(maxClockCorrectionMs, correction);
      }
      const now = Math.max(lastNow, rawNow);
      if (now < evidence.checkedAtEpochMs) return invalidate('EVIDENCE_FUTURE');
      if (evidence.version === 1 && now >= evidence.expiresAtEpochMs)
        return invalidate('EVIDENCE_EXPIRED');
      if (evidence.version === 1 && now - evidence.checkedAtEpochMs > options.maxAgeMs)
        return invalidate('EVIDENCE_STALE');
      if (verifyLease && now >= verifiedUntilEpochMs) return expireLease('EPOCH_LEASE_EXPIRED');
      if (verifyLease && performance.now() >= verifiedUntilMonotonicMs)
        return expireLease('MONOTONIC_LEASE_EXPIRED');
      lastNow = now;
      return true;
    } catch {
      return invalidate('CLOCK_INVALID');
    }
  };
  if (!current()) return LOCKED;
  verifiedUntilEpochMs = lastNow + VERIFIED_LEASE_MS;
  verifiedUntilMonotonicMs = performance.now() + VERIFIED_LEASE_MS;

  let pendingRefresh: Promise<void> | undefined;
  const refresh = (): Promise<void> => {
    if (pendingRefresh) return pendingRefresh;
    // A stale snapshot denies every permission, but an unchanged configuration may be
    // reverified. Invalid/changed files, clock failures, attestation expiry and close latch.
    if (!current(false)) return Promise.resolve();
    const startedAt = performance.now();
    const startedAtEpochMs = lastNow;
    pendingRefresh = (async () => {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_BYTES) {
          invalidate('FILE_INVALID');
          return;
        }
        const bytes = await readFile(path);
        if (bytes.byteLength > MAX_BYTES || digest(bytes) !== originalDigest) {
          invalidate('FILE_CHANGED');
          return;
        }
        if (!current(false)) return;
        // Do not turn an old in-flight read into fresh proof. Start a new inspection on the
        // next timer only after this read settles; never accumulate overlapping file IO.
        if (lastNow - startedAtEpochMs >= VERIFIED_LEASE_MS) {
          expireLease('EPOCH_LEASE_EXPIRED');
          return;
        }
        if (performance.now() - startedAt >= VERIFIED_LEASE_MS) {
          expireLease('MONOTONIC_LEASE_EXPIRED');
          return;
        }
        if (reason === 'EPOCH_LEASE_EXPIRED' || reason === 'MONOTONIC_LEASE_EXPIRED')
          leaseRecoveryCount++;
        verifiedUntilEpochMs = lastNow + VERIFIED_LEASE_MS;
        verifiedUntilMonotonicMs = performance.now() + VERIFIED_LEASE_MS;
        reason = null;
        refreshCount++;
      } catch {
        invalidate('FILE_READ_FAILED');
      } finally {
        maxRefreshDurationMs = Math.max(maxRefreshDurationMs, performance.now() - startedAt);
        pendingRefresh = undefined;
      }
    })();
    return pendingRefresh;
  };
  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  timer.unref();
  const close = async (): Promise<void> => {
    if (!locked) invalidate('CLOSED');
    clearInterval(timer);
    await pendingRefresh;
  };

  const consume = (purpose: 'firstInstallation' | 'firstAudit'): boolean => {
    if (!current() || !evidence.evidenceRefs[purpose]) return false;
    const markerPath = join(options.opsDataDir, `runtime-${purpose}-consumed.json`);
    let descriptor: number | undefined;
    try {
      // Initial history authorization is rare and must verify the file again immediately
      // before consuming proof. Readiness and permission hot paths never perform this IO.
      if (!regularFile(path) || digest(readFileSync(path)) !== originalDigest || !current()) {
        invalidate('FILE_CHANGED');
        return false;
      }
      // A fixed purpose filename prevents replay using another attestation id or process.
      // An incomplete marker is deliberately retained: uncertain consumption fails closed.
      descriptor = openSync(markerPath, 'wx', 0o600);
      writeFileSync(
        descriptor,
        JSON.stringify({
          version: 1,
          purpose,
          attestationId: evidence.attestationId,
          evidenceSha256: originalDigest,
          projectAlias: evidence.projectAlias,
          namespace: evidence.namespace,
          ...(evidence.version === 2 ? { cloudHttpOrigin: evidence.cloudHttpOrigin } : {}),
          consumedAtEpochMs: lastNow,
          evidenceRef: evidence.evidenceRefs[purpose],
        }) + '\n',
        'utf8',
      );
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      // Node cannot fsync a directory handle on Windows; deployment durability is a separate
      // Linux volume gate, matching the journal's existing CheckpointStore policy.
      if (process.platform !== 'win32') {
        const directory = openSync(options.opsDataDir, 'r');
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
      }
      return current();
    } catch {
      return false;
    } finally {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          /* The consumed marker remains on disk. */
        }
      }
    }
  };

  return Object.freeze({
    getDiagnostic: () => ({
      reason,
      firstFailureReason,
      refreshCount,
      leaseRecoveryCount,
      refreshPending: !!pendingRefresh,
      maxRefreshDurationMs,
      clockRollbackMs,
      clockCorrectionCount,
      maxClockCorrectionMs,
    }),
    refresh,
    close,
    namespaceOwnershipConfirmed: () => current(),
    firstInstallationConfirmed: async () => consume('firstInstallation'),
    firstAuditConfirmed: () => consume('firstAudit'),
    getOfficialRevision: (checkpoint: OfficialBudgetCheckpoint) => {
      if (!current() || evidence.version !== 1 || !evidence.officialBudget) return null;
      try {
        validateOfficialBudget(checkpoint, {
          projectAlias: options.projectAlias,
          nowEpochMs: options.nowEpochMs(),
          maxAgeMs: options.maxAgeMs,
        });
        if (officialCheckpointDigest(checkpoint) !== evidence.officialBudget.checkpointSha256)
          return null;
        return {
          periodId: evidence.officialBudget.periodId,
          version: evidence.officialBudget.version,
        };
      } catch {
        return null;
      }
    },
  });
}

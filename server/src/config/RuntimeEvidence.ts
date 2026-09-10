import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
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
export type RuntimeEvidenceServices = Required<
  Pick<
    MediaCoordinatorServices,
    | 'namespaceOwnershipConfirmed'
    | 'firstInstallationConfirmed'
    | 'firstAuditConfirmed'
    | 'getOfficialRevision'
  >
> & {
  refresh(): Promise<void>;
  close(): Promise<void>;
};
export type RuntimeEvidenceOptions = Readonly<{
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
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const LOCKED: RuntimeEvidenceServices = Object.freeze({
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
 * Freeze one verified attestation for this process. Changed/missing/expired evidence locks
 * this instance; an operator refresh requires a restart and a new validation. File contents
 * are never logged. Normal getters only check a bounded in-memory lease. An asynchronous
 * refresh verifies the unchanged file; first-use callbacks alone perform durable marker IO.
 */
export async function loadRuntimeEvidence(
  options: RuntimeEvidenceOptions,
): Promise<RuntimeEvidenceServices> {
  const path = join(options.opsDataDir, EVIDENCE_FILE);
  let evidence: RuntimeEvidence;
  let originalDigest: string;
  let lastNow = 0;
  try {
    if (
      !isAbsolute(options.opsDataDir) ||
      !Number.isSafeInteger(options.maxAgeMs) ||
      options.maxAgeMs <= 0
    )
      return LOCKED;
    if (!regularFile(path)) return LOCKED;
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_BYTES) return LOCKED;
    evidence = evidenceSchema.parse(JSON.parse(bytes.toString('utf8')));
    originalDigest = digest(bytes);
    if (evidence.projectAlias !== options.projectAlias || evidence.namespace !== options.namespace)
      return LOCKED;
    if (evidence.checkedAtEpochMs >= evidence.expiresAtEpochMs) return LOCKED;
  } catch {
    return LOCKED;
  }
  let locked = false;
  let verifiedUntilEpochMs = Number.POSITIVE_INFINITY;
  let verifiedUntilMonotonicMs = Number.POSITIVE_INFINITY;
  const current = (): boolean => {
    if (locked) return false;
    try {
      const now = options.nowEpochMs();
      if (
        !Number.isSafeInteger(now) ||
        now < lastNow ||
        now < evidence.checkedAtEpochMs ||
        now >= evidence.expiresAtEpochMs ||
        now - evidence.checkedAtEpochMs > options.maxAgeMs ||
        now >= verifiedUntilEpochMs ||
        performance.now() >= verifiedUntilMonotonicMs
      ) {
        locked = true;
        return false;
      }
      lastNow = now;
      return true;
    } catch {
      locked = true;
      return false;
    }
  };
  if (!current()) return LOCKED;
  verifiedUntilEpochMs = lastNow + VERIFIED_LEASE_MS;
  verifiedUntilMonotonicMs = performance.now() + VERIFIED_LEASE_MS;

  let pendingRefresh: Promise<void> | undefined;
  const refresh = (): Promise<void> => {
    if (pendingRefresh) return pendingRefresh;
    if (!current()) return Promise.resolve();
    pendingRefresh = (async () => {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_BYTES) {
          locked = true;
          return;
        }
        const bytes = await readFile(path);
        if (bytes.byteLength > MAX_BYTES || digest(bytes) !== originalDigest) {
          locked = true;
          return;
        }
        // A late completion must never reopen an expired lease or a closed provider.
        if (!current()) return;
        verifiedUntilEpochMs = lastNow + VERIFIED_LEASE_MS;
        verifiedUntilMonotonicMs = performance.now() + VERIFIED_LEASE_MS;
      } catch {
        locked = true;
      } finally {
        pendingRefresh = undefined;
      }
    })();
    return pendingRefresh;
  };
  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  timer.unref();
  const close = async (): Promise<void> => {
    locked = true;
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
        locked = true;
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
    refresh,
    close,
    namespaceOwnershipConfirmed: current,
    firstInstallationConfirmed: async () => consume('firstInstallation'),
    firstAuditConfirmed: () => consume('firstAudit'),
    getOfficialRevision: (checkpoint: OfficialBudgetCheckpoint) => {
      if (!current() || !evidence.officialBudget) return null;
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

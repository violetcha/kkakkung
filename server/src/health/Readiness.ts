import { parseCapabilityReport, type CapabilityReport } from '../media/CloudCapabilityProbe.js';
import { LIVEKIT_SDK_VERSION } from '../media/LiveKitGateway.js';
import type { Generation, MediaGenerationRegistry } from '../media/MediaGenerationRegistry.js';
import type { MediaConfiguration, Readiness } from '../media/types.js';
import type { OperationJournal } from '../operations/OperationJournal.js';
import type { OperationsAudit } from '../operations/OperationsAudit.js';
import type { RecoveryBootstrap } from '../operations/RecoveryBootstrap.js';
import type { RevocationRetries } from '../operations/RevocationRetries.js';
import type { UsageBudget } from '../operations/UsageBudget.js';
import { validateOfficialBudget, validateUsageState } from '../operations/UsageCheckpoint.js';
import { inspectReservationReadiness } from './ReservationReadiness.js';

const reasonCodes = new Set([
  'READINESS_UNCONFIRMED',
  'INITIALIZATION_UNCONFIRMED',
  'INITIALIZATION_FAILED',
  'CLOSED',
  'RECOVERY_PENDING',
  'CLEANUP_PENDING',
  'CLEANUP_FAILED',
  'CLEANUP_REPORT_INVALID',
  'CLEANUP_NOT_CONFIGURED',
  'RECOVERY_CLOCK_INVALID',
  'RETRY_CHECKPOINT_UNREADABLE',
  'WRITER_CONFLICT',
  'STORAGE_NOT_WRITABLE',
  'JOURNAL_INTEGRITY',
  'JOURNAL_HISTORY_MISSING',
  'JOURNAL_SCOPE_MISMATCH',
  'JOURNAL_IDENTITY_CONFLICT',
  'USAGE_INTEGRITY',
  'USAGE_HISTORY_MISSING',
  'RESERVATION_HISTORY_MISMATCH',
  'HISTORY_INCOMPLETE',
  'RETRY_CHECKPOINT_MISSING',
  'RETRY_CHECKPOINT_INTEGRITY',
  'RETRY_CHECKPOINT_AHEAD',
  'RETRY_JOURNAL_MISMATCH',
  'RETRY_CLOCK_INVALID',
  'RETRY_HISTORY_CORRUPT',
  'RETRY_JOURNAL_FAILED',
  'JOURNAL_WRITE_FAILED',
  'RECOVERY_UNCONFIRMED',
  'USAGE_RESERVATION_UNCONFIRMED',
  'RETIREMENT_UNRESOLVED',
  'RECOVERY_LOCKED',
  'BUDGET_UNCONFIRMED',
  'REMOTE_RETIREMENT_UNCONFIRMED',
  'SINGLE_WRITER_UNCONFIRMED',
  'AUDIT_WRITE_FAILED',
  'MEDIA_MODE_UNCONFIRMED',
  'PRODUCT_SECURITY_UNCONFIRMED',
  'NAMESPACE_OWNERSHIP_UNCONFIRMED',
  'CLOUD_CAPABILITY_UNCONFIRMED',
  'BUDGET_OVERCOMMITTED',
  'ISSUANCE_UNRESOLVED',
]);

function snapshot(
  state: Readiness['state'],
  codes: readonly string[],
  historyComplete: boolean,
  unresolvedCount: number,
): Readiness {
  return Object.freeze({
    state,
    reasonCodes: Object.freeze([...new Set(codes)]),
    historyComplete,
    unresolvedCount,
  });
}

const unconfirmed = () => snapshot('LOCKED', ['READINESS_UNCONFIRMED'], false, 0);

/** Public projections never forward arbitrary producer codes, getters or extra fields. */
export function sanitizeReadiness(value: unknown): Readiness {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unconfirmed();
    const fields = Object.getOwnPropertyDescriptors(value);
    const read = (key: string): unknown => {
      const field = fields[key];
      if (!field || !('value' in field)) throw new Error('INVALID_READINESS');
      return field.value;
    };
    const state = read('state');
    const history = read('historyComplete');
    const count = read('unresolvedCount');
    const rawCodes = read('reasonCodes');
    if (
      (state !== 'READY' && state !== 'RECOVERING' && state !== 'LOCKED') ||
      typeof history !== 'boolean' ||
      !Number.isSafeInteger(count) ||
      (count as number) < 0 ||
      !Array.isArray(rawCodes) ||
      rawCodes.length > reasonCodes.size ||
      Array.from(rawCodes).some(
        (code: unknown) => typeof code !== 'string' || !reasonCodes.has(code),
      )
    )
      return unconfirmed();
    if (state === 'READY' && (!history || count !== 0 || rawCodes.length !== 0))
      return unconfirmed();
    return snapshot(state, rawCodes as string[], history, count as number);
  } catch {
    return unconfirmed();
  }
}

export type ReadinessGateOptions = Readonly<{
  config: MediaConfiguration;
  recovery: RecoveryBootstrap;
  registry: MediaGenerationRegistry;
  journal: OperationJournal;
  usageBudget: UsageBudget;
  audit: OperationsAudit;
  retryCheckpoint: Readonly<{ writable: boolean }>;
  cleanupCheckpoint: Readonly<{ writable: boolean }>;
  retries: readonly RevocationRetries[];
  nowEpochMs: () => number;
  isInitialized: () => boolean;
  /** F's validated runtime mode; absent/disabled/mock cannot claim product readiness. */
  mediaMode: () => 'cloud' | 'disabled' | 'mock' | null;
  /** B's live authentication/entry-protection evidence, never an environment true switch. */
  productSecurityReady: () => boolean;
  namespaceOwnershipConfirmed: () => boolean;
  capability: () => CapabilityReport | null;
  /** Only the bound issuer's reserve -> PREPARED write interval is exempt from orphan detection. */
  pendingPreparations: () => readonly Generation[];
}>;

/** Complete product readiness, independent of OPEN/DRAINING and with no network or disk IO. */
export class ReadinessGate {
  private readonly config: MediaConfiguration;
  private readonly locked = new Set<string>();

  constructor(private readonly options: ReadinessGateOptions) {
    this.config = structuredClone(options.config);
    if (
      options.registry.namespace !== this.config.namespace ||
      options.registry.serverEpoch !== options.recovery.serverEpoch
    )
      throw new Error('READINESS_SCOPE_MISMATCH');
  }

  lock(reason: string): void {
    this.locked.add(reasonCodes.has(reason) ? reason : 'READINESS_UNCONFIRMED');
  }

  getReadiness(): Readiness {
    try {
      return this.observe();
    } catch {
      return snapshot('LOCKED', [...this.locked, 'READINESS_UNCONFIRMED'], false, 0);
    }
  }

  private observe(): Readiness {
    const o = this.options;
    if (o.isInitialized() !== true)
      return snapshot(
        this.locked.size ? 'LOCKED' : 'RECOVERING',
        [...this.locked, 'INITIALIZATION_UNCONFIRMED'],
        false,
        0,
      );
    // E-12's cached recovery readiness must also learn about a newly reconciled official budget.
    o.recovery.refreshBudget();
    const recovery = o.recovery.state.snapshot();
    const codes = new Set(this.locked);
    const local = sanitizeReadiness(o.recovery.getReadiness());
    for (const code of local.reasonCodes) codes.add(code);
    if (local.state === 'LOCKED' && local.reasonCodes.length === 0) codes.add('RECOVERY_LOCKED');
    if (!local.historyComplete || !recovery.historyComplete) codes.add('HISTORY_INCOMPLETE');
    if (!recovery.singleWriter) codes.add('SINGLE_WRITER_UNCONFIRMED');
    if (!['ok', 'missing'].includes(recovery.integrity)) codes.add('JOURNAL_INTEGRITY');
    const journal = o.journal.snapshot();
    const usage = o.usageBudget.snapshot();
    if (
      !recovery.writable ||
      !o.journal.writable ||
      !journal.writable ||
      !usage.writable ||
      !o.retryCheckpoint.writable ||
      !o.cleanupCheckpoint.writable
    ) {
      this.lock('STORAGE_NOT_WRITABLE');
      codes.add('STORAGE_NOT_WRITABLE');
    }
    if (!o.audit.writable) {
      this.lock('AUDIT_WRITE_FAILED');
      codes.add('AUDIT_WRITE_FAILED');
    }
    if (o.mediaMode() !== 'cloud') codes.add('MEDIA_MODE_UNCONFIRMED');
    if (!this.config.productSecurityReady || o.productSecurityReady() !== true)
      codes.add('PRODUCT_SECURITY_UNCONFIRMED');
    if (o.namespaceOwnershipConfirmed() !== true) codes.add('NAMESPACE_OWNERSHIP_UNCONFIRMED');
    const now = o.nowEpochMs();
    try {
      const report = parseCapabilityReport(o.capability());
      if (
        report.status !== 'SUPPORTED' ||
        report.cloudProjectAlias !== this.config.projectAlias ||
        report.namespace !== this.config.namespace ||
        report.sdkVersion !== LIVEKIT_SDK_VERSION ||
        !Number.isSafeInteger(now) ||
        now < report.testedAtEpochMs
      )
        throw new Error('UNCONFIRMED_CAPABILITY');
    } catch {
      codes.add('CLOUD_CAPABILITY_UNCONFIRMED');
    }
    let accounting = { consistent: false, unresolvedCount: 0 };
    try {
      if (usage.integrity !== 'ok') throw new Error('UNCONFIRMED_USAGE');
      const validated = validateUsageState({
        official: usage.official,
        reservations: usage.reservations,
      });
      accounting = inspectReservationReadiness({
        namespace: this.config.namespace,
        serverEpoch: o.registry.serverEpoch,
        records: journal.records,
        reservations: validated.reservations,
        generations: o.registry.all(),
        pendingPreparations: o.pendingPreparations(),
      });
      if (!accounting.consistent) codes.add('RESERVATION_HISTORY_MISMATCH');
    } catch {
      codes.add('USAGE_INTEGRITY');
    }
    try {
      if (usage.integrity !== 'ok' || !usage.official) throw new Error('UNCONFIRMED_BUDGET');
      const official = validateOfficialBudget(usage.official.checkpoint, {
        projectAlias: this.config.projectAlias,
        nowEpochMs: now,
        maxAgeMs: this.config.officialBudgetMaxAgeMs,
      });
      if (
        ![usage.activeMinutes, usage.activeBytes].every((v) => Number.isFinite(v) && v >= 0) ||
        usage.activeMinutes > official.remainingMinutes ||
        usage.activeBytes > official.remainingBytes
      )
        codes.add('BUDGET_OVERCOMMITTED');
    } catch {
      codes.add('BUDGET_UNCONFIRMED');
    }
    const retries = o.retries.reduce(
      (count, engine) =>
        count + engine.snapshot().filter((intent) => intent.status !== 'REVOKED').length,
      0,
    );
    const unresolved = Math.max(local.unresolvedCount, accounting.unresolvedCount, retries);
    if (!Number.isSafeInteger(unresolved)) return unconfirmed();
    if (unresolved > 0) codes.add('REMOTE_RETIREMENT_UNCONFIRMED');
    const pending = local.state === 'RECOVERING';
    if (pending) codes.add('CLEANUP_PENDING');
    const failed = [...codes].some((code) => code !== 'CLEANUP_PENDING');
    return snapshot(
      failed ? 'LOCKED' : pending ? 'RECOVERING' : 'READY',
      [...codes],
      local.historyComplete && recovery.historyComplete && accounting.consistent,
      unresolved,
    );
  }
}

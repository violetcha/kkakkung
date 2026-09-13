import type { Readiness } from '../media/types.js';
import { checksum, strictObject } from './CheckpointStore.js';
import {
  validateJournalRecord,
  type JournalEntry,
  type JournalRestore,
} from './OperationJournal.js';

/** E-13 implements this port; E-12 does not start or fabricate Cloud cleanup itself. */
export type CleanupInput = Readonly<{
  records: readonly JournalEntry[];
  historyComplete: boolean;
  singleWriter: boolean;
}>;
export type CleanupReport = Readonly<{
  recordedIdentities: number;
  observedParticipants: number;
  revoked: number;
  unresolved: number;
  ownedRoomsRemaining: number;
  historyComplete: boolean;
}>;
export type RecoverySnapshot = Readonly<{
  phase: 'RECOVERING' | 'READY' | 'LOCKED';
  integrity: JournalRestore['integrity'];
  pendingCount: number;
  budgetConfirmed: boolean;
  writable: boolean;
  singleWriter: boolean;
  historyComplete: boolean;
  reasonCodes: readonly string[];
}>;

const lockReasons = new Set([
  'CLOSED',
  'CLEANUP_FAILED',
  'CLEANUP_REPORT_INVALID',
  'CLEANUP_NOT_CONFIGURED',
  'RECOVERY_CLOCK_INVALID',
  'RETRY_CHECKPOINT_UNREADABLE',
  'WRITER_CONFLICT',
  'INITIALIZATION_FAILED',
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
]);

export function restoreMonotonicDeadline(
  deadlineEpochMs: number,
  nowEpochMs: number,
  monotonicNow: number,
): number {
  if (
    ![deadlineEpochMs, nowEpochMs].every((value) => Number.isSafeInteger(value) && value >= 0) ||
    !Number.isFinite(monotonicNow) ||
    monotonicNow < 0
  )
    throw new Error('INVALID_RECOVERY_CLOCK');
  const deadline = monotonicNow + Math.max(0, deadlineEpochMs - nowEpochMs);
  if (!Number.isFinite(deadline) || deadline > Number.MAX_SAFE_INTEGER)
    throw new Error('INVALID_RECOVERY_CLOCK');
  return deadline;
}

function pendingIdentities(journal: JournalRestore): number {
  if (
    !Array.isArray(journal.records) ||
    !Number.isSafeInteger(journal.lastSeq) ||
    journal.lastSeq < 0
  )
    throw new Error('INVALID_RECOVERY_JOURNAL');
  const latest = new Map<string, JournalEntry['record']['state']>();
  let previousSeq = 0;
  for (const entry of journal.records) {
    strictObject(entry, ['version', 'seq', 'record', 'checksum']);
    const record = validateJournalRecord(entry.record);
    if (
      entry.version !== 1 ||
      !Number.isSafeInteger(entry.seq) ||
      entry.seq <= previousSeq ||
      entry.seq > journal.lastSeq ||
      entry.checksum !== checksum({ version: 1, seq: entry.seq, record })
    )
      throw new Error('INVALID_RECOVERY_JOURNAL');
    previousSeq = entry.seq;
    latest.set(
      JSON.stringify([record.namespace, record.roomName, record.identity, record.generation]),
      record.state,
    );
  }
  return [...latest.values()].filter((state) => state !== 'REVOKED' && state !== 'ABORTED').length;
}

function validatedCleanup(report: CleanupReport): CleanupReport {
  const counts = [
    report.recordedIdentities,
    report.observedParticipants,
    report.revoked,
    report.unresolved,
    report.ownedRoomsRemaining,
  ];
  if (
    !counts.every((value) => Number.isSafeInteger(value) && value >= 0) ||
    !Number.isSafeInteger(report.unresolved + report.ownedRoomsRemaining) ||
    typeof report.historyComplete !== 'boolean'
  )
    throw new Error('INVALID_CLEANUP_REPORT');
  return {
    recordedIdentities: report.recordedIdentities,
    observedParticipants: report.observedParticipants,
    revoked: report.revoked,
    unresolved: report.unresolved,
    ownedRoomsRemaining: report.ownedRoomsRemaining,
    historyComplete: report.historyComplete,
  };
}

/** READY here means recovery checks passed; E-15 owns the complete product readiness gate. */
export class RecoveryState {
  private state: RecoverySnapshot = {
    phase: 'RECOVERING',
    integrity: 'missing',
    pendingCount: 0,
    budgetConfirmed: false,
    writable: false,
    singleWriter: false,
    historyComplete: false,
    reasonCodes: ['RECOVERY_PENDING'],
  };
  private readonly localReasons = new Set<string>();
  private cleanup: CleanupReport | null = null;
  private restored = false;

  restore(
    journal: JournalRestore,
    usage: { integrity: 'ok' | 'missing' | 'corrupt'; writable: boolean; budgetConfirmed: boolean },
    options: { firstInstallConfirmed?: boolean; usageInitializedMissing?: boolean } = {},
  ): void {
    // Restore is a process-lifetime boundary. It cannot discard a failure or reuse old cleanup.
    if (this.restored) return;
    this.restored = true;
    let pendingCount = 0;
    let integrity = journal.integrity;
    try {
      pendingCount = pendingIdentities(journal);
      if (!['ok', 'missing', 'corrupt', 'partial'].includes(integrity))
        throw new Error('INVALID_RECOVERY_INTEGRITY');
    } catch {
      integrity = 'corrupt';
    }
    if (
      integrity === 'corrupt' ||
      integrity === 'partial' ||
      journal.reason === 'INTEGRITY_FAILURE'
    )
      this.localReasons.add('JOURNAL_INTEGRITY');
    if (!['ok', 'missing'].includes(usage.integrity)) this.localReasons.add('USAGE_INTEGRITY');
    const firstInstall =
      options.firstInstallConfirmed === true &&
      (integrity === 'missing' || integrity === 'ok') &&
      journal.lastSeq === 0 &&
      journal.records.length === 0 &&
      (usage.integrity === 'missing' ||
        (usage.integrity === 'ok' && options.usageInitializedMissing === true));
    const historyComplete =
      !this.localReasons.has('JOURNAL_INTEGRITY') &&
      (firstInstall || (integrity === 'ok' && usage.integrity === 'ok'));
    if (!historyComplete) this.localReasons.add('HISTORY_INCOMPLETE');
    const writable = journal.writable === true && usage.writable === true;
    if (!writable) this.localReasons.add('STORAGE_NOT_WRITABLE');
    if (journal.reason === 'WRITER_CONFLICT') this.localReasons.add('WRITER_CONFLICT');
    if (journal.reason === 'IO_FAILURE') this.localReasons.add('INITIALIZATION_FAILED');
    this.state = {
      phase: 'RECOVERING',
      integrity,
      pendingCount,
      budgetConfirmed: usage.budgetConfirmed === true,
      writable,
      singleWriter: journal.reason !== 'WRITER_CONFLICT' && journal.reason !== 'IO_FAILURE',
      historyComplete,
      reasonCodes: [],
    };
    this.recompute();
  }

  completeCleanup(report: CleanupReport): void {
    if (!this.restored) {
      this.lock('RECOVERY_UNCONFIRMED');
      return;
    }
    try {
      this.cleanup = validatedCleanup(report);
    } catch {
      this.lock('CLEANUP_REPORT_INVALID');
      return;
    }
    this.recompute();
  }

  refreshBudget(confirmed: boolean): void {
    this.state = { ...this.state, budgetConfirmed: confirmed === true };
    this.recompute();
  }

  lock(reason: string): void {
    // Health can receive only fixed codes, never an exception message or caller-provided secret.
    this.localReasons.add(lockReasons.has(reason) ? reason : 'RECOVERY_LOCKED');
    this.recompute();
  }

  snapshot(): RecoverySnapshot {
    return structuredClone(this.state);
  }

  readiness(): Readiness {
    return {
      state: this.state.phase,
      reasonCodes: [...this.state.reasonCodes],
      historyComplete: this.state.historyComplete,
      unresolvedCount: this.state.pendingCount,
    };
  }

  private recompute(): void {
    const reasons = new Set(this.localReasons);
    if (!this.restored) {
      reasons.add('RECOVERY_PENDING');
      this.state = {
        ...this.state,
        phase: this.localReasons.size ? 'LOCKED' : 'RECOVERING',
        reasonCodes: [...reasons],
      };
      return;
    }
    if (!this.state.budgetConfirmed) reasons.add('BUDGET_UNCONFIRMED');
    if (!this.cleanup) reasons.add('CLEANUP_PENDING');
    const pendingCount = this.cleanup
      ? this.cleanup.unresolved + this.cleanup.ownedRoomsRemaining
      : this.state.pendingCount;
    const historyComplete = this.state.historyComplete && (this.cleanup?.historyComplete ?? true);
    if (!historyComplete) reasons.add('HISTORY_INCOMPLETE');
    if (this.cleanup && pendingCount > 0) reasons.add('REMOTE_RETIREMENT_UNCONFIRMED');
    const phase = [...reasons].some((reason) => reason !== 'CLEANUP_PENDING')
      ? 'LOCKED'
      : this.cleanup
        ? 'READY'
        : 'RECOVERING';
    this.state = { ...this.state, phase, pendingCount, historyComplete, reasonCodes: [...reasons] };
  }
}

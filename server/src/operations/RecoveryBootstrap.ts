import { randomUUID } from 'node:crypto';
import type { MediaInitializationResult, Readiness } from '../media/types.js';
import type { CheckpointStore } from './CheckpointStore.js';
import type { JournalRestore, OperationJournal } from './OperationJournal.js';
import { reconcileRecoveryRecords, type RecoveryRecords } from './RecoveryRecords.js';
import { RecoveryState, type CleanupInput, type CleanupReport } from './RecoveryState.js';
import type { RetryIntent } from './RevocationRetries.js';
import type { UsageBudget } from './UsageBudget.js';

export type RecoveryCleanupInput = CleanupInput &
  Readonly<{
    serverEpoch: string;
    lastSeq: number;
    pendingRecords: RecoveryRecords['pendingRecords'];
    retryIntents: RecoveryRecords['retryIntents'];
    retryDeadlines: RecoveryRecords['retryDeadlines'];
    reservations: ReturnType<UsageBudget['snapshot']>['reservations'];
    signal: AbortSignal;
    /** E-13 must check this at actual dispatch, after queue/storage waits. */
    beforeDispatch: () => boolean;
  }>;

export type RecoveryBootstrapOptions = Readonly<{
  namespace: string;
  journal: OperationJournal;
  usageBudget: UsageBudget;
  retryCheckpoint: CheckpointStore<readonly RetryIntent[]>;
  /** Share the freshly generated registry epoch; omitted means a new crypto UUID. */
  serverEpoch?: string;
  nowEpochMs: () => number;
  monotonicNow: () => number;
  officialBudgetMaxAgeMs: number;
  beginCleanup?: (input: RecoveryCleanupInput) => Promise<CleanupReport>;
  /** External provisioning evidence, never inferred from missing files or an empty Cloud list. */
  firstInstallationConfirmed?: () => Promise<boolean>;
}>;

/** Synchronous E-12 factory. E's complete MediaCoordinator delegates its boot ports here. */
export function createRecoveryBootstrap(options: RecoveryBootstrapOptions): RecoveryBootstrap {
  return new RecoveryBootstrap(options);
}

/** Local recovery is the listen barrier. E-13 cleanup and E-15 product readiness remain separate. */
export class RecoveryBootstrap {
  readonly serverEpoch: string;
  readonly state = new RecoveryState();
  private initialization: Promise<MediaInitializationResult> | null = null;
  private recovery: Promise<CleanupReport | null> = Promise.resolve(null);
  private closing: Promise<void> | null = null;
  private readonly abort = new AbortController();
  private records: RecoveryRecords | null = null;
  private closed = false;

  constructor(private readonly options: RecoveryBootstrapOptions) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(options.namespace) ||
      options.namespace.includes('--') ||
      !Number.isSafeInteger(options.officialBudgetMaxAgeMs) ||
      options.officialBudgetMaxAgeMs <= 0 ||
      (options.serverEpoch !== undefined &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          options.serverEpoch,
        ))
    )
      throw new Error('INVALID_RECOVERY_CONFIGURATION');
    this.serverEpoch = options.serverEpoch ?? randomUUID();
  }

  initialize(): Promise<MediaInitializationResult> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  /** This recovery component never performs the E-14 admission resume. */
  getAdmission(): 'DRAINING' {
    return 'DRAINING';
  }

  /** Local recovery readiness only; the complete coordinator also applies E-15 checks. */
  getReadiness(): Readiness {
    return this.state.readiness();
  }

  /** Internal E-13 recovery data. Never expose identities/reservations through public health. */
  recovered(): RecoveryRecords | null {
    return this.records ? structuredClone(this.records) : null;
  }

  private async initializeOnce(): Promise<MediaInitializationResult> {
    try {
      if (this.closed) return this.fatal('INITIALIZATION_FAILED');
      const journal = await this.options.journal.restore();
      if (journal.reason === 'WRITER_CONFLICT') return this.fatal('WRITER_CONFLICT');
      if (journal.reason === 'IO_FAILURE' || this.closed)
        return this.fatal('INITIALIZATION_FAILED');

      const retry = await this.options.retryCheckpoint.read();
      if (this.closed) return this.fatal('INITIALIZATION_FAILED');
      const firstInstallConfirmed =
        (journal.integrity === 'missing' || journal.integrity === 'ok') &&
        journal.lastSeq === 0 &&
        journal.records.length === 0 &&
        retry.integrity === 'missing'
          ? (await this.options.firstInstallationConfirmed?.().catch(() => false)) === true
          : false;
      if (this.closed) return this.fatal('INITIALIZATION_FAILED');

      const usage = await this.options.usageBudget.restore({
        allowInitializeMissing: firstInstallConfirmed,
      });
      if (this.closed) return this.fatal('INITIALIZATION_FAILED');
      this.state.restore(
        journal,
        { ...usage, budgetConfirmed: this.budgetConfirmed() },
        { firstInstallConfirmed },
      );
      try {
        this.records = reconcileRecoveryRecords({
          namespace: this.options.namespace,
          journal,
          usage,
          retryCheckpoint: retry,
          epochNowMs: this.options.nowEpochMs(),
          monotonicNow: this.options.monotonicNow(),
        });
        for (const reason of this.records.reasonCodes) this.state.lock(reason);
      } catch {
        // Valid local observation remains useful even when recovery evidence cannot be trusted.
        this.state.lock('RECOVERY_UNCONFIRMED');
      }
      if (!this.options.retryCheckpoint.writable) this.state.lock('RETRY_CHECKPOINT_UNREADABLE');

      const readiness = this.state.readiness();
      const result: MediaInitializationResult = Object.freeze({
        status: 'initialized',
        readiness: Object.freeze({
          ...readiness,
          reasonCodes: Object.freeze([...readiness.reasonCodes]),
          state: readiness.state === 'LOCKED' ? 'LOCKED' : 'RECOVERING',
        }),
        admission: 'DRAINING',
      });
      // Do not await Cloud cleanup. B can observe initialized/LOCKED or RECOVERING first.
      this.recovery = Promise.resolve().then(() => this.recover(journal));
      return result;
    } catch {
      return this.fatal('INITIALIZATION_FAILED');
    }
  }

  private async recover(journal: JournalRestore): Promise<CleanupReport | null> {
    if (this.closed) return null;
    const snapshot = this.state.snapshot();
    if (
      !this.records ||
      this.records.reasonCodes.length > 0 ||
      !snapshot.historyComplete ||
      !snapshot.singleWriter ||
      !snapshot.writable
    )
      return null;
    if (!this.options.beginCleanup) {
      this.state.lock('CLEANUP_NOT_CONFIGURED');
      return null;
    }
    try {
      const report = await this.options.beginCleanup({
        records: structuredClone(this.records.records),
        historyComplete: snapshot.historyComplete,
        singleWriter: snapshot.singleWriter,
        serverEpoch: this.serverEpoch,
        lastSeq: journal.lastSeq,
        pendingRecords: structuredClone(this.records.pendingRecords),
        retryIntents: structuredClone(this.records.retryIntents),
        retryDeadlines: structuredClone(this.records.retryDeadlines),
        reservations: this.options.usageBudget.snapshot().reservations,
        signal: this.abort.signal,
        beforeDispatch: () =>
          !this.closed &&
          !this.abort.signal.aborted &&
          this.options.journal.writable &&
          this.options.retryCheckpoint.writable &&
          this.state.snapshot().historyComplete &&
          this.state.snapshot().singleWriter,
      });
      if (this.closed) return null;
      this.state.completeCleanup(report);
      this.refreshBudget();
      return structuredClone(report);
    } catch {
      if (!this.closed) this.state.lock('CLEANUP_FAILED');
      return null;
    }
  }

  private fatal(code: 'WRITER_CONFLICT' | 'INITIALIZATION_FAILED'): MediaInitializationResult {
    this.state.lock(code);
    return Object.freeze({ status: 'fatal', code });
  }

  private budgetConfirmed(): boolean {
    const usage = this.options.usageBudget.snapshot();
    const checkpoint = usage.official?.checkpoint;
    const now = this.options.nowEpochMs();
    const age = checkpoint ? now - checkpoint.checkedAtEpochMs : -1;
    return (
      usage.integrity === 'ok' &&
      usage.writable &&
      checkpoint !== undefined &&
      Number.isSafeInteger(now) &&
      age >= 0 &&
      age <= this.options.officialBudgetMaxAgeMs
    );
  }

  refreshBudget(): void {
    if (this.closed) return;
    if (!this.options.journal.writable || !this.options.retryCheckpoint.writable)
      this.state.lock('STORAGE_NOT_WRITABLE');
    this.state.refreshBudget(this.budgetConfirmed());
  }

  completion(): Promise<CleanupReport | null> {
    return this.recovery;
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.abort.abort();
      this.state.lock('CLOSED');
      this.closing = this.closeOnce();
    }
    return this.closing;
  }

  private async closeOnce(): Promise<void> {
    // Close admission to both checkpoint queues before yielding. Keep the writer lease until
    // every already-started local write has drained, including usage fsync/rename operations.
    const checkpointClosing = Promise.allSettled([
      this.options.usageBudget.close(),
      this.options.retryCheckpoint.close(),
    ]);
    await this.initialization;
    // Cleanup callbacks must observe signal/beforeDispatch; a stuck network reply cannot hold shutdown.
    const results = await checkpointClosing;
    await this.options.journal.close();
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}

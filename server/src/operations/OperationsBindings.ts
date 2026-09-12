import type {
  MediaConfiguration,
  MediaCoordinatorDeps,
  OfficialBudgetCheckpoint,
  OperationsCommand,
  OperationsStatus,
  Readiness,
} from '../media/types.js';
import { safeIdentifier } from './CheckpointStore.js';
import type { OperationJournal, JournalRecord } from './OperationJournal.js';
import type { RecoveryCleanupBindings } from './RecoveryCleanupBindings.js';
import type { RevocationRetries } from './RevocationRetries.js';
import type { UsageBudget } from './UsageBudget.js';
import { readOfficialUsageInput, validateOfficialBudget } from './UsageCheckpoint.js';

export type OperationsBindingsOptions = Readonly<{
  config: Pick<
    MediaConfiguration,
    | 'opsDataDir'
    | 'projectAlias'
    | 'publicWindow'
    | 'officialBudgetMaxAgeMs'
    | 'productSecurityReady'
  >;
  journal: OperationJournal;
  usageBudget: UsageBudget;
  /** E-15's complete product gate, never just the E-12 recovery component's READY. */
  getReadiness: () => Readiness;
  getGameActivity: MediaCoordinatorDeps['getGameActivity'];
  /** Existing engines: never create a second scheduler or bypass their shared API budget. */
  retries: readonly RevocationRetries[];
  recoveryCleanup?: RecoveryCleanupBindings;
  nowEpochMs: () => number;
  /** Trusted server evidence for the exact input; the six-field HTTP contract has no revision. */
  getOfficialRevision: (
    checkpoint: OfficialBudgetCheckpoint,
  ) => Readonly<{ periodId: string; version: number }> | null;
  refreshBudget?: () => void;
  /** E-16's exact bounded first-attempt retirement; never exempts UNRESOLVED. */
  isRetirementInFlight?: (record: JournalRecord) => boolean;
}>;

/** E-14 action wiring. B owns HTTP/Room assembly; E-15 supplies the complete readiness gate. */
export class OperationsBindings {
  private admission: OperationsStatus['admission'] = 'DRAINING';
  private locked = false;
  private closed = false;
  private checkpointPending = 0;
  private readonly config: OperationsBindingsOptions['config'];
  private readonly abort = new AbortController();
  private readonly active = new Set<Promise<void>>();
  private closing: Promise<void> | null = null;

  constructor(private readonly options: OperationsBindingsOptions) {
    this.config = structuredClone(options.config);
    if (
      !safeIdentifier(this.config.projectAlias) ||
      !Number.isSafeInteger(this.config.officialBudgetMaxAgeMs) ||
      this.config.officialBudgetMaxAgeMs <= 0 ||
      typeof this.config.productSecurityReady !== 'boolean' ||
      new Set(options.retries).size !== options.retries.length
    )
      throw new Error('INVALID_OPERATIONS_CONFIGURATION');
    const window = this.config.publicWindow;
    if (
      window !== null &&
      (![window.opensAtEpochMs, window.closesAtEpochMs].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
        window.closesAtEpochMs <= window.opensAtEpochMs)
    )
      throw new Error('INVALID_PUBLIC_WINDOW');
  }

  setAdmission(value: OperationsStatus['admission']): void {
    if (value === 'LOCKED') this.locked = true;
    if (this.closed || this.locked) this.admission = 'LOCKED';
    else if (value === 'OPEN') this.admission = this.canResume() ? 'OPEN' : 'DRAINING';
    else this.admission = 'DRAINING';
  }

  canResume(): boolean {
    if (
      this.closed ||
      this.locked ||
      this.checkpointPending > 0 ||
      !this.config.productSecurityReady ||
      !this.inWindow()
    )
      return false;
    const status = this.observe();
    return (
      status.readiness === 'READY' &&
      status.unresolvedCount === 0 &&
      status.remainingMinutes !== null &&
      status.remainingMinutes > 0 &&
      status.remainingBytes !== null &&
      status.remainingBytes > 0
    );
  }

  /** Share with B InviteStore.operationsReady and E GrantIssuer/UsageBudget.canIssue. */
  canIssue(): boolean {
    return this.getStatus().admission === 'OPEN' && this.canResume();
  }

  getStatus(): OperationsStatus {
    const status = this.observe();
    // A delayed timer cannot leave an expired public window open at the next admission check.
    if (this.admission === 'OPEN' && !this.canResume()) this.admission = 'DRAINING';
    return {
      admission: this.closed || this.locked ? 'LOCKED' : this.admission,
      ...status,
    };
  }

  canComplete(command: OperationsCommand): boolean {
    if (this.closed) return false;
    if (command.action === 'drain') return this.drained();
    if (this.locked) return false;
    if (command.action === 'resume') return this.canResume();
    return this.options.journal.writable && this.options.usageBudget.snapshot().writable;
  }

  run(
    command: OperationsCommand,
    signal: AbortSignal,
    beforeDispatch: () => boolean,
  ): Promise<void> {
    const combined = AbortSignal.any([signal, this.abort.signal]);
    const allowed = () => !this.closed && !combined.aborted && beforeDispatch();
    const guard = () => {
      if (!allowed()) throw new Error('OPERATION_CANCELLED');
    };
    const work = (async () => {
      guard();
      if (command.action === 'resume') {
        if (!this.canResume()) throw new Error('RESUME_NOT_READY');
        return;
      }
      if (command.action === 'drain') {
        while (true) {
          guard();
          await this.options.journal.flush();
          guard();
          if (this.drained()) return;
          await pause(combined);
        }
      }
      if (command.action === 'retry-retirement') {
        const matches = this.options.retries.flatMap((engine) =>
          engine
            .snapshot()
            .filter((intent) => intent.retirementId === command.retirementId)
            .map((intent) => ({ engine, intent })),
        );
        if (matches.length !== 1 || matches[0]!.intent.status !== 'UNRESOLVED')
          throw new Error('RETIREMENT_NOT_UNRESOLVED');
        // Bare retry commands never attest that a provider's unknown 429 waiting period ended.
        const result = await matches[0]!.engine.retryNow(command.retirementId, {
          signal: combined,
          beforeDispatch: allowed,
        });
        guard();
        if (result.status !== 'REVOKED') throw new Error('RETIREMENT_UNCONFIRMED');
        await this.options.journal.flush();
        guard();
        if (this.options.recoveryCleanup?.retries === matches[0]!.engine) {
          const report = await abortable(this.options.recoveryCleanup.reconcile(), combined);
          guard();
          if (!report.historyComplete || report.unresolved || report.ownedRoomsRemaining)
            throw new Error('RECOVERY_UNCONFIRMED');
        }
        return;
      }
      this.checkpointPending++;
      try {
        await this.checkpoint(guard, allowed);
      } finally {
        this.checkpointPending--;
      }
    })();
    this.active.add(work);
    void work.finally(() => this.active.delete(work)).catch(() => {});
    return work;
  }

  /** Stop commands first; the owner then closes recovery/retry/usage before the journal lease. */
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.admission = 'LOCKED';
      this.abort.abort();
      this.closing = Promise.allSettled([...this.active]).then(() => undefined);
    }
    return this.closing;
  }

  private async checkpoint(guard: () => void, allowed: () => boolean): Promise<void> {
    const input = await readOfficialUsageInput(this.config.opsDataDir, {
      projectAlias: this.config.projectAlias,
      nowEpochMs: this.options.nowEpochMs(),
      maxAgeMs: this.config.officialBudgetMaxAgeMs,
    });
    guard();
    const revision = this.options.getOfficialRevision(Object.freeze({ ...input }));
    if (
      !revision ||
      !safeIdentifier(revision.periodId) ||
      !Number.isSafeInteger(revision.version) ||
      revision.version < 1
    )
      throw new Error('OFFICIAL_REVISION_UNCONFIRMED');
    const captured = { periodId: revision.periodId, version: revision.version };
    const result = await this.options.usageBudget.reconcileOfficial(input, captured, {
      beforeCommit: allowed,
    });
    guard();
    if (result.status === 'rejected') throw new Error('OFFICIAL_CHECKPOINT_REJECTED');
    await this.options.journal.flush();
    guard();
    // Official usage is durable independently of media records. Never invent a Generation
    // just to journal a budget event, nor use an operator body as remote retirement evidence.
    if (this.safeReadiness().historyComplete) {
      for (const reservation of this.options.usageBudget.snapshot().reservations) {
        if (reservation.status !== 'AWAITING_OFFICIAL') continue;
        guard();
        const records = this.options.journal.snapshot().records.map((entry) => entry.record);
        if (
          !reservationRevoked(
            reservation.request.reservationId,
            reservation.request.matchId,
            records,
          )
        )
          continue;
        const released = await this.options.usageBudget.releaseConfirmed(
          reservation.request.reservationId,
          { remoteConfirmed: true, ...captured },
          {
            beforeCommit: () =>
              allowed() &&
              this.safeReadiness().historyComplete &&
              reservationRevoked(
                reservation.request.reservationId,
                reservation.request.matchId,
                this.options.journal.snapshot().records.map((entry) => entry.record),
              ),
          },
        );
        guard();
        if (!released) throw new Error('RESERVATION_RELEASE_UNCONFIRMED');
      }
    }
    this.options.refreshBudget?.();
  }

  private drained(): boolean {
    try {
      const activity = this.options.getGameActivity();
      if (
        ![activity.activeMatches, activity.activePractices, activity.pendingAdmissions].every(
          (value) => Number.isSafeInteger(value) && value === 0,
        )
      )
        return false;
      const readiness = this.safeReadiness();
      const journal = this.options.journal.snapshot();
      const usage = this.options.usageBudget.snapshot();
      return (
        !this.closed &&
        readiness.historyComplete &&
        readiness.unresolvedCount === 0 &&
        journal.writable &&
        journal.records.every((entry) => entry.record.state === 'REVOKED') &&
        usage.writable &&
        usage.integrity === 'ok' &&
        usage.reservations.every(
          (r) => r.status === 'AWAITING_OFFICIAL' || r.status === 'RELEASED',
        ) &&
        this.options.retries.every((engine) =>
          engine.snapshot().every((intent) => intent.status === 'REVOKED'),
        )
      );
    } catch {
      return false;
    }
  }

  private observe(): Omit<OperationsStatus, 'admission'> {
    const readiness = this.safeReadiness();
    const budget = this.options.usageBudget.readSnapshot();
    let official: OfficialBudgetCheckpoint | null = null;
    try {
      if (budget.integrity === 'ok' && budget.writable && budget.official)
        official = validateOfficialBudget(budget.official.checkpoint, {
          projectAlias: this.config.projectAlias,
          nowEpochMs: this.options.nowEpochMs(),
          maxAgeMs: this.config.officialBudgetMaxAgeMs,
        });
    } catch {
      // Unknown/stale evidence remains null, never an invented zero or fresh official report.
    }
    const unresolvedCount = Math.max(
      readiness.unresolvedCount,
      this.options.retries.reduce(
        (sum, engine) => sum + engine.snapshot().filter((r) => r.status !== 'REVOKED').length,
        0,
      ),
      this.options.journal
        .readSnapshot()
        .records.filter(
          ({ record }) =>
            record.state === 'UNRESOLVED' ||
            (record.state === 'REVOKING' && !this.options.isRetirementInFlight?.(record)),
        ).length,
    );
    return {
      readiness:
        this.closed ||
        this.locked ||
        !this.options.journal.writable ||
        !official ||
        !this.config.productSecurityReady ||
        !readiness.historyComplete ||
        unresolvedCount > 0
          ? 'LOCKED'
          : readiness.state,
      unresolvedCount,
      remainingMinutes: official ? budget.availableMinutes : null,
      remainingBytes: official ? budget.availableBytes : null,
      checkedAtEpochMs: official?.checkedAtEpochMs ?? null,
    };
  }

  private safeReadiness(): Readiness {
    try {
      const value = this.options.getReadiness();
      if (
        ['READY', 'RECOVERING', 'LOCKED'].includes(value.state) &&
        typeof value.historyComplete === 'boolean' &&
        Number.isSafeInteger(value.unresolvedCount) &&
        value.unresolvedCount >= 0
      )
        return value;
    } catch {
      // An absent/miswired product gate cannot authorize admission.
    }
    return { state: 'LOCKED', historyComplete: false, unresolvedCount: 0, reasonCodes: [] };
  }

  private inWindow(): boolean {
    const window = this.config.publicWindow;
    const now = this.options.nowEpochMs();
    return (
      Number.isSafeInteger(now) &&
      now >= 0 &&
      window !== null &&
      now >= window.opensAtEpochMs &&
      now < window.closesAtEpochMs
    );
  }
}

function reservationRevoked(id: string, matchId: string, records: readonly JournalRecord[]) {
  const roots = new Set(
    records
      .filter((record) => {
        const root = record.reservationId;
        return (
          root &&
          (id === root || (id.startsWith(`${root}:`) && /^\d+$/.test(id.slice(root.length + 1))))
        );
      })
      .map((record) => record.reservationId!),
  );
  if (roots.size !== 1) return false;
  const group = records.filter((record) => record.reservationId === [...roots][0]);
  return (
    group.length > 0 &&
    group.every((record) => record.matchId === matchId && record.state === 'REVOKED')
  );
}

function pause(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('OPERATION_CANCELLED'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('OPERATION_CANCELLED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, 25);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let cancel = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error('OPERATION_CANCELLED'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

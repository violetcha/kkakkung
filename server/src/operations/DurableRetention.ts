import { checksum } from './CheckpointStore.js';
import { planDurableRetention, reservationGroup } from './DurableRetentionPlan.js';
import type { OperationJournal } from './OperationJournal.js';
import type { SharedRetryCheckpoint } from './SharedRetryCheckpoint.js';
import type { UsageBudget } from './UsageBudget.js';
import { reservationGroupFor } from './ReservationIntent.js';

type RetryOwner = {
  canPruneConfirmed(roots: ReadonlySet<string>): boolean;
  pruneConfirmed(roots: ReadonlySet<string>, beforeCommit: () => boolean): Promise<void>;
};
type RetentionResult = Readonly<{
  status: 'skipped' | 'compacted';
  roots: number;
  records: number;
  retries: number;
  reservations: number;
}>;
const skipped: RetentionResult = {
  status: 'skipped',
  roots: 0,
  records: 0,
  retries: 0,
  reservations: 0,
};

/** One bounded background pass. Every durable crash prefix remains readable by the strict reader. */
export class DurableRetention {
  private pending: Promise<RetentionResult> | null = null;
  private lastAttempt: number | null = null;
  private closed = false;
  private failed = false;
  private removed = { roots: 0, records: 0, retries: 0, reservations: 0 };

  constructor(
    private readonly options: {
      journal: OperationJournal;
      usageBudget: UsageBudget;
      retryCheckpoint: SharedRetryCheckpoint;
      owners: readonly RetryOwner[];
      now: () => number;
      monotonicNow: () => number;
      /** Start between games; later independent new roots do not invalidate immutable old roots. */
      canStart: () => boolean;
      ownershipConfirmed: () => boolean;
      onFailure: () => void;
    },
  ) {}

  inspect(): Readonly<Record<string, number>> {
    return { ...this.removed, running: this.pending ? 1 : 0, failed: this.failed ? 1 : 0 };
  }

  run(): Promise<RetentionResult> {
    if (this.pending) return this.pending;
    if (this.closed || this.failed || !this.options.canStart()) return Promise.resolve(skipped);
    const monotonic = this.options.monotonicNow();
    if (
      this.lastAttempt !== null &&
      monotonic >= this.lastAttempt &&
      monotonic - this.lastAttempt < 60_000
    )
      return Promise.resolve(skipped);
    this.lastAttempt = monotonic;
    const work = this.compact().catch((error: unknown) => {
      this.failed = true;
      this.options.onFailure();
      throw error;
    });
    this.pending = work;
    void work
      .finally(() => {
        if (this.pending === work) this.pending = null;
      })
      .catch(() => {});
    return work;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pending;
  }

  private async compact(): Promise<RetentionResult> {
    const now = this.options.now();
    const guard = () =>
      this.options.ownershipConfirmed() &&
      this.options.journal.writable &&
      this.options.retryCheckpoint.writable &&
      this.options.usageBudget.readSnapshot().writable &&
      this.options.now() >= now;
    const requireGuard = () => {
      if (!guard()) throw new Error('RETENTION_OWNERSHIP_LOST');
    };
    requireGuard();
    await this.options.journal.flush();
    const retry = await this.options.retryCheckpoint.read();
    requireGuard();
    const usage = this.options.usageBudget.readSnapshot();
    if (retry.integrity === 'corrupt' || usage.integrity !== 'ok')
      throw new Error('RETENTION_HISTORY_UNCONFIRMED');
    const journal = this.options.journal.readSnapshot();
    if (journal.lastSeq === 0) return skipped;
    const plan = new Map(
      planDurableRetention({
        reservations: usage.reservations,
        records: journal.records,
        intents: retry.integrity === 'ok' ? retry.checkpoint.state : [],
        now,
      }),
    );
    for (const root of plan.keys()) {
      if (this.options.owners.some((owner) => !owner.canPruneConfirmed(new Set([root]))))
        plan.delete(root);
    }
    if (plan.size === 0) return skipped;
    const roots = new Set(plan.keys());
    const records = new Set(
      journal.records
        .filter(({ record }) => record.reservationId && roots.has(record.reservationId))
        .map(({ record }) => checksum(record)),
    );
    const groupsUnchanged = () =>
      guard() &&
      [...plan].every(
        ([root, fingerprint]) =>
          checksum(
            reservationGroupFor(
              { reservationId: root },
              this.options.usageBudget.readSnapshot().reservations,
            ),
          ) === fingerprint,
      );
    if (!groupsUnchanged()) throw new Error('RETENTION_USAGE_CHANGED');
    let verifiedGroups = false;
    const compacted = await this.options.journal.compact((record) => {
      // compact evaluates all callbacks synchronously within its journal queue.
      if (!verifiedGroups && !groupsUnchanged()) throw new Error('RETENTION_USAGE_CHANGED');
      verifiedGroups = true;
      if (!record.reservationId || !roots.has(record.reservationId)) return false;
      if (!records.has(checksum(record))) throw new Error('RETENTION_JOURNAL_CHANGED');
      return true;
    });
    requireGuard();
    const journalRemoved = () =>
      guard() &&
      !this.options.journal
        .readSnapshot()
        .records.some(({ record }) => record.reservationId && roots.has(record.reservationId));
    if (!journalRemoved()) throw new Error('RETENTION_JOURNAL_CHANGED');
    for (const owner of this.options.owners) await owner.pruneConfirmed(roots, journalRemoved);
    const removedRetries = await this.options.retryCheckpoint.compactConfirmed(
      roots,
      journalRemoved,
    );
    const retryRemoved = () =>
      journalRemoved() &&
      this.options.retryCheckpoint.snapshot().loaded &&
      !this.options.retryCheckpoint
        .snapshot()
        .intents.some((intent) => roots.has(intent.reservationId));
    const removedReservations = await this.options.usageBudget.compactReleased(
      new Map([...plan].filter(([root]) => reservationGroup(usage.reservations, root).length > 0)),
      now,
      retryRemoved,
    );
    const result = {
      status: 'compacted' as const,
      roots: roots.size,
      records: compacted.removed,
      retries: removedRetries,
      reservations: removedReservations,
    };
    for (const key of ['roots', 'records', 'retries', 'reservations'] as const)
      this.removed[key] += result[key];
    return result;
  }
}

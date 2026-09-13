import { freezeSnapshot } from './ImmutableSnapshot.js';
import type { OfficialBudgetCheckpoint } from '../media/types.js';
import { checksum, safeIdentifier } from './CheckpointStore.js';
import { usageReservationEpoch } from './UsageReservationId.js';
import {
  UsageCheckpoint,
  validateOfficialBudget,
  validateUsageRequest,
} from './UsageCheckpoint.js';
import type {
  BudgetPurpose,
  UsageRequest,
  UsageReservation,
  UsageState,
} from './UsageCheckpoint.js';

export type UsageRejection =
  | 'INVALID_REQUEST'
  | 'ID_CONFLICT'
  | 'BUDGET_UNCONFIRMED'
  | 'BUDGET_STALE'
  | 'MINUTES_EXHAUSTED'
  | 'BYTES_EXHAUSTED'
  | 'BUCKET_EXHAUSTED'
  | 'UNRESOLVED_RETIREMENT'
  | 'ISSUANCE_BLOCKED'
  | 'STORAGE_FAILURE';
export type UsageResult =
  | Readonly<{ status: 'reserved' | 'duplicate'; reservation: UsageReservation }>
  | Readonly<{ status: 'rejected'; code: UsageRejection }>;
const proportions: Record<BudgetPurpose, { minutes: number; bytes: number }> = {
  development: { minutes: 0.2, bytes: 0.2 },
  load: { minutes: 0.24, bytes: 0.2 },
  public: { minutes: 0.4, bytes: 0.4 },
  reserve: { minutes: 0.16, bytes: 0.2 },
};

export class UsageBudget {
  private state: UsageState = { official: null, reservations: [] };
  private immutableState: UsageState | null = null;
  private immutableSnapshot: ReturnType<UsageBudget['snapshot']> | null = null;
  private sequence = 0;
  private integrity: 'ok' | 'missing' | 'corrupt' = 'missing';
  private initializable = false;
  private initializedMissing = false;
  private restored = false;
  private failed = false;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | null = null;

  constructor(
    private readonly options: {
      store: UsageCheckpoint;
      projectAlias: string;
      officialBudgetMaxAgeMs: number;
      providerQuota?: boolean;
      now: () => number;
      canIssue: () => { allowed: boolean; reason?: string };
    },
  ) {
    if (
      !safeIdentifier(options.projectAlias) ||
      (!options.providerQuota &&
        (!Number.isSafeInteger(options.officialBudgetMaxAgeMs) ||
          options.officialBudgetMaxAgeMs <= 0))
    )
      throw new Error('INVALID_USAGE_CONFIGURATION');
  }

  async restore(
    options: { allowInitializeMissing?: boolean } = {},
  ): Promise<ReturnType<UsageBudget['snapshot']>> {
    if (this.closed) return this.snapshot();
    return this.serialize(async () => {
      if (this.restored) return this.snapshot();
      const result = await this.options.store.read();
      this.integrity = result.integrity;
      this.initializable =
        result.integrity === 'missing' && options.allowInitializeMissing === true;
      if (result.integrity === 'ok') {
        this.state = result.checkpoint.state;
        this.sequence = result.checkpoint.lastSeq;
        if (
          this.state.official &&
          this.state.official.checkpoint.projectAlias !== this.options.projectAlias
        )
          this.integrity = 'corrupt';
      }
      this.restored = true;
      // Initialize only after the existing one-use, durable first-install authorization.
      // A missing/corrupt production ledger is never recreated merely because quota mode changed.
      if (this.options.providerQuota && this.initializable && (await this.persist(this.state))) {
        this.integrity = 'ok';
        this.initializable = false;
        this.initializedMissing = true;
      }
      return this.snapshot();
    });
  }

  reserve(input: UsageRequest): Promise<UsageResult> {
    if (this.closed) return Promise.resolve({ status: 'rejected', code: 'STORAGE_FAILURE' });
    let request: UsageRequest;
    try {
      request = validateUsageRequest(input);
    } catch {
      return Promise.resolve({ status: 'rejected', code: 'INVALID_REQUEST' });
    }
    return this.serialize(async () => {
      const existing = this.state.reservations.find(
        (r) => r.request.reservationId === request.reservationId,
      );
      if (existing && checksum(existing.request) !== checksum(request))
        return { status: 'rejected', code: 'ID_CONFLICT' };
      const code = this.blockedCode();
      if (code) return { status: 'rejected', code };
      if (existing)
        return existing.status === 'ACTIVE'
          ? { status: 'duplicate', reservation: structuredClone(existing) }
          : { status: 'rejected', code: 'UNRESOLVED_RETIREMENT' };
      if (this.state.compacted) {
        const issuedAt = usageReservationEpoch(request.reservationId);
        if (this.isRetiredReservation(request.reservationId))
          return { status: 'rejected', code: 'UNRESOLVED_RETIREMENT' };
        if (issuedAt === null || issuedAt > this.options.now())
          return { status: 'rejected', code: 'INVALID_REQUEST' };
      }
      const current = this.snapshot();
      const minutes = Math.ceil(request.slots * request.expectedMinutes * (1 + request.margin));
      const bytes = Math.ceil(request.expectedBytes * (1 + request.margin));
      if (!this.options.providerQuota && minutes > current.availableMinutes)
        return { status: 'rejected', code: 'MINUTES_EXHAUSTED' };
      if (!this.options.providerQuota && bytes > current.availableBytes)
        return { status: 'rejected', code: 'BYTES_EXHAUSTED' };
      const official = this.state.official!;
      const bucket = this.state.reservations.filter(
        (r) => r.status !== 'RELEASED' && r.request.purpose === request.purpose,
      );
      if (
        !this.options.providerQuota &&
        (minutes + bucket.reduce((sum, r) => sum + r.minutes, 0) >
          official.checkpoint.remainingMinutes * proportions[request.purpose].minutes ||
          bytes + bucket.reduce((sum, r) => sum + r.bytes, 0) >
            official.checkpoint.remainingBytes * proportions[request.purpose].bytes)
      )
        return { status: 'rejected', code: 'BUCKET_EXHAUSTED' };
      const reservation: UsageReservation = {
        request,
        minutes,
        bytes,
        status: 'ACTIVE',
        createdAtEpochMs: this.options.now(),
        retiringAtEpochMs: null,
        retiringAfterVersion: null,
        retiringPeriodId: null,
        remoteConfirmedAtEpochMs: null,
        releasedAtEpochMs: null,
      };
      if (
        !(await this.persist({
          ...this.state,
          reservations: [...this.state.reservations, reservation],
        }))
      )
        return { status: 'rejected', code: 'STORAGE_FAILURE' };
      // A readiness/window change during fsync must not release an issue permit.
      // The durable reservation remains conservative until confirmed retirement.
      const afterWriteCode = this.blockedCode();
      if (afterWriteCode) return { status: 'rejected', code: afterWriteCode };
      return { status: 'reserved', reservation: structuredClone(reservation) };
    });
  }

  /** Retained live requests remain valid; an absent legacy/old ID must never be recreated. */
  isRetiredReservation(reservationId: string): boolean {
    if (
      !this.state.compacted ||
      this.state.reservations.some(
        (reservation) => reservation.request.reservationId === reservationId,
      )
    )
      return false;
    const issuedAt = usageReservationEpoch(reservationId);
    return issuedAt === null || issuedAt <= this.state.compacted.retiredThroughEpochMs;
  }

  markRetiring(reservationId: string): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return this.serialize(async () => {
      const reservation = this.state.reservations.find(
        (r) => r.request.reservationId === reservationId,
      );
      if (!reservation || (!this.options.providerQuota && !this.state.official)) return false;
      if (reservation.status !== 'ACTIVE') return true;
      const replacement: UsageReservation = {
        ...reservation,
        status: 'RETIRING',
        retiringAtEpochMs: this.options.now(),
        retiringAfterVersion: this.state.official?.version ?? this.sequence,
        retiringPeriodId: this.state.official?.periodId ?? 'provider-quota',
      };
      return this.persist({
        ...this.state,
        reservations: this.state.reservations.map((r) => (r === reservation ? replacement : r)),
      });
    });
  }

  reconcileOfficial(
    input: OfficialBudgetCheckpoint,
    revision: { periodId: string; version: number },
    context: { beforeCommit?: () => boolean } = {},
  ): Promise<{ status: 'applied' | 'duplicate' | 'rejected'; code?: string }> {
    if (this.options.providerQuota)
      return Promise.resolve({ status: 'rejected', code: 'PROVIDER_QUOTA_POLICY' });
    if (this.closed) return Promise.resolve({ status: 'rejected', code: 'STORAGE_FAILURE' });
    revision = { periodId: revision.periodId, version: revision.version };
    let checkpoint: OfficialBudgetCheckpoint;
    try {
      checkpoint = validateOfficialBudget(input, {
        projectAlias: this.options.projectAlias,
        nowEpochMs: this.options.now(),
        maxAgeMs: this.options.officialBudgetMaxAgeMs,
      });
      if (
        !safeIdentifier(revision.periodId) ||
        !Number.isSafeInteger(revision.version) ||
        revision.version < 1
      )
        throw new Error('INVALID_REVISION');
    } catch {
      return Promise.resolve({ status: 'rejected', code: 'INVALID_OFFICIAL_CHECKPOINT' });
    }
    return this.serialize(async () => {
      if (context.beforeCommit?.() === false)
        return { status: 'rejected', code: 'OPERATION_CANCELLED' };
      // The operation may have waited behind a slow reservation/checkpoint write.
      try {
        validateOfficialBudget(checkpoint, {
          projectAlias: this.options.projectAlias,
          nowEpochMs: this.options.now(),
          maxAgeMs: this.options.officialBudgetMaxAgeMs,
        });
      } catch {
        return { status: 'rejected', code: 'INVALID_OFFICIAL_CHECKPOINT' };
      }
      if (
        !this.restored ||
        this.integrity === 'corrupt' ||
        (this.integrity === 'missing' && !this.initializable)
      )
        return { status: 'rejected', code: 'USAGE_HISTORY_MISSING' };
      const previous = this.state.official;
      if (previous?.periodId === revision.periodId && previous.version === revision.version)
        return checksum(previous.checkpoint) === checksum(checkpoint)
          ? { status: 'duplicate' }
          : { status: 'rejected', code: 'REVISION_CONFLICT' };
      if (
        previous &&
        (checkpoint.checkedAtEpochMs <= previous.checkpoint.checkedAtEpochMs ||
          (previous.periodId === revision.periodId && revision.version <= previous.version))
      )
        return { status: 'rejected', code: 'STALE_REVISION' };
      const state = { ...this.state, official: { checkpoint, ...revision } };
      if (!(await this.persist(state))) return { status: 'rejected', code: 'STORAGE_FAILURE' };
      this.integrity = 'ok';
      this.initializable = false;
      return { status: 'applied' };
    });
  }

  markRemoteConfirmed(reservationId: string): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return this.serialize(async () => {
      const reservation = this.state.reservations.find(
        (r) => r.request.reservationId === reservationId,
      );
      if (!reservation || reservation.status === 'ACTIVE') return false;
      if (
        reservation.status === 'RELEASED' ||
        (reservation.status === 'AWAITING_OFFICIAL' && !this.options.providerQuota)
      )
        return true;
      const replacement: UsageReservation = {
        ...reservation,
        status: this.options.providerQuota ? 'RELEASED' : 'AWAITING_OFFICIAL',
        remoteConfirmedAtEpochMs: reservation.remoteConfirmedAtEpochMs ?? this.options.now(),
        releasedAtEpochMs: this.options.providerQuota ? this.options.now() : null,
      };
      return this.persist({
        ...this.state,
        reservations: this.state.reservations.map((r) => (r === reservation ? replacement : r)),
      });
    });
  }

  releaseConfirmed(
    reservationId: string,
    proof: { remoteConfirmed: true; periodId: string; version: number },
    context: { beforeCommit?: () => boolean } = {},
  ): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    proof = {
      remoteConfirmed: proof.remoteConfirmed,
      periodId: proof.periodId,
      version: proof.version,
    };
    return this.serialize(async () => {
      if (context.beforeCommit?.() === false) return false;
      const reservation = this.state.reservations.find(
        (r) => r.request.reservationId === reservationId,
      );
      const official = this.state.official;
      if (official) {
        try {
          validateOfficialBudget(official.checkpoint, {
            projectAlias: this.options.projectAlias,
            nowEpochMs: this.options.now(),
            maxAgeMs: this.options.officialBudgetMaxAgeMs,
          });
        } catch {
          return false;
        }
      }
      if (
        !reservation ||
        !official ||
        proof.remoteConfirmed !== true ||
        proof.periodId !== official.periodId ||
        proof.version !== official.version
      )
        return false;
      if (reservation.status === 'RELEASED') return true;
      if (
        reservation.status !== 'AWAITING_OFFICIAL' ||
        reservation.retiringAtEpochMs === null ||
        reservation.remoteConfirmedAtEpochMs === null ||
        official.checkpoint.checkedAtEpochMs < reservation.retiringAtEpochMs ||
        official.checkpoint.checkedAtEpochMs < reservation.remoteConfirmedAtEpochMs ||
        (reservation.retiringPeriodId === official.periodId &&
          official.version <= reservation.retiringAfterVersion!)
      )
        return false;
      const replacement: UsageReservation = {
        ...reservation,
        status: 'RELEASED',
        releasedAtEpochMs: this.options.now(),
      };
      return this.persist({
        ...this.state,
        reservations: this.state.reservations.map((r) => (r === reservation ? replacement : r)),
      });
    });
  }

  /** Only immutable accounting data is reused; writable/integrity remain live. */
  readSnapshot(): ReturnType<UsageBudget['snapshot']> {
    if (this.immutableState !== this.state || !this.immutableSnapshot) {
      this.immutableSnapshot = freezeSnapshot(this.snapshot());
      this.immutableState = this.state;
    }
    return Object.freeze({
      ...this.immutableSnapshot,
      integrity: this.integrity,
      writable: !this.closed && !this.failed && this.options.store.writable,
    });
  }

  snapshot() {
    const active = this.state.reservations.filter((r) => r.status !== 'RELEASED');
    const activeMinutes = active.reduce((sum, r) => sum + r.minutes, 0);
    const activeBytes = active.reduce((sum, r) => sum + r.bytes, 0);
    return structuredClone({
      integrity: this.integrity,
      writable: !this.closed && !this.failed && this.options.store.writable,
      official: this.state.official,
      ...(this.options.providerQuota
        ? { budgetPolicy: 'provider-quota' as const, initializedMissing: this.initializedMissing }
        : {}),
      reservations: this.state.reservations,
      ...(this.state.compacted ? { compacted: this.state.compacted } : {}),
      activeMinutes,
      activeBytes,
      availableMinutes: Math.max(
        0,
        (this.state.official?.checkpoint.remainingMinutes ?? 0) - activeMinutes,
      ),
      availableBytes: Math.max(
        0,
        (this.state.official?.checkpoint.remainingBytes ?? 0) - activeBytes,
      ),
      localEstimatedMinutes: this.state.reservations.reduce(
        (sum, r) => sum + r.minutes,
        this.state.compacted?.minutes ?? 0,
      ),
      localEstimatedBytes: this.state.reservations.reduce(
        (sum, r) => sum + r.bytes,
        this.state.compacted?.bytes ?? 0,
      ),
    });
  }

  /** Stop accepting work synchronously and drain usage persistence before releasing its writer. */
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.closing = this.queue.then(() => this.options.store.close());
    }
    return this.closing;
  }

  private blockedCode(): UsageRejection | null {
    if (this.closed || this.failed || !this.options.store.writable) return 'STORAGE_FAILURE';
    if (this.state.compacted && this.options.now() < this.state.compacted.compactedAtEpochMs)
      return 'BUDGET_STALE';
    if (
      !this.restored ||
      this.integrity !== 'ok' ||
      (!this.options.providerQuota && !this.state.official)
    )
      return 'BUDGET_UNCONFIRMED';
    if (
      !this.options.providerQuota &&
      (this.options.now() - this.state.official!.checkpoint.checkedAtEpochMs >
        this.options.officialBudgetMaxAgeMs ||
        this.options.now() < this.state.official!.checkpoint.checkedAtEpochMs)
    )
      return 'BUDGET_STALE';
    if (this.state.reservations.some((r) => r.status === 'RETIRING'))
      return 'UNRESOLVED_RETIREMENT';
    if (!this.options.canIssue().allowed) return 'ISSUANCE_BLOCKED';
    return null;
  }
  private async persist(state: UsageState): Promise<boolean> {
    try {
      if (this.failed || !this.options.store.writable) return false;
      await this.options.store.write({ lastSeq: this.sequence + 1, state });
      this.sequence++;
      this.state = state;
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}

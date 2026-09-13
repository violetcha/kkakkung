import { randomUUID } from 'node:crypto';
import type { CapabilityReport } from '../media/CloudCapabilityProbe.js';
import { GatewayError, type LiveKitGateway } from '../media/LiveKitGateway.js';
import type { Generation } from '../media/MediaGenerationRegistry.js';
import { RetirementBarrier } from '../media/RetirementBarrier.js';
import { areRevokedMediaTargetsAbsent } from '../media/RevokedMediaAbsence.js';
import type { OfficialBudgetCheckpoint, RetireGenerationRequest } from '../media/types.js';
import {
  checksum,
  safeIdentifier,
  strictObject,
  type Checkpoint,
  type CheckpointStore,
} from './CheckpointStore.js';
import {
  validateJournalRecord,
  type JournalEntry,
  type OperationJournal,
} from './OperationJournal.js';
import {
  RevocationRetries,
  validateRetryIntent,
  type RetryIntent,
  type RevocationRetryOptions,
} from './RevocationRetries.js';
import type { UsageBudget } from './UsageBudget.js';
import { ownedMediaTargets, sameMediaOwnership } from './SplitMediaOwnership.js';

export function validateRetryCheckpoint(value: unknown): readonly RetryIntent[] {
  if (!Array.isArray(value)) throw new Error('INVALID_RETRY_CHECKPOINT');
  const intents = value.map(validateRetryIntent);
  if (new Set(intents.map((intent) => intent.retirementId)).size !== intents.length)
    throw new Error('DUPLICATE_RETRY_INTENT');
  return intents;
}

export type RevocationRetryBindingsOptions = Readonly<{
  namespace: string;
  journal: OperationJournal;
  checkpoint: CheckpointStore<readonly RetryIntent[]>;
  /** The owner must validate journal/checkpoint recovery before starting these bindings (E-12). */
  initialCheckpoint: Checkpoint<readonly RetryIntent[]>;
  /** Validated journal replay supplied by the recovery owner, never inferred from a generation flag. */
  initialJournalRecords?: readonly JournalEntry[];
  usageBudget: UsageBudget;
  gateway: LiveKitGateway;
  generations: () => readonly Generation[];
  capability: () => CapabilityReport | null;
  monotonicNow: () => number;
  epochNowMs: () => number;
  stopPermissions: (generation: Generation) => void;
  awaitPendingPermissions?: (generation: Generation) => Promise<void>;
  onOccupancyEnded: (generation: Generation) => Promise<void>;
  lockIssuance: (reason: 'RETIREMENT_UNRESOLVED' | 'JOURNAL_WRITE_FAILED') => void;
  onUnresolved: (intent: RetryIntent) => void;
  setTimer?: RevocationRetryOptions['setTimer'];
  clearTimer?: RevocationRetryOptions['clearTimer'];
}>;

/** E-11 wiring only. The caller owns bootstrap, verified capability and the shared API budget. */
export class RevocationRetryBindings {
  readonly retries: RevocationRetries;
  private readonly retirement: RetirementBarrier;
  private readonly intents = new Map<string, RetryIntent>();
  private readonly retirementIds = new WeakMap<Generation, string>();
  private readonly failures = new WeakMap<Generation, unknown>();
  private readonly durableRevoked = new WeakSet<Generation>();
  private readonly ended = new WeakSet<Generation>();
  private readonly finalizing = new WeakMap<Generation, Promise<void>>();
  private sequence: number;
  private writes: Promise<void> = Promise.resolve();
  private failed = false;
  private closed = false;
  private readonly dispatchGuards = new WeakMap<Generation, () => void>();
  private readonly activeRetirements = new Set<ReturnType<RetirementBarrier['retire']>>();

  constructor(private readonly options: RevocationRetryBindingsOptions) {
    strictObject(options.initialCheckpoint, ['lastSeq', 'state']);
    if (
      !safeIdentifier(options.namespace) ||
      !Number.isSafeInteger(options.initialCheckpoint.lastSeq) ||
      options.initialCheckpoint.lastSeq < 0
    )
      throw new Error('INVALID_RETRY_CONFIGURATION');
    this.sequence = options.initialCheckpoint.lastSeq;
    const records = this.restoreEvidence(options.initialJournalRecords ?? []);
    for (const intent of validateRetryCheckpoint(options.initialCheckpoint.state)) {
      const generation = this.findIntent(intent);
      if (!generation || !generation.terminal) throw new Error('RETRY_GENERATION_MISSING');
      const record = records.get(generation);
      if (!record || (intent.status === 'REVOKED' && record.state !== 'REVOKED'))
        throw new Error('RETRY_JOURNAL_MISMATCH');
      if (this.retirementIds.has(generation)) throw new Error('DUPLICATE_RETRY_GENERATION');
      this.intents.set(intent.retirementId, intent);
      this.retirementIds.set(generation, intent.retirementId);
    }
    this.retirement = new RetirementBarrier({
      find: (input) => this.findRequest(input),
      capability: options.capability,
      nowEpochSeconds: () => options.epochNowMs() / 1000,
      persist: (generation) => this.persistGeneration(generation),
      stopPermissions: options.stopPermissions,
      awaitPendingPermissions: options.awaitPendingPermissions,
      remove: async (generation, cutoff) => {
        for (const member of ownedMediaTargets(generation))
          await options.gateway.removeParticipant(
            member.roomName,
            member.identity,
            cutoff === undefined ? undefined : { revokeTokenTs: cutoff },
            this.context(generation),
          );
      },
      absent: (generation) =>
        areRevokedMediaTargetsAbsent(ownedMediaTargets(generation), options.gateway, () =>
          this.context(generation),
        ),
      onFailure: (generation, error) => this.failures.set(generation, error),
      onUnresolved: () => options.lockIssuance('RETIREMENT_UNRESOLVED'),
      onConfirmed: (generation) => this.confirmOccupancy(generation),
    });
    this.retries = new RevocationRetries({
      monotonicNow: options.monotonicNow,
      epochNowMs: options.epochNowMs,
      setTimer: options.setTimer,
      clearTimer: options.clearTimer,
      isTerminal: (intent) => this.findIntent(intent)?.terminal === true,
      persist: (intent) => this.persistIntent(intent),
      send: async (intent, dispatch) => {
        const generation = this.findIntent(intent);
        if (!generation?.terminal || this.failed) throw new Error('RETRY_GENERATION_MISSING');
        if (this.durableRevoked.has(generation)) return { status: 'confirmed' };
        this.dispatchGuards.set(generation, dispatch.beforeDispatch);
        this.failures.delete(generation);
        const result = await this.retirement.retire(
          {
            requestId: randomUUID(),
            matchId: generation.request.matchId,
            mediaInstanceId: generation.request.mediaInstanceId,
            playerId: generation.request.playerId,
            receiverGeneration: generation.generation,
            reason: 'shutdown',
          },
          true,
        );
        if (result.status === 'confirmed') return { status: 'confirmed' };
        const failure = this.failures.get(generation);
        return failure instanceof GatewayError && failure.status === 429
          ? failure.retryAfterMs === undefined
            ? { status: 'blocked' }
            : { status: 'retry', retryAfterMs: failure.retryAfterMs }
          : { status: 'retry' };
      },
      onConfirmed: async (intent) => {
        const generation = this.findIntent(intent);
        if (!generation) throw new Error('RETRY_GENERATION_MISSING');
        await this.confirmOccupancy(generation);
      },
      onUnresolved: (intent) => {
        options.lockIssuance('RETIREMENT_UNRESOLVED');
        options.onUnresolved(intent);
      },
      onPersistenceFailure: () => this.failStorage(),
    });
  }

  /** E-12 calls this only after validating recovery; construction never starts restored timers. */
  restoreRetries(): Promise<void> {
    return this.retries.restore([...this.intents.values()]);
  }

  pruneRequestHistory(): void {
    this.retirement.prune();
  }

  canPruneConfirmed(roots: ReadonlySet<string>): boolean {
    return (
      !this.closed &&
      !this.failed &&
      this.retries.canPruneConfirmed(roots) &&
      [...this.intents.values()].every(
        (intent) => !roots.has(intent.reservationId) || intent.status === 'REVOKED',
      )
    );
  }

  pruneConfirmed(roots: ReadonlySet<string>, beforeCommit: () => boolean): Promise<void> {
    const captured = new Set(roots);
    return this.serialize(async () => {
      if (!beforeCommit() || !this.canPruneConfirmed(captured))
        throw new Error('RETENTION_RETRY_BUSY');
      this.retries.pruneConfirmed(captured);
      for (const [id, intent] of this.intents) {
        if (captured.has(intent.reservationId)) this.intents.delete(id);
      }
    });
  }
  /** Retry checkpoints are shared with recovery; they require separate durable compaction.
   * Never orphan an intent or an unreconciled reservation by dropping its Generation. */
  canForgetGeneration(generation: Generation): boolean {
    if (
      this.closed ||
      this.failed ||
      this.finalizing.has(generation) ||
      !this.durableRevoked.has(generation) ||
      !this.ended.has(generation) ||
      this.retirementIds.has(generation)
    )
      return false;
    try {
      return this.reservations(generation.reservationId).every((r) => r.status === 'RELEASED');
    } catch {
      return false;
    }
  }

  retire(input: RetireGenerationRequest): ReturnType<RetirementBarrier['retire']> {
    if (this.closed) return Promise.reject(new Error('RETRY_BINDINGS_CLOSED'));
    if (this.failed) return Promise.reject(new Error('RETRY_STORAGE_FAILED'));
    const work = this.runRetirement({ ...input });
    this.activeRetirements.add(work);
    void work.finally(() => this.activeRetirements.delete(work)).catch(() => {});
    return work;
  }

  private async runRetirement(input: RetireGenerationRequest) {
    const firstRetireEpochMs = this.options.epochNowMs();
    const result = await this.retirement.retire(input);
    const generation = this.findRequest(input);
    if (
      this.closed ||
      result.code === 'STALE_GENERATION' ||
      !generation ||
      result.status === 'confirmed'
    )
      return result;
    const failure = this.failures.get(generation);
    const retirementId = this.retirementIds.get(generation) ?? input.requestId;
    this.retirementIds.set(generation, retirementId);
    await this.retries.begin({
      retirementId,
      reservationId: generation.reservationId,
      identity: generation.identity,
      generation: generation.generation,
      firstRetireEpochMs,
      ...(failure instanceof GatewayError && failure.status === 429
        ? failure.retryAfterMs === undefined
          ? { providerWaitUnknown: true }
          : { retryAfterMs: failure.retryAfterMs }
        : {}),
    });
    return result;
  }

  async reconcileOfficial(
    input: OfficialBudgetCheckpoint,
    revision: { periodId: string; version: number },
  ) {
    if (this.closed) throw new Error('RETRY_BINDINGS_CLOSED');
    if (this.failed) throw new Error('RETRY_STORAGE_FAILED');
    const result = await this.options.usageBudget.reconcileOfficial(input, revision);
    if (result.status === 'rejected') return result;
    const roots = new Set(this.options.generations().map((generation) => generation.reservationId));
    for (const root of roots) {
      if (!this.allRevoked(root)) continue;
      for (const reservation of this.reservations(root)) {
        if (reservation.status === 'AWAITING_OFFICIAL') {
          const released = await this.options.usageBudget.releaseConfirmed(
            reservation.request.reservationId,
            {
              remoteConfirmed: true,
              ...revision,
            },
          );
          if (!released) {
            this.options.lockIssuance('RETIREMENT_UNRESOLVED');
            throw new Error('RESERVATION_RELEASE_UNCONFIRMED');
          }
        }
      }
    }
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    const results = await Promise.allSettled([this.retries.close(), ...this.activeRetirements]);
    await this.writes;
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }

  private context(generation: Generation) {
    const { identity, reservationId, generation: number } = generation;
    return {
      requestId: randomUUID(),
      deadlineMs: this.options.monotonicNow() + 1000,
      priority: 'cleanup' as const,
      beforeDispatch: () => {
        this.dispatchGuards.get(generation)?.();
        return (
          !this.closed &&
          !this.failed &&
          generation.terminal &&
          generation.identity === identity &&
          generation.reservationId === reservationId &&
          generation.generation === number &&
          this.options.generations().includes(generation)
        );
      },
    };
  }

  private findRequest(input: RetireGenerationRequest): Generation | undefined {
    return this.options
      .generations()
      .find(
        (generation) =>
          generation.request.matchId === input.matchId &&
          generation.request.mediaInstanceId === input.mediaInstanceId &&
          generation.request.playerId === input.playerId &&
          generation.generation === input.receiverGeneration,
      );
  }

  private findIntent(intent: RetryIntent): Generation | undefined {
    return this.options
      .generations()
      .find(
        (generation) =>
          generation.identity === intent.identity &&
          generation.generation === intent.generation &&
          generation.reservationId === intent.reservationId,
      );
  }

  private record(generation: Generation) {
    return {
      state: generation.state,
      namespace: this.options.namespace,
      matchId: generation.request.matchId,
      mediaInstanceId: generation.request.mediaInstanceId,
      roomName: generation.roomName,
      serverEpoch: generation.serverEpoch,
      identity: generation.identity,
      generation: generation.generation,
      issuedAtEpochMs: generation.issuedAtEpochMs,
      expiresAtEpochMs: generation.expiresAtEpochMs,
      ...(generation.splitOwnership ? { splitOwnership: generation.splitOwnership } : {}),
      reservationId: generation.reservationId,
      atEpochMs: this.options.epochNowMs(),
    };
  }

  private persistGeneration(generation: Generation): Promise<void> {
    const record = this.record(generation);
    return this.serialize(async () => {
      // Local finalization/notification failures cannot erase already durable remote proof.
      if (this.durableRevoked.has(generation)) record.state = 'REVOKED';
      await this.options.journal.append(record);
      if (record.state === 'REVOKED') this.durableRevoked.add(generation);
      else this.durableRevoked.delete(generation);
    });
  }

  private persistIntent(intent: RetryIntent): Promise<void> {
    return this.serialize(async () => {
      const generation = this.findIntent(intent);
      if (!generation?.terminal) throw new Error('RETRY_GENERATION_MISSING');
      const revoked = this.durableRevoked.has(generation);
      if (intent.status === 'REVOKED' && !revoked) throw new Error('REVOCATION_NOT_DURABLE');
      // A timer's late UNRESOLVED intent must never overwrite an acknowledged durable REVOKED.
      const appended = await this.options.journal.append({
        ...this.record(generation),
        state: revoked ? 'REVOKED' : intent.status,
        retirementId: intent.retirementId,
        attempt: intent.attempt,
        firstRetireAtEpochMs: intent.firstRetireEpochMs,
      });
      const next = new Map(this.intents);
      next.set(intent.retirementId, intent);
      await this.options.checkpoint.write({
        lastSeq: appended.seq,
        state: [...next.values()],
      });
      this.sequence = appended.seq;
      this.intents.set(intent.retirementId, intent);
    });
  }

  private reservations(root: string) {
    const snapshot = this.options.usageBudget.snapshot();
    if (snapshot.integrity !== 'ok' || !snapshot.writable)
      throw new Error('USAGE_HISTORY_UNCONFIRMED');
    const reservations = snapshot.reservations.filter((reservation) => {
      const id = reservation.request.reservationId;
      return id === root || (id.startsWith(`${root}:`) && /^\d+$/.test(id.slice(root.length + 1)));
    });
    const generations = this.options
      .generations()
      .filter((generation) => generation.reservationId === root);
    if (
      !reservations.some((reservation) => reservation.request.reservationId === root) ||
      !generations.length ||
      reservations.some((reservation) =>
        generations.some(
          (generation) => generation.request.matchId !== reservation.request.matchId,
        ),
      )
    )
      throw new Error('RESERVATION_SCOPE_MISMATCH');
    return reservations;
  }

  private allRevoked(root: string): boolean {
    const group = this.options
      .generations()
      .filter((generation) => generation.reservationId === root);
    return (
      group.length > 0 &&
      group.every((generation) => generation.terminal && this.durableRevoked.has(generation))
    );
  }

  private confirmOccupancy(generation: Generation): Promise<void> {
    const existing = this.finalizing.get(generation);
    if (existing) return existing;
    const work = (async () => {
      if (!this.durableRevoked.has(generation)) throw new Error('REVOCATION_NOT_DURABLE');
      if (!this.ended.has(generation)) {
        await this.options.onOccupancyEnded(generation);
        this.ended.add(generation);
      }
      if (!this.allRevoked(generation.reservationId)) return;
      for (const reservation of this.reservations(generation.reservationId)) {
        const id = reservation.request.reservationId;
        if (
          !(await this.options.usageBudget.markRetiring(id)) ||
          !(await this.options.usageBudget.markRemoteConfirmed(id))
        )
          throw new Error('RESERVATION_WRITE_FAILED');
      }
    })();
    this.finalizing.set(generation, work);
    void work.finally(() => this.finalizing.delete(generation)).catch(() => {});
    return work;
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    const result = this.writes.then(async () => {
      if (this.failed) throw new Error('RETRY_STORAGE_FAILED');
      try {
        await work();
      } catch (error) {
        this.failStorage();
        throw error;
      }
    });
    this.writes = result.catch(() => {});
    return result;
  }

  private failStorage(): void {
    this.failed = true;
    this.options.lockIssuance('JOURNAL_WRITE_FAILED');
  }

  private restoreEvidence(entries: readonly JournalEntry[]) {
    const records = new Map<Generation, JournalEntry['record']>();
    let sequence = 0;
    for (const entry of entries) {
      strictObject(entry, ['version', 'seq', 'record', 'checksum']);
      const record = validateJournalRecord(entry.record);
      if (
        entry.version !== 1 ||
        !Number.isSafeInteger(entry.seq) ||
        entry.seq <= sequence ||
        entry.checksum !== checksum({ version: 1, seq: entry.seq, record }) ||
        record.namespace !== this.options.namespace
      )
        throw new Error('INVALID_RETRY_JOURNAL_EVIDENCE');
      sequence = entry.seq;
      const generation = this.options
        .generations()
        .find(
          (value) =>
            value.identity === record.identity &&
            value.generation === record.generation &&
            value.reservationId === record.reservationId &&
            value.roomName === record.roomName &&
            value.serverEpoch === record.serverEpoch &&
            value.request.matchId === record.matchId &&
            value.request.mediaInstanceId === record.mediaInstanceId &&
            value.issuedAtEpochMs === record.issuedAtEpochMs &&
            value.expiresAtEpochMs === record.expiresAtEpochMs &&
            sameMediaOwnership(value, record),
        );
      if (generation) records.set(generation, record);
    }
    if (this.sequence > sequence) throw new Error('RETRY_CHECKPOINT_AHEAD_OF_JOURNAL');
    for (const [generation, record] of records) {
      if (record.state === 'REVOKED' && generation.terminal) this.durableRevoked.add(generation);
    }
    return records;
  }
}

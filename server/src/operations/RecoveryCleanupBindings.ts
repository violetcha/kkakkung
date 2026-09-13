import { randomUUID } from 'node:crypto';
import type { CapabilityReport } from '../media/CloudCapabilityProbe.js';
import {
  GatewayError,
  type GatewayCallContext,
  type LiveKitGateway,
} from '../media/LiveKitGateway.js';
import { confirmRemoteRevocation } from '../media/RemoteRevocation.js';
import { checksum, safeIdentifier, strictObject, type CheckpointStore } from './CheckpointStore.js';
import {
  validateJournalRecord,
  type JournalEntry,
  type JournalRecord,
  type OperationJournal,
} from './OperationJournal.js';
import {
  ownsMediaRoom,
  PreviousGenerationCleanup,
  type CleanupCallContext,
  type CleanupTarget,
} from './PreviousGenerationCleanup.js';
import type { RecoveryCleanupInput } from './RecoveryBootstrap.js';
import type { CleanupReport } from './RecoveryState.js';
import {
  RevocationRetries,
  validateRetryIntent,
  type RetryIntent,
  type RevocationRetryOptions,
} from './RevocationRetries.js';
import type { UsageBudget } from './UsageBudget.js';

export type CleanupCheckpointState = Readonly<{
  namespace: string;
  historyComplete: boolean;
  observedTargets: readonly Readonly<{ roomName: string; identity: string }>[];
  report: CleanupReport | null;
}>;

export function validateCleanupCheckpoint(value: unknown): CleanupCheckpointState {
  const data = strictObject(value, ['namespace', 'historyComplete', 'observedTargets', 'report']);
  if (
    typeof data.namespace !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(data.namespace) ||
    data.namespace.includes('--') ||
    typeof data.historyComplete !== 'boolean' ||
    !Array.isArray(data.observedTargets)
  )
    throw new Error('INVALID_CLEANUP_CHECKPOINT');
  const namespace = data.namespace;
  const observedTargets = data.observedTargets.map((value) => {
    const target = strictObject(value, ['roomName', 'identity']);
    if (
      typeof target.roomName !== 'string' ||
      !ownsMediaRoom(namespace, target.roomName) ||
      !safeIdentifier(target.identity)
    )
      throw new Error('INVALID_CLEANUP_CHECKPOINT');
    return { roomName: target.roomName, identity: target.identity };
  });
  if (
    new Set(observedTargets.map(targetKey)).size !== observedTargets.length ||
    (observedTargets.length > 0 && data.historyComplete)
  )
    throw new Error('INVALID_CLEANUP_CHECKPOINT');
  let report: CleanupReport | null = null;
  if (data.report !== null) {
    const raw = strictObject(data.report, [
      'recordedIdentities',
      'observedParticipants',
      'revoked',
      'unresolved',
      'ownedRoomsRemaining',
      'historyComplete',
    ]);
    if (
      typeof raw.historyComplete !== 'boolean' ||
      Object.entries(raw).some(
        ([key, count]) =>
          key !== 'historyComplete' && (!Number.isSafeInteger(count) || (count as number) < 0),
      ) ||
      !Number.isSafeInteger((raw.unresolved as number) + (raw.ownedRoomsRemaining as number)) ||
      (raw.historyComplete && !data.historyComplete)
    )
      throw new Error('INVALID_CLEANUP_CHECKPOINT');
    report = raw as unknown as CleanupReport;
  }
  return structuredClone({
    namespace,
    historyComplete: data.historyComplete,
    observedTargets,
    report,
  });
}

export type RecoveryCleanupBindingsOptions = Readonly<{
  namespace: string;
  projectAlias: string;
  /** F's explicit project/namespace ownership evidence. A matching name is not ownership proof. */
  namespaceOwnershipConfirmed: () => boolean;
  journal: OperationJournal;
  retryCheckpoint: CheckpointStore<readonly RetryIntent[]>;
  cleanupCheckpoint: CheckpointStore<CleanupCheckpointState>;
  usageBudget: UsageBudget;
  gateway: LiveKitGateway;
  capability: () => CapabilityReport | null;
  epochNowMs: () => number;
  monotonicNow: () => number;
  onUnresolved: (
    code: 'RECOVERY_UNCONFIRMED' | 'RETIREMENT_UNRESOLVED' | 'JOURNAL_WRITE_FAILED',
  ) => void;
  /** Connect to recovery state; a later retry still needs a complete room sweep before success. */
  onReport?: (report: CleanupReport) => void;
  setTimer?: RevocationRetryOptions['setTimer'];
  clearTimer?: RevocationRetryOptions['clearTimer'];
}>;

function targetKey(target: { roomName: string; identity: string }): string {
  return JSON.stringify([target.roomName, target.identity]);
}
function recordKey(record: JournalRecord): string {
  return JSON.stringify([record.namespace, record.roomName, record.identity, record.generation]);
}
const failedReport = (): CleanupReport => ({
  recordedIdentities: 0,
  observedParticipants: 0,
  revoked: 0,
  unresolved: 1,
  ownedRoomsRemaining: 0,
  historyComplete: false,
});

// Historical-room enumeration may cross the shared 60-second API window.
// This bounds queue waiting only; transport timeouts and revocation deadlines remain separate.
const SWEEP_QUEUE_WAIT_MS = 65_000;
const REVOCATION_QUEUE_WAIT_MS = 1_000;

/** E-13 composition. No Generation/player metadata is fabricated from persisted journal entries. */
export class RecoveryCleanupBindings {
  private readonly cleanup: PreviousGenerationCleanup;
  readonly retries: RevocationRetries;
  private readonly records = new Map<string, JournalEntry>();
  private readonly intents = new Map<string, RetryIntent>();
  private readonly intentRecords = new Map<string, string>();
  private readonly observed = new Map<string, { roomName: string; identity: string }>();
  private readonly abort = new AbortController();
  private input: RecoveryCleanupInput | null = null;
  private signal: AbortSignal = this.abort.signal;
  private initialization: Promise<void> | null = null;
  private activeSweep: Promise<CleanupReport> | null = null;
  private closing: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private sequence = 0;
  private historyComplete = false;
  private closed = false;
  private failed = false;
  private lastReport: CleanupReport | null = null;
  private retrySweepQueued = false;

  constructor(private readonly options: RecoveryCleanupBindingsOptions) {
    if (
      !safeIdentifier(options.projectAlias) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(options.namespace) ||
      options.namespace.includes('--')
    )
      throw new Error('INVALID_CLEANUP_CONFIGURATION');
    this.cleanup = new PreviousGenerationCleanup({
      namespace: options.namespace,
      listRooms: (context) =>
        this.cancellable(() =>
          options.gateway.listRooms(undefined, this.context(context, SWEEP_QUEUE_WAIT_MS)),
        ),
      listParticipants: (room, context) => this.participants(room, context),
      revoke: (target, context) => this.revoke(target, context),
      deleteRoom: (room, context) => this.deleteRoom(room, context),
      checkpoint: (report, context) => this.persistReport(report, context),
      onUnresolved: () => this.notify('RECOVERY_UNCONFIRMED'),
    });
    this.retries = new RevocationRetries({
      monotonicNow: options.monotonicNow,
      epochNowMs: options.epochNowMs,
      setTimer: options.setTimer,
      clearTimer: options.clearTimer,
      isTerminal: (intent) => this.findRecord(intent) !== undefined,
      persist: (intent) => this.persistIntent(intent),
      send: async (intent, dispatch) => {
        try {
          const record = this.findRecord(intent);
          if (!record) throw new Error('RECOVERY_RECORD_MISSING');
          await this.remote(
            { roomName: record.roomName, identity: record.identity, record },
            {
              signal: this.signal,
              beforeDispatch: () => {
                dispatch.beforeDispatch();
                return this.canDispatch();
              },
            },
          );
          return { status: 'confirmed' };
        } catch (error) {
          return error instanceof GatewayError && error.status === 429
            ? error.retryAfterMs === undefined
              ? { status: 'blocked' }
              : { status: 'retry', retryAfterMs: error.retryAfterMs }
            : { status: 'retry' };
        }
      },
      onConfirmed: async (intent) => {
        if (this.closed) return;
        if (!this.findRecord(intent)) throw new Error('RECOVERY_RECORD_MISSING');
        this.queueRetrySweep();
      },
      onUnresolved: () => this.notify('RETIREMENT_UNRESOLVED'),
      onPersistenceFailure: () => this.failStorage(),
    });
  }

  /** Pass directly to RecoveryBootstrap.beginCleanup; repeated calls never restore old state again. */
  run(input: RecoveryCleanupInput): Promise<CleanupReport> {
    if (this.closed) return Promise.resolve(failedReport());
    if (this.input && this.input.serverEpoch !== input.serverEpoch)
      return Promise.reject(new Error('RECOVERY_EPOCH_CONFLICT'));
    if (!this.input) {
      this.input = {
        ...input,
        records: structuredClone(input.records),
        retryIntents: structuredClone(input.retryIntents),
      };
      this.signal = AbortSignal.any([this.abort.signal, input.signal]);
      this.initialization = this.initialize(this.input);
    }
    return this.reconcile();
  }

  /** A retry ACK alone is insufficient: rerun delete and final room/participant observations. */
  reconcile(): Promise<CleanupReport> {
    if (this.activeSweep) return this.activeSweep;
    const work = this.sweep();
    this.activeSweep = work;
    void work
      .finally(() => {
        if (this.activeSweep === work) this.activeSweep = null;
      })
      .catch(() => {});
    return work;
  }

  snapshot(): CleanupReport | null {
    return this.lastReport ? structuredClone(this.lastReport) : null;
  }

  private async initialize(input: RecoveryCleanupInput): Promise<void> {
    if (
      input.singleWriter !== true ||
      typeof input.historyComplete !== 'boolean' ||
      !ownsMediaRoom(
        this.options.namespace,
        `${this.options.namespace}--${input.serverEpoch}--${input.serverEpoch}`,
      ) ||
      !this.options.journal.writable ||
      !this.verifiedScope()
    )
      throw new Error('RECOVERY_SCOPE_UNCONFIRMED');
    if (!Number.isSafeInteger(input.lastSeq) || input.lastSeq < 0)
      throw new Error('INVALID_RECOVERY_SEQUENCE');
    let previous = 0;
    for (const entry of input.records) {
      strictObject(entry, ['version', 'seq', 'record', 'checksum']);
      const record = validateJournalRecord(entry.record);
      if (
        entry.version !== 1 ||
        !Number.isSafeInteger(entry.seq) ||
        entry.seq <= previous ||
        entry.seq > input.lastSeq ||
        entry.checksum !== checksum({ version: 1, seq: entry.seq, record }) ||
        record.namespace !== this.options.namespace ||
        !ownsMediaRoom(this.options.namespace, record.roomName) ||
        record.roomName.split('--')[1] !== record.serverEpoch ||
        record.serverEpoch.toLowerCase() === input.serverEpoch.toLowerCase()
      )
        throw new Error('INVALID_RECOVERY_RECORD');
      previous = entry.seq;
      const key = recordKey(record);
      const prior = this.records.get(key)?.record;
      if (
        prior &&
        (prior.reservationId !== record.reservationId ||
          prior.matchId !== record.matchId ||
          prior.mediaInstanceId !== record.mediaInstanceId ||
          prior.issuedAtEpochMs !== record.issuedAtEpochMs ||
          prior.expiresAtEpochMs !== record.expiresAtEpochMs ||
          (prior.state === 'REVOKED' && record.state !== 'REVOKED'))
      )
        throw new Error('RECOVERY_RECORD_CONFLICT');
      this.records.set(key, structuredClone(entry));
    }
    this.sequence = input.lastSeq;
    this.historyComplete = input.historyComplete;
    const restored = await this.options.cleanupCheckpoint.read();
    this.assertOpen();
    if (restored.integrity === 'corrupt') throw new Error('CLEANUP_CHECKPOINT_CORRUPT');
    if (restored.integrity === 'ok') {
      const state = validateCleanupCheckpoint(restored.checkpoint.state);
      if (state.namespace !== this.options.namespace || restored.checkpoint.lastSeq > input.lastSeq)
        throw new Error('CLEANUP_CHECKPOINT_MISMATCH');
      this.historyComplete &&= state.historyComplete;
      for (const target of state.observedTargets) this.observed.set(targetKey(target), target);
    }
    for (const raw of input.retryIntents) {
      const intent = validateRetryIntent(raw);
      const matches = [...this.records.values()].filter(
        ({ record }) =>
          record.identity === intent.identity &&
          record.generation === intent.generation &&
          record.reservationId === intent.reservationId,
      );
      if (
        this.intents.has(intent.retirementId) ||
        matches.length !== 1 ||
        (intent.status === 'REVOKED' && matches[0]!.record.state !== 'REVOKED')
      )
        throw new Error('RECOVERY_RETRY_MISMATCH');
      this.intents.set(intent.retirementId, intent);
      this.intentRecords.set(intent.retirementId, recordKey(matches[0]!.record));
    }
    await this.retries.restore([...this.intents.values()]);
  }

  private async sweep(): Promise<CleanupReport> {
    try {
      if (!this.initialization) throw new Error('RECOVERY_NOT_INITIALIZED');
      await this.initialization;
      this.assertOpen();
      const report = await this.cleanup.run({
        records: [...this.records.values()].sort((a, b) => a.seq - b.seq),
        observedTargets: [...this.observed.values()],
        historyComplete: this.historyComplete,
        singleWriter: true,
        serverEpoch: this.input!.serverEpoch,
        signal: this.signal,
        beforeDispatch: () => this.canDispatch(),
      });
      this.assertOpen();
      this.historyComplete &&= report.historyComplete;
      if (this.historyComplete && report.unresolved === 0 && report.ownedRoomsRemaining === 0) {
        // This also recovers a crash after durable REVOKED but before usage confirmation.
        // Wait until the whole sweep rules out unknown identities sharing the same room.
        const roots = new Set([...this.records.values()].map(({ record }) => record.reservationId));
        for (const root of roots) await this.confirmUsage(root);
        await this.persistReport(
          { ...report, historyComplete: this.historyComplete },
          {
            signal: this.signal,
            beforeDispatch: () => this.canDispatch(),
          },
        );
      }
      this.lastReport = { ...report, historyComplete: this.historyComplete };
      if (report.unresolved || report.ownedRoomsRemaining || !this.historyComplete)
        this.notify('RECOVERY_UNCONFIRMED');
      this.publish();
      return structuredClone(this.lastReport);
    } catch {
      if (!this.closed) {
        this.lastReport = failedReport();
        this.notify('RECOVERY_UNCONFIRMED');
        this.publish();
      }
      return failedReport();
    }
  }

  private async revoke(target: CleanupTarget, context: CleanupCallContext): Promise<boolean> {
    this.assertOpen(context);
    const stored = target.record ? this.records.get(recordKey(target.record))?.record : undefined;
    if (target.record && !stored) throw new Error('RECOVERY_RECORD_MISSING');
    // A restored retry may finish after the sweep captured its pending target. Check again:
    // an observed identity could also have reappeared after that retry's absence confirmation.
    if (stored?.state === 'REVOKED' && target.record?.state !== 'REVOKED') {
      const participants = await this.participants(target.roomName, context);
      this.assertOpen(context);
      if (!participants.some((participant) => participant.identity === target.identity))
        return true;
    }
    if (!stored || stored.state === 'REVOKED') {
      // A reappearing participant is new untrusted observation. Preserve the terminal journal
      // evidence; never append REVOKED -> UNRESOLVED or invent another player/generation.
      this.historyComplete = false;
      await this.serialize(async () => {
        this.observed.set(targetKey(target), {
          roomName: target.roomName,
          identity: target.identity,
        });
        await this.writeCleanupCheckpoint(null);
      });
      try {
        await this.remote(target, context);
        return true;
      } catch {
        this.notify('RETIREMENT_UNRESOLVED');
        return false;
      }
    }
    const existing = [...this.intents.values()].find(
      (intent) => this.intentRecords.get(intent.retirementId) === recordKey(stored),
    );
    if (existing && existing.status !== 'REVOKED') return false;
    const now = this.options.epochNowMs();
    // A crash during the first request must not recreate a provider wait or an immediate retry.
    const prepared: RetryIntent = {
      retirementId: randomUUID(),
      reservationId: stored.reservationId ?? '',
      identity: stored.identity,
      generation: stored.generation,
      firstRetireEpochMs: now,
      lastAttemptEpochMs: null,
      nextAttemptEpochMs: null,
      attempt: 0,
      status: 'UNRESOLVED',
      alarmed: true,
      providerWaitUnknown: true,
    };
    if (!safeIdentifier(prepared.reservationId)) {
      this.notify('RECOVERY_UNCONFIRMED');
      return false;
    }
    this.intentRecords.set(prepared.retirementId, recordKey(stored));
    await this.persistIntent(prepared);
    try {
      await this.remote(target, context);
      this.assertOpen(context);
      await this.persistIntent({ ...prepared, status: 'REVOKED', providerWaitUnknown: false });
      return true;
    } catch (error) {
      if (!this.canDispatch()) return false;
      await this.retries.begin({
        retirementId: prepared.retirementId,
        reservationId: prepared.reservationId,
        identity: prepared.identity,
        generation: prepared.generation,
        firstRetireEpochMs: now,
        ...(error instanceof GatewayError && error.status === 429
          ? error.retryAfterMs === undefined
            ? { providerWaitUnknown: true }
            : { retryAfterMs: error.retryAfterMs }
          : {}),
      });
      this.notify('RETIREMENT_UNRESOLVED');
      return false;
    }
  }

  private remote(target: CleanupTarget, context: CleanupCallContext): Promise<void> {
    return confirmRemoteRevocation({
      capability: this.options.capability,
      nowEpochSeconds: () => this.options.epochNowMs() / 1000,
      beforeDispatch: () => this.canDispatch(context),
      remove: async (cutoff) => {
        await this.cancellable(() =>
          this.options.gateway.removeParticipant(
            target.roomName,
            target.identity,
            cutoff === undefined ? undefined : { revokeTokenTs: cutoff },
            this.context(context),
          ),
        );
      },
      absent: async () =>
        !(await this.participants(target.roomName, context, REVOCATION_QUEUE_WAIT_MS)).some(
          (p) => p.identity === target.identity,
        ),
    });
  }

  private async participants(
    room: string,
    context: CleanupCallContext,
    queueWaitMs = SWEEP_QUEUE_WAIT_MS,
  ) {
    try {
      return await this.cancellable(() =>
        this.options.gateway.listParticipants(room, this.context(context, queueWaitMs)),
      );
    } catch (error) {
      // Only a typed query "not_found" means no current participant; Remove must still ACK.
      if (error instanceof GatewayError && error.status === 404 && error.code === 'not_found')
        return [];
      throw error;
    }
  }

  private async deleteRoom(room: string, context: CleanupCallContext): Promise<void> {
    try {
      await this.cancellable(() =>
        this.options.gateway.deleteRoom(room, this.context(context, SWEEP_QUEUE_WAIT_MS)),
      );
    } catch (error) {
      // A typed already-absent room is idempotent deletion, still followed by final queries.
      // This exception never applies to removeParticipant, whose ACK remains mandatory.
      if (!(error instanceof GatewayError && error.status === 404 && error.code === 'not_found'))
        throw error;
    }
  }

  /** Stop waiting on remote IO at shutdown; the SDK may settle later but cannot continue cleanup. */
  private cancellable<T>(start: () => Promise<T>): Promise<T> {
    if (this.signal.aborted) return Promise.reject(new Error('RECOVERY_DISPATCH_BLOCKED'));
    return new Promise<T>((resolve, reject) => {
      const cancelled = () => reject(new Error('RECOVERY_DISPATCH_BLOCKED'));
      this.signal.addEventListener('abort', cancelled, { once: true });
      void Promise.resolve()
        .then(() => {
          this.assertOpen();
          return start();
        })
        .then(
          (result) => {
            this.signal.removeEventListener('abort', cancelled);
            if (this.signal.aborted) cancelled();
            else resolve(result);
          },
          (error: unknown) => {
            this.signal.removeEventListener('abort', cancelled);
            reject(error);
          },
        );
    });
  }

  private findRecord(intent: RetryIntent): JournalRecord | undefined {
    const key = this.intentRecords.get(intent.retirementId);
    return key ? this.records.get(key)?.record : undefined;
  }

  private persistIntent(intent: RetryIntent): Promise<void> {
    return this.serialize(async () => {
      const record = this.findRecord(intent);
      if (!record) throw new Error('RECOVERY_RECORD_MISSING');
      const next: JournalRecord = {
        ...record,
        state: intent.status,
        retirementId: intent.retirementId,
        firstRetireAtEpochMs: intent.firstRetireEpochMs,
        attempt: intent.attempt,
        atEpochMs: this.options.epochNowMs(),
      };
      const result = await this.options.journal.append(next);
      this.sequence = result.seq;
      this.records.set(recordKey(next), {
        version: 1,
        seq: result.seq,
        record: next,
        checksum: checksum({ version: 1, seq: result.seq, record: next }),
      });
      this.intents.set(intent.retirementId, structuredClone(intent));
      await this.options.retryCheckpoint.write({
        lastSeq: this.sequence,
        state: [...this.intents.values()],
      });
    });
  }

  private async confirmUsage(root: string | undefined): Promise<void> {
    if (!root || !this.historyComplete) return;
    const entries = [...this.records.values()].filter(
      ({ record }) => record.reservationId === root,
    );
    if (!entries.length || entries.some(({ record }) => record.state !== 'REVOKED')) return;
    const snapshot = this.options.usageBudget.snapshot();
    const reservations = snapshot.reservations.filter(
      (r) =>
        r.request.reservationId === root ||
        (r.request.reservationId.startsWith(root + ':') &&
          /^\d+$/.test(r.request.reservationId.slice(root.length + 1))),
    );
    if (
      snapshot.integrity !== 'ok' ||
      !snapshot.writable ||
      !reservations.some((r) => r.request.reservationId === root) ||
      reservations.some((r) => entries.some(({ record }) => r.request.matchId !== record.matchId))
    ) {
      this.historyComplete = false;
      this.notify('RECOVERY_UNCONFIRMED');
      return;
    }
    for (const reservation of reservations) {
      if (!this.canDispatch()) return;
      if (
        !(await this.options.usageBudget.markRetiring(reservation.request.reservationId)) ||
        !(await this.options.usageBudget.markRemoteConfirmed(reservation.request.reservationId))
      ) {
        this.historyComplete = false;
        this.notify('RECOVERY_UNCONFIRMED');
        return;
      }
    }
  }

  private persistReport(report: CleanupReport, context: CleanupCallContext): Promise<void> {
    this.assertOpen(context);
    return this.serialize(async () => {
      this.historyComplete &&= report.historyComplete;
      await this.writeCleanupCheckpoint({ ...report, historyComplete: this.historyComplete });
    });
  }

  private writeCleanupCheckpoint(report: CleanupReport | null): Promise<void> {
    return this.options.cleanupCheckpoint.write({
      lastSeq: this.sequence,
      state: {
        namespace: this.options.namespace,
        historyComplete: this.historyComplete,
        observedTargets: [...this.observed.values()],
        report,
      },
    });
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    if (this.closed || this.failed) return Promise.reject(new Error('RECOVERY_STORAGE_CLOSED'));
    const queued = this.writes.then(async () => {
      if (this.closed || this.failed || !this.options.journal.writable)
        throw new Error('RECOVERY_STORAGE_CLOSED');
      try {
        await work();
      } catch (error) {
        this.failStorage();
        throw error;
      }
    });
    this.writes = queued.catch(() => {});
    return queued;
  }

  private context(
    context: CleanupCallContext,
    queueWaitMs = REVOCATION_QUEUE_WAIT_MS,
  ): GatewayCallContext {
    this.assertOpen(context);
    return {
      requestId: randomUUID(),
      deadlineMs: this.options.monotonicNow() + queueWaitMs,
      priority: 'cleanup',
      signal: this.signal,
      beforeDispatch: () => this.canDispatch(context),
    };
  }

  private verifiedScope(): boolean {
    const report = this.options.capability();
    return (
      this.options.namespaceOwnershipConfirmed() &&
      report?.status === 'SUPPORTED' &&
      report.namespace === this.options.namespace &&
      report.cloudProjectAlias === this.options.projectAlias &&
      report.revocationVerified &&
      report.revocationProfile !== null
    );
  }

  private canDispatch(context?: CleanupCallContext): boolean {
    try {
      return (
        !this.closed &&
        !this.failed &&
        !this.signal.aborted &&
        this.verifiedScope() &&
        this.options.journal.writable &&
        this.options.retryCheckpoint.writable &&
        this.options.cleanupCheckpoint.writable &&
        this.input?.beforeDispatch() === true &&
        (!context || context.beforeDispatch())
      );
    } catch {
      return false;
    }
  }

  private assertOpen(context?: CleanupCallContext): void {
    if (!this.canDispatch(context)) throw new Error('RECOVERY_DISPATCH_BLOCKED');
  }

  private notify(code: Parameters<RecoveryCleanupBindingsOptions['onUnresolved']>[0]): void {
    try {
      this.options.onUnresolved(code);
    } catch {
      /* observation only */
    }
  }
  private failStorage(): void {
    this.failed = true;
    this.notify('JOURNAL_WRITE_FAILED');
  }
  private publish(): void {
    if (this.lastReport && !this.closed) {
      try {
        this.options.onReport?.(structuredClone(this.lastReport));
      } catch {
        this.notify('RECOVERY_UNCONFIRMED');
      }
    }
  }

  private queueRetrySweep(): void {
    if (this.retrySweepQueued || this.closed) return;
    this.retrySweepQueued = true;
    const previous = this.activeSweep;
    void Promise.resolve(previous)
      .then(async () => {
        this.retrySweepQueued = false;
        if (!this.closed) await this.reconcile();
      })
      .catch(() => this.notify('RECOVERY_UNCONFIRMED'));
  }

  /** Use RecoveryBootstrap.closeCleanup so this queue/store drains before the journal lease ends. */
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.abort.abort();
      this.closing = this.closeOnce();
    }
    return this.closing;
  }

  private async closeOnce(): Promise<void> {
    const retries = this.retries.close();
    await Promise.allSettled([this.initialization, this.activeSweep, retries]);
    await this.writes;
    await this.options.cleanupCheckpoint.close();
  }
}

import { GrantIssuer, type GrantIssuerDeps } from '../media/GrantIssuer.js';
import type { Generation } from '../media/MediaGenerationRegistry.js';
import type {
  MediaCoordinatorDeps,
  MediaInitializationResult,
  OperationsPort,
  Readiness,
} from '../media/types.js';
import { MediaUsageLease } from '../operations/MediaUsageLease.js';
import type { JournalRecord } from '../operations/OperationJournal.js';
import {
  OperationsBindings,
  type OperationsBindingsOptions,
} from '../operations/OperationsBindings.js';
import { OperationsController } from '../operations/OperationsController.js';
import { ReadinessGate, type ReadinessGateOptions } from './Readiness.js';
import { sameJournalGeneration } from './ReservationReadiness.js';

export type ReadinessRuntimeOptions = Omit<
  ReadinessGateOptions,
  'isInitialized' | 'pendingPreparations'
> &
  Pick<
    OperationsBindingsOptions,
    'getGameActivity' | 'getOfficialRevision' | 'recoveryCleanup' | 'monthlyUsage'
  > &
  Readonly<{ monotonicNow: () => number; emitMetric?: MediaCoordinatorDeps['emitMetric'] }>;

/** E-owned readiness/operations/issuance assembly. B still owns HTTP and game bootstrap. */
export function createReadinessRuntime(options: ReadinessRuntimeOptions): ReadinessRuntime {
  return new ReadinessRuntime(options);
}

export class ReadinessRuntime {
  readonly usageLease: MediaUsageLease;
  private readonly gate: ReadinessGate;
  private readonly bindings: OperationsBindings;
  private readonly operations: OperationsController;
  private readonly pending = new Set<Generation>();
  private initialization: Promise<MediaInitializationResult> | null = null;
  private initialized = false;
  private closed = false;
  private closing: Promise<void> | null = null;
  private issuer: GrantIssuer | null = null;

  constructor(private readonly options: ReadinessRuntimeOptions) {
    options = this.options = {
      ...options,
      config: structuredClone(options.config),
      retries: [...options.retries],
    };
    this.usageLease = new MediaUsageLease(options.usageBudget, options.nowEpochMs);
    this.gate = new ReadinessGate({
      ...options,
      isInitialized: this.isInitialized,
      pendingPreparations: () => [...this.pending],
    });
    this.bindings = new OperationsBindings({
      config: options.config,
      journal: options.journal,
      usageBudget: options.usageBudget,
      getReadiness: this.getReadiness,
      getGameActivity: options.getGameActivity,
      retries: options.retries,
      recoveryCleanup: options.recoveryCleanup,
      nowEpochMs: options.nowEpochMs,
      getOfficialRevision: options.getOfficialRevision,
      refreshBudget: () => options.recovery.refreshBudget(),
      monthlyUsage: options.monthlyUsage,
      isRetirementInFlight: (record) =>
        (options.pendingRetirements?.() ?? []).some(
          (g) =>
            options.registry.all().includes(g) &&
            g.serverEpoch === options.registry.serverEpoch &&
            ['PREPARED', 'REVOKING', 'REVOKED'].includes(g.state) &&
            sameJournalGeneration(record, g),
        ),
    });
    this.operations = new OperationsController({
      nowEpochMs: options.nowEpochMs,
      monotonicNow: options.monotonicNow,
      timeoutMs: options.config.operationTimeoutMs,
      timeoutForCommand: (command) => this.bindings.recoveryCheckpointTimeout(command),
      observePressure: (pending, rejected) => {
        options.emitMetric?.({
          name: 'operations.queue.pending',
          value: pending,
          unit: 'count',
          atMs: options.monotonicNow(),
        });
        if (rejected)
          options.emitMetric?.({
            name: 'operations.queue.rejected',
            value: 1,
            unit: 'count',
            atMs: options.monotonicNow(),
          });
      },
      setAdmission: (state) => {
        if (state === 'LOCKED') this.gate.lock('READINESS_UNCONFIRMED');
        this.bindings.setAdmission(state);
      },
      getStatus: () => this.bindings.getStatus(),
      canResume: () => this.bindings.canResume(),
      canComplete: (command) => this.bindings.canComplete(command),
      run: (command, signal, beforeDispatch) => this.bindings.run(command, signal, beforeDispatch),
      auditStore: options.audit,
    });
  }

  /** Pass these bound functions unchanged to health, B admission/autostart, and UsageBudget. */
  readonly isInitialized = (): boolean => this.initialized && !this.closed;
  readonly getReadiness = (): Readiness => {
    const readiness = this.gate.getReadiness();
    // A health observation of a lost prerequisite also revokes OPEN. Recovery never reopens it.
    if (readiness.state !== 'READY') this.bindings?.setAdmission('DRAINING');
    return readiness;
  };
  readonly canIssue = (): boolean =>
    this.getReadiness().state === 'READY' &&
    this.operations.getStatus().admission === 'OPEN' &&
    this.bindings.canIssue();
  readonly getOperations = (): OperationsPort => this.operations;
  readonly lock = (reason: string): void => {
    this.gate.lock(reason);
    this.bindings.setAdmission('LOCKED');
  };

  initialize(): Promise<MediaInitializationResult> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce(): Promise<MediaInitializationResult> {
    if (this.closed) return { status: 'fatal', code: 'INITIALIZATION_FAILED' };
    const result = await this.options.recovery.initialize();
    if (result.status === 'fatal') {
      this.lock(result.code);
      return result;
    }
    if (this.closed) return { status: 'fatal', code: 'INITIALIZATION_FAILED' };
    // Local audit restore is required; asynchronous Cloud cleanup is deliberately not awaited.
    try {
      await this.operations.initializeAudit();
    } catch {
      // A locally observable audit fault remains LOCKED; it must not hide health behind Cloud retry.
      this.lock('AUDIT_WRITE_FAILED');
    }
    if (this.closed) return { status: 'fatal', code: 'INITIALIZATION_FAILED' };
    this.initialized = true;
    const readiness = this.getReadiness();
    return {
      status: 'initialized',
      admission: 'DRAINING',
      readiness: { ...readiness, state: readiness.state === 'LOCKED' ? 'LOCKED' : 'RECOVERING' },
    };
  }

  /** Reuses E-05; E-16 will supply real retirement/control callbacks and its transition queue. */
  createGrantIssuer(
    callbacks: Pick<GrantIssuerDeps, 'retire' | 'onPrepared' | 'sign'> &
      Partial<Pick<GrantIssuerDeps, 'canIssue'>>,
  ): GrantIssuer {
    if (this.issuer) throw new Error('GRANT_ISSUER_ALREADY_BOUND');
    this.issuer = new GrantIssuer({
      ...callbacks,
      config: this.options.config,
      registry: this.options.registry,
      nowEpochMs: this.options.nowEpochMs,
      capability: this.options.capability,
      canIssue: (generation, requested) =>
        this.canIssue() && (callbacks.canIssue?.(generation, requested) ?? true),
      lock: this.lock,
      reserve: async (generation) => {
        this.pending.add(generation);
        try {
          if (!this.canIssue()) {
            this.pending.delete(generation);
            return false;
          }
          if (generation.splitOwnership) {
            const requests = this.usageLease.prepareReservation(generation);
            await this.options.journal.prepareReservation(this.preparationRecord(generation), {
              phase: 'RESERVING',
              requests,
            });
          }
          const reserved = await this.usageLease.reserve(generation);
          if (!reserved && generation.splitOwnership) {
            await this.options.journal.abortUnreserved(
              this.preparationRecord(generation),
              this.options.usageBudget.snapshot(),
              this.options.nowEpochMs(),
            );
            this.usageLease.abandonUnreserved(generation);
            this.options.registry.abandonUnissued(generation);
          }
          if (!reserved) this.pending.delete(generation);
          return reserved;
        } catch (error) {
          this.pending.delete(generation);
          throw error;
        }
      },
      persist: async (generation) => {
        try {
          if (!this.isInitialized() || !this.pending.has(generation))
            throw new Error('PREPARATION_NOT_ACTIVE');
          const record = this.preparationRecord(generation);
          if (generation.splitOwnership)
            await this.options.journal.commitReservation(
              record,
              this.options.usageBudget.snapshot(),
            );
          else await this.options.journal.append(record);
        } finally {
          this.pending.delete(generation);
        }
      },
    });
    return this.issuer;
  }

  private preparationRecord(generation: Generation): JournalRecord {
    return {
      state: 'PREPARED',
      namespace: this.options.config.namespace,
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
      requestId: generation.request.requestId,
    };
  }

  /** Seal grants/commands first. Owner then closes E-11/E-13 and RecoveryBootstrap (journal last). */
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.gate.lock('CLOSED');
      const bindings = this.bindings.close();
      this.closing = Promise.allSettled([bindings, this.operations.close()]).then((results) => {
        const failure = results.find((r) => r.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      });
    }
    return this.closing;
  }
}

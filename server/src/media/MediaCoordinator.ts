import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { StructuredEvent } from '../observability/StructuredEvents.js';
import { createReadinessRuntime, type ReadinessRuntime } from '../health/ReadinessRuntime.js';
import { ApiBudget } from '../operations/ApiBudget.js';
import { DurableRetention } from '../operations/DurableRetention.js';
import { CheckpointStore } from '../operations/CheckpointStore.js';
import { OperationJournal } from '../operations/OperationJournal.js';
import { OperationsAudit } from '../operations/OperationsAudit.js';
import { createOperationsHandlers } from '../operations/OperationsHandlers.js';
import type { OperationsBindingsOptions } from '../operations/OperationsBindings.js';
import { createRecoveryBootstrap } from '../operations/RecoveryBootstrap.js';
import {
  RecoveryCleanupBindings,
  validateCleanupCheckpoint,
} from '../operations/RecoveryCleanupBindings.js';
import { RevocationRetryBindings } from '../operations/RevocationRetryBindings.js';
import { SharedRetryCheckpoint } from '../operations/SharedRetryCheckpoint.js';
import { UsageBudget } from '../operations/UsageBudget.js';
import { UsageCheckpoint, readOfficialUsageInput } from '../operations/UsageCheckpoint.js';
import { loadCapabilityReport, type CapabilityReport } from './CloudCapabilityProbe.js';
import { GenerationTransition } from './GenerationTransition.js';
import { LiveKitGateway, type GatewayOptions } from './LiveKitGateway.js';
import { MediaGenerationRegistry, type Generation } from './MediaGenerationRegistry.js';
import { MediaLifecycle } from './MediaLifecycle.js';
import { MediaPolicyBindings } from './MediaPolicyBindings.js';
import { SplitMediaPolicyBindings } from './SplitMediaPolicyBindings.js';
import {
  ownedMediaRooms,
  ownedMediaTargets,
  sameMediaOwnership,
} from '../operations/SplitMediaOwnership.js';
import { RequestHistory } from './RequestHistory.js';
import {
  MonthlyUsageMeter,
  fileMonthlyUsageStore,
  type MonthlyUsageSnapshot,
} from './MonthlyUsageMeter.js';
import type { GrantIssuerDeps } from './GrantIssuer.js';
import type {
  MediaCoordinator,
  MediaCoordinatorDeps,
  MediaFailureCode,
  MediaInitializationResult,
  PreparationResult,
  PrepareGenerationRequest,
  RetirementResult,
  RetireGenerationRequest,
  TrustedMediaFrame,
} from './types.js';

/** E-owned assembly inputs. B/F must supply verified server evidence, never HTTP booleans. */
export type MediaCoordinatorServices = Readonly<{
  mediaMode?: () => 'cloud' | 'disabled' | 'mock' | null;
  productSecurityReady?: () => boolean;
  namespaceOwnershipConfirmed?: () => boolean;
  firstInstallationConfirmed?: () => Promise<boolean>;
  firstAuditConfirmed?: () => boolean;
  getOfficialRevision?: OperationsBindingsOptions['getOfficialRevision'];
  /** Local deterministic adapter tests only; this does not attest actual Cloud support. */
  clientFactory?: GatewayOptions['clientFactory'];
  sign?: GrantIssuerDeps['sign'];
}>;

export interface MediaCoordinatorRuntime extends MediaCoordinator {
  /** B authenticates and validates player/scope before forwarding D lifecycle reports here. */
  readonly lifecycle: MediaLifecycle;
  readonly isInitialized: () => boolean;
  readonly canIssue: () => boolean;
  /** B supplies operator authentication; E keeps HTTP and commands on the same durable audit. */
  createOperationsHandlers(
    authorize: (authorization: string | undefined) => boolean,
  ): ReturnType<typeof createOperationsHandlers>;
  /** Also driven outside the game tick by the owner's bounded maintenance loop. */
  reconcile(): Promise<void>;
  /** Only invoked by Room disposal or successful rematch, never by the ordinary tick. */
  releaseMatch(matchId: string): void;
  /** Aggregate local diagnostics only; no identifiers, grants or private game information. */
  inspectRetention(): Readonly<Record<string, number>>;
  /**
   * S15P21C204-364. Whether a new match may start on the monthly participant-minute guard. True
   * when the guard is not configured; running matches are never stopped by it.
   */
  allowsNewMatch(): boolean;
  /** The guard's current count, or null when it is not configured. */
  monthlyUsage(): MonthlyUsageSnapshot | null;
}

/** The public EXEC-CONTRACT-3 factory remains structurally compatible. No routes or env IO. */
export function createMediaCoordinator(
  deps: MediaCoordinatorDeps,
  services: MediaCoordinatorServices = {},
): MediaCoordinatorRuntime {
  return new Coordinator(deps, services);
}

/** 364. Beside the other operations state on the durable volume, so a deploy keeps the count. */
const MONTHLY_USAGE_FILE = 'livekit-monthly-usage.json';

class Coordinator implements MediaCoordinatorRuntime {
  readonly lifecycle: MediaLifecycle;
  private readonly registry: MediaGenerationRegistry;
  /** S15P21C204-364. The monthly participant-minute guard; null when not configured. */
  private readonly monthly: MonthlyUsageMeter | null;
  private monthlyBlocked = false;
  private readonly apiBudget: ApiBudget;
  private readonly gateway: LiveKitGateway;
  private readonly journal: OperationJournal;
  private readonly audit: OperationsAudit;
  private readonly runtime: ReadinessRuntime;
  private readonly currentCleanup: RevocationRetryBindings;
  private readonly durableRetention: DurableRetention;
  private readonly recovery: ReturnType<typeof createRecoveryBootstrap>;
  private readonly policy: MediaPolicyBindings | SplitMediaPolicyBindings;
  private readonly transition: GenerationTransition;
  private readonly pruneGrantRequests: () => void;
  private readonly pendingRetirements = new Map<Generation, number>();
  /** S15P21C204-332: scopes whose last result B saw was not `confirmed`, so the room still holds them. */
  private readonly unconfirmedRetirements = new Set<string>();
  private readonly retirements = new Map<Generation, Promise<RetirementResult>>();
  private readonly roomCleanups = new Map<string, Promise<void>>();
  private readonly failures = new WeakMap<Generation, Set<MediaFailureCode>>();
  private readonly published: RequestHistory<{ matchId: string }>;
  private readonly publishedRetirements: RequestHistory<{ matchId: string }>;
  private readonly recoveryRequests: RequestHistory<{
    matchId: string;
    recovery: boolean;
    recoveryStartedAt?: number;
  }>;
  private readonly active = new Set<Promise<unknown>>();
  private capability: CapabilityReport | null = null;
  private initialized = false;
  private initialization: Promise<MediaInitializationResult> | null = null;
  private closed = false;
  private closing: Promise<void> | null = null;
  private maintenance: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: MediaCoordinatorDeps,
    services: MediaCoordinatorServices,
  ) {
    deps = this.deps = { ...deps, config: structuredClone(deps.config) };
    this.published = new RequestHistory(deps.monotonicNow);
    this.publishedRetirements = new RequestHistory(deps.monotonicNow);
    this.recoveryRequests = new RequestHistory(deps.monotonicNow);
    const { config } = deps;
    if (
      !Number.isSafeInteger(config.maxConcurrentParticipants) ||
      config.maxConcurrentParticipants < 1
    )
      throw new Error('INVALID_MEDIA_CAPACITY');
    const nowEpochMs = () => Math.floor(deps.epochNowSeconds() * 1000);
    this.monthly = config.monthlyUsage
      ? new MonthlyUsageMeter(
          config.monthlyUsage,
          fileMonthlyUsageStore(join(config.opsDataDir, MONTHLY_USAGE_FILE)),
          nowEpochMs,
        )
      : null;
    this.registry = new MediaGenerationRegistry(
      config.namespace,
      true,
      config.subscriptionMode === 'server-forwarding' ? 'split' : 'single',
    );
    this.apiBudget = new ApiBudget({
      monotonicNow: deps.monotonicNow,
      maxNormalCallsPer60s: config.maxNormalApiCallsPer60s,
      maxTotalCallsPer60s: config.maxTotalApiCallsPer60s,
    });
    const gateway = new LiveKitGateway(config, this.apiBudget, {
      monotonicNow: deps.monotonicNow,
      requestTimeoutMs: config.operationTimeoutMs,
      clientFactory: services.clientFactory,
      observe: (observation) => {
        if (observation.result !== 'failed') return;
        this.event('media.api.failed', 'warn', {
          method: observation.method,
          status: observation.statusCode ?? null,
          requestId: observation.requestId,
          durationMs:
            observation.completedAtMs === undefined
              ? null
              : Math.max(0, observation.completedAtMs - observation.sentAtMs),
        });
      },
    });
    this.gateway = gateway;
    this.journal = new OperationJournal({ opsDataDir: config.opsDataDir });
    const writable = () => this.journal.writable;
    const cleanupCheckpoint = new CheckpointStore({
      opsDataDir: config.opsDataDir,
      fileName: 'cleanup-checkpoint.json',
      validate: validateCleanupCheckpoint,
      isWritable: writable,
    });
    const usageBudget = new UsageBudget({
      store: new UsageCheckpoint({
        opsDataDir: config.opsDataDir,
        isWritable: writable,
        providerQuota: config.operatingMode === 'continuous',
      }),
      projectAlias: config.projectAlias,
      officialBudgetMaxAgeMs: config.officialBudgetMaxAgeMs,
      providerQuota: config.operatingMode === 'continuous',
      now: nowEpochMs,
      canIssue: () => ({ allowed: this.canIssue() }),
    });
    const retryCheckpoint = new SharedRetryCheckpoint({
      opsDataDir: config.opsDataDir,
      isWritable: writable,
      isRetiredReservation: (reservationId) => usageBudget.isRetiredReservation(reservationId),
    });
    const audit = new OperationsAudit({
      opsDataDir: config.opsDataDir,
      nowEpochMs,
      isWritable: writable,
      allowMissingHistory: services.firstAuditConfirmed,
      emitMetric: (name, value) =>
        deps.emitMetric({ name, value, unit: 'count', atMs: deps.monotonicNow() }),
    });
    this.audit = audit;
    const recoveryCleanup = new RecoveryCleanupBindings({
      namespace: config.namespace,
      projectAlias: config.projectAlias,
      namespaceOwnershipConfirmed: services.namespaceOwnershipConfirmed ?? (() => false),
      journal: this.journal,
      retryCheckpoint,
      cleanupCheckpoint,
      usageBudget,
      gateway,
      capability: () => this.capability,
      epochNowMs: nowEpochMs,
      monotonicNow: deps.monotonicNow,
      onUnresolved: (reason) => {
        if (reason === 'JOURNAL_WRITE_FAILED') this.runtime?.lock(reason);
      },
      onReport: (report) => {
        this.recovery.state.completeCleanup(report);
        this.recovery.refreshBudget();
      },
    });
    this.recovery = createRecoveryBootstrap({
      namespace: config.namespace,
      serverEpoch: this.registry.serverEpoch,
      journal: this.journal,
      retryCheckpoint,
      usageBudget,
      nowEpochMs,
      monotonicNow: deps.monotonicNow,
      officialBudgetMaxAgeMs: config.officialBudgetMaxAgeMs,
      providerQuota: config.operatingMode === 'continuous',
      firstInstallationConfirmed: services.firstInstallationConfirmed,
      allowIncompleteHistoryCleanup: true,
      beginCleanup: async (input) => {
        // A checked local official input requires F's independent period/revision evidence.
        if (config.operatingMode !== 'continuous')
          try {
            const official = await readOfficialUsageInput(config.opsDataDir, {
              projectAlias: config.projectAlias,
              nowEpochMs: nowEpochMs(),
              maxAgeMs: config.officialBudgetMaxAgeMs,
            });
            const revision = services.getOfficialRevision?.(official);
            if (revision && !input.signal.aborted)
              await usageBudget.reconcileOfficial(official, revision);
          } catch {
            /* Missing evidence keeps readiness locked; no invented initialBudget proof. */
          }
        this.recovery.refreshBudget();
        return recoveryCleanup.run(input);
      },
      closeCleanup: () => recoveryCleanup.close(),
    });
    this.currentCleanup = new RevocationRetryBindings({
      namespace: config.namespace,
      journal: this.journal,
      checkpoint: retryCheckpoint,
      // This fresh process has no generations. E-13 exclusively owns all recovered intents.
      // SharedRetryCheckpoint retains their union; E-12 still validates the full disk history.
      initialCheckpoint: { lastSeq: 0, state: [] },
      initialJournalRecords: [],
      usageBudget,
      gateway,
      generations: () => this.registry.all(),
      capability: () => this.capability,
      monotonicNow: deps.monotonicNow,
      epochNowMs: nowEpochMs,
      stopPermissions: (g) => this.policy.retire(g),
      ...(config.subscriptionMode === 'server-forwarding'
        ? {
            awaitPendingPermissions: (g: Generation) =>
              (this.policy as SplitMediaPolicyBindings).quiesce(g),
          }
        : {}),
      onOccupancyEnded: async (g) => {
        // S15P21C204-332. The room only clears a scope from its pendingRetirements on a
        // confirmed MEDIA_RETIRED. When the first bounded retire returned `unknown` the retry
        // engine confirms the remote boundary here, and without this notice the room keeps the
        // scope forever: its seat stays RETIRING, closeRoom is refused and the MAX_ROOMS budget
        // never comes back. Only a scope B last heard was unconfirmed is announced again, so the
        // healthy first-try path still emits exactly one result per B request id.
        if (this.unconfirmedRetirements.has(this.retirementScope(g)))
          this.finishRetirement({
            ...this.retirement(g, 'shutdown'),
            status: 'confirmed',
            code: null,
          });
        const group = this.registry
          .all()
          .filter(
            (other) =>
              other.reservationId === g.reservationId && !this.registry.wasNeverIssued(other),
          );
        if (group.length && group.every((other) => this.durablyRevoked(other))) {
          await this.runtime.usageLease.markRetiring(g.roomName);
          for (const roomName of ownedMediaRooms(g)) await this.cleanupRoom(roomName);
        }
      },
      lockIssuance: (reason) => {
        if (reason === 'JOURNAL_WRITE_FAILED') this.runtime.lock(reason);
        else this.runtime.getReadiness(); // UNKNOWN drains OPEN; retry success never auto-resumes.
      },
      onUnresolved: () => this.metric('media.retirement.unresolved'),
      onRetirementUnresolved: (g, reason) =>
        this.event('media.retirement.unresolved', 'warn', { generation: g.generation, reason }),
    });
    this.runtime = createReadinessRuntime({
      emitMetric: deps.emitMetric,
      config,
      recovery: this.recovery,
      registry: this.registry,
      journal: this.journal,
      usageBudget,
      audit,
      retryCheckpoint,
      cleanupCheckpoint,
      retries: [this.currentCleanup.retries, recoveryCleanup.retries],
      recoveryCleanup,
      nowEpochMs,
      monotonicNow: deps.monotonicNow,
      getGameActivity: deps.getGameActivity,
      getOfficialRevision: services.getOfficialRevision ?? (() => null),
      monthlyUsage: () => this.monthly?.snapshot() ?? null,
      mediaMode: services.mediaMode ?? (() => null),
      productSecurityReady: services.productSecurityReady ?? (() => false),
      namespaceOwnershipConfirmed: services.namespaceOwnershipConfirmed ?? (() => false),
      capability: () => this.capability,
      pendingRetirements: () =>
        [...this.pendingRetirements]
          .filter(
            ([g, deadline]) =>
              Number.isFinite(deps.monotonicNow()) &&
              deps.monotonicNow() >= deadline - 3000 &&
              deps.monotonicNow() < deadline &&
              ['PREPARED', 'REVOKING', 'REVOKED'].includes(g.state),
          )
          .map(([g]) => g),
    });
    this.durableRetention = new DurableRetention({
      journal: this.journal,
      usageBudget,
      retryCheckpoint,
      owners: [this.currentCleanup, recoveryCleanup],
      now: nowEpochMs,
      monotonicNow: deps.monotonicNow,
      canStart: () => {
        const activity = deps.getGameActivity();
        return (
          this.isInitialized() &&
          this.getReadiness().state === 'READY' &&
          activity.activeMatches === 0 &&
          activity.activePractices === 0 &&
          activity.pendingAdmissions === 0 &&
          this.retirements.size === 0 &&
          this.roomCleanups.size === 0
        );
      },
      ownershipConfirmed: () => services.namespaceOwnershipConfirmed?.() === true,
      onFailure: () => {
        if (!this.closed) this.runtime.lock('JOURNAL_WRITE_FAILED');
      },
    });
    const policyOptions = {
      registry: this.registry,
      gateway,
      config,
      monotonicNow: deps.monotonicNow,
      enqueueBindings: deps.enqueueBindings,
      enqueueAudioPolicy: deps.enqueueAudioPolicy,
      emitMetric: deps.emitMetric,
      emitEvent: deps.emitEvent,
      isPermissionsAllowed: (g: Generation) =>
        !this.closed &&
        this.registry.isCurrent(g) &&
        !this.lifecycle.hasLocalRetirement(g) &&
        this.lifecycle.isGameConnected(g.request.matchId, g.request.playerId) &&
        this.transition.isAllowed(g.request.matchId, g.request.playerId) &&
        this.getReadiness().state === 'READY',
      onFailure: (g: Generation, code: MediaFailureCode) => this.fail(g, code),
    };
    this.policy =
      config.subscriptionMode === 'server-forwarding'
        ? new SplitMediaPolicyBindings({
            ...policyOptions,
            capability: () => this.capability,
            epochNowSeconds: deps.epochNowSeconds,
            prepareForward: (publisher, receiver, kind) =>
              this.journal.prepareForward(
                {
                  namespace: config.namespace,
                  roomName: publisher.roomName,
                  identity: publisher.identity,
                  generation: publisher.generation,
                },
                {
                  sourceRoomName:
                    kind === 'face' ? publisher.splitOwnership!.faceRoomName : publisher.roomName,
                  identity:
                    kind === 'face' ? publisher.splitOwnership!.faceIdentity : publisher.identity,
                  destinationRoomName: receiver.roomName,
                },
              ),
          })
        : new MediaPolicyBindings(policyOptions);
    this.lifecycle = new MediaLifecycle({
      registry: this.registry,
      monotonicNow: deps.monotonicNow,
      inspect: (g) => this.policy.inspect(g),
      onRecoveryStarted: (g) => this.policy.requestReconciliation(g),
      isRecoveryAllowed: (g) => this.transition.isAllowed(g.request.matchId, g.request.playerId),
      onFailure: (g, code) => this.fail(g, code),
      onGameDisconnected: ({ matchId, playerId }) =>
        this.transition.invalidatePlayer(matchId, playerId, 'connection-lost'),
    });
    const issuer = this.runtime.createGrantIssuer({
      sign: services.sign,
      onPrepared: () => {},
      canIssue: (g, requested) =>
        !this.closed &&
        this.registry
          .all()
          .filter(
            (current) => !this.registry.wasNeverIssued(current) && !this.durablyRevoked(current),
          )
          .reduce((total, current) => total + ownedMediaTargets(current).length, 0) <=
          config.maxConcurrentParticipants - (g ? 0 : this.registry.capacityFor(requested)) &&
        (!g || (this.activePlayer(g.request) && !this.lifecycle.hasLocalRetirement(g))),
      retire: (g) => {
        this.track(this.rawRetire(this.retirement(g, 'policy-unknown')));
      },
    });
    this.pruneGrantRequests = () => issuer.prune();
    this.transition = new GenerationTransition({
      monotonicNow: deps.monotonicNow,
      current: (input) => {
        const g = this.registry.get(input.matchId, input.playerId);
        return g
          ? this.retirement(
              g,
              g.request.mediaInstanceId === input.mediaInstanceId ? 'reconnect' : 'phase-change',
            )
          : null;
      },
      retire: (input) => this.rawRetire(input),
      prepare: (input) => issuer.prepare(input),
      isActive: (input) => this.activePlayer(input),
      isCurrentScope: (input) =>
        !!this.find(input) && this.find(input) === this.registry.get(input.matchId, input.playerId),
      validatePrepared: (result) => {
        const g = this.registry.get(result.matchId, result.playerId);
        return (
          !!g &&
          this.registry.isCurrent(g) &&
          g.state === 'PREPARED' &&
          !this.lifecycle.hasLocalRetirement(g) &&
          g.generation === result.receiverGeneration &&
          g.identity === result.grant.mediaIdentity &&
          g.roomName === result.grant.roomName &&
          (g.splitOwnership
            ? result.grant.subscriptionMode === 'server-forwarding' &&
              result.grant.facePublication?.roomName === g.splitOwnership.faceRoomName &&
              result.grant.facePublication?.mediaIdentity === g.splitOwnership.faceIdentity
            : result.grant.facePublication === undefined) &&
          this.canIssue() &&
          result.grant.expiresAt > deps.epochNowSeconds()
        );
      },
      discardPrepared: (_result, input) => {
        const g = this.registry.get(input.matchId, input.playerId);
        if (
          g &&
          g.request.requestId === input.requestId &&
          g.request.mediaInstanceId === input.mediaInstanceId
        )
          return this.rawRetire(this.retirement(g, 'shutdown')).then(() => undefined);
      },
      awaitLocalRetirement: (input, signal) => {
        const g = this.find(input);
        return g && this.registry.wasNeverIssued(g)
          ? Promise.resolve(!signal.aborted)
          : this.lifecycle.awaitLocalRetirement(input, signal);
      },
      onBlocked: (input, code) => {
        const g = this.registry.get(input.matchId, input.playerId);
        if (g) this.emitFailure(g, code);
      },
      onInvalidated: ({ matchId, playerId }, reason) => {
        const g = this.registry.get(matchId, playerId);
        if (g && g.state !== 'REVOKED') this.track(this.rawRetire(this.retirement(g, reason)));
      },
    });
  }

  readonly isInitialized = () => this.initialized && !this.closed && this.runtime.isInitialized();
  readonly canIssue = (): boolean =>
    !this.closed && this.initialized && this.runtime?.canIssue() === true;
  getReadiness() {
    return this.runtime.getReadiness();
  }
  getOperations() {
    return this.runtime.getOperations();
  }
  createOperationsHandlers(authorize: (authorization: string | undefined) => boolean) {
    return createOperationsHandlers({
      authorize,
      operations: this.getOperations(),
      audit: this.audit,
      onAuditFailure: () => this.runtime.lock('AUDIT_WRITE_FAILED'),
    });
  }

  initialize(): Promise<MediaInitializationResult> {
    this.initialization ??= (async () => {
      if (this.closed) return { status: 'fatal' as const, code: 'INITIALIZATION_FAILED' as const };
      const loaded = await loadCapabilityReport({
        ...this.deps.config,
        nowEpochMs: Math.floor(this.deps.epochNowSeconds() * 1000),
      });
      this.capability = loaded.report;
      if (this.closed) return { status: 'fatal' as const, code: 'INITIALIZATION_FAILED' as const };
      const result = await this.runtime.initialize();
      if (result.status === 'initialized' && !this.closed) {
        this.initialized = true;
        this.schedule();
      }
      return result;
    })();
    return this.initialization;
  }

  async prepareGeneration(input: PrepareGenerationRequest): Promise<PreparationResult> {
    const captured = { ...input };
    const old = this.registry.get(input.matchId, input.playerId);
    // A live game connection is separate from the media connection and from aggregate activity.
    if (!this.isInitialized() || !this.canIssue())
      return this.finishPreparation({
        ...captured,
        status: 'rejected',
        receiverGeneration: null,
        grant: null,
        code: 'NOT_READY',
      });
    // Request retries keep the original transition kind/deadline even after current changes.
    let recovery = this.recoveryRequests.get(captured.requestId);
    if (!recovery) {
      const replacing =
        !!old &&
        !this.registry.wasNeverIssued(old) &&
        old.request.mediaInstanceId === captured.mediaInstanceId;
      recovery = {
        matchId: captured.matchId,
        recovery: replacing,
        recoveryStartedAt: replacing
          ? (this.lifecycle.recoveryStartedAt(old) ?? this.deps.monotonicNow())
          : undefined,
      };
      if (!this.recoveryRequests.set(captured.requestId, recovery))
        return this.finishPreparation({
          ...captured,
          status: 'rejected',
          receiverGeneration: null,
          grant: null,
          code: 'NOT_READY',
        });
    }
    const history = recovery;
    const result = await this.transition
      .replace(captured, history)
      .finally(() => this.recoveryRequests.settle(captured.requestId, history));
    if (result.status === 'ready') {
      const generation = this.registry.get(result.matchId, result.playerId);
      const current = () =>
        !this.closed &&
        !!generation &&
        this.registry.isCurrent(generation) &&
        this.activePlayer(captured) &&
        this.canIssue() &&
        !this.lifecycle.hasLocalRetirement(generation) &&
        generation.identity === result.grant.mediaIdentity &&
        result.grant.expiresAt > this.deps.epochNowSeconds();
      if (current() && generation) this.policy.register(generation);
      if (!current()) {
        if (generation && generation.request.requestId === captured.requestId)
          this.track(this.rawRetire(this.retirement(generation, 'shutdown')));
        return this.finishPreparation({
          ...captured,
          status: 'rejected',
          receiverGeneration: null,
          grant: null,
          code: 'STALE_GENERATION',
        });
      }
      const finished = this.finishPreparation(result);
      // Queue adapters may synchronously end participation or close the runtime.
      return current()
        ? finished
        : {
            ...captured,
            status: 'rejected',
            receiverGeneration: null,
            grant: null,
            code: 'STALE_GENERATION',
          };
    }
    return this.finishPreparation(result);
  }

  observeFrame(frame: TrustedMediaFrame): void {
    if (this.closed || !this.registry.observe(frame)) return;
    // S15P21C204-269. An ended runner that the frame lists as a spectator keeps its receiving
    // generation: it hears and sees through its target until the round ends. Its own voice and
    // face are never audible or visible to anyone, because only ACTIVE senders are.
    const spectating = new Set((frame.spectators ?? []).map((link) => link.playerId));
    for (const p of frame.participants) {
      if (!this.registry.isLatestScope(frame.matchId, p.playerId, frame.mediaInstanceId)) continue;
      if (['RESULT', 'ABORTED'].includes(frame.phase))
        this.transition.invalidatePlayer(frame.matchId, p.playerId, 'round-ended');
      else if (p.status !== 'ACTIVE' && !spectating.has(p.playerId))
        this.transition.invalidatePlayer(frame.matchId, p.playerId, 'personal-ended');
    }
    // Only the latest authoritative instance may retire this player's media. A delayed
    // practice RESULT cannot end the new game; an omitted player in the current frame must retire.
    for (const g of this.registry.all()) {
      if (
        g.terminal ||
        g.request.matchId !== frame.matchId ||
        !this.registry.isLatestScope(frame.matchId, g.request.playerId, frame.mediaInstanceId)
      )
        continue;
      const participant = frame.participants.find((p) => p.playerId === g.request.playerId);
      if (!participant)
        this.transition.invalidatePlayer(frame.matchId, g.request.playerId, 'personal-ended');
      else if (
        g.request.mediaInstanceId !== frame.mediaInstanceId ||
        !this.registry.eligible(g.request)
      )
        this.track(this.rawRetire(this.retirement(g, 'phase-change')));
    }
    this.policy.observeFrame(frame);
  }

  releaseMatch(matchId: string): void {
    if (this.closed) return;
    this.registry.endMatch(matchId);
    this.lifecycle.forgetMatch(matchId);
    this.transition.forgetMatch(matchId);
    this.policy.forgetMatch(matchId);
    this.recoveryRequests.forgetCompleted((value) => value.matchId === matchId);
    this.published.forgetCompleted((value) => value.matchId === matchId);
    this.publishedRetirements.forgetCompleted((value) => value.matchId === matchId);
    for (const generation of this.registry.all())
      if (generation.request.matchId === matchId && generation.state !== 'REVOKED')
        this.track(this.rawRetire(this.retirement(generation, 'round-ended')));
  }

  retireGeneration(input: RetireGenerationRequest): Promise<RetirementResult> {
    if (!this.isInitialized())
      return Promise.resolve({ ...input, status: 'unknown', code: 'NOT_READY' });
    return this.transition.retire(input);
  }

  inspectRetention() {
    const registry = this.registry.retained;
    const policy = this.policy.retained;
    return {
      generations: registry.generations,
      activeMatches: registry.openMatches,
      frames: registry.frames,
      playerScopes: registry.players,
      connections: this.lifecycle.retained.connections,
      retiredLocally: this.lifecycle.retained.retired,
      tracks: policy.tracks,
      subscriptions: policy.subscriptions,
      policyFrames: policy.frames,
      policyVersions: policy.versions,
      recoveryRequests: this.recoveryRequests.retained.entries,
      preparationNotifications: this.published.retained.entries,
      retirementNotifications: this.publishedRetirements.retained.entries,
      transitionRequests: this.transition.retained.requests.entries,
      transitionRetirements: this.transition.retained.retirements.entries,
    };
  }

  private pruneCompletedHistory(): void {
    this.pruneGrantRequests();
    this.transition.prune();
    this.currentCleanup.pruneRequestHistory();
    this.recoveryRequests.prune();
    this.published.prune();
    this.publishedRetirements.prune();
    const now = this.deps.epochNowSeconds() * 1000;
    const removed = this.registry.prune(
      (generation) =>
        !this.retirements.has(generation) &&
        ownedMediaRooms(generation).every((roomName) => !this.roomCleanups.has(roomName)) &&
        now - generation.expiresAtEpochMs >= 600_000 &&
        (this.registry.wasNeverIssued(generation) ||
          this.currentCleanup.canForgetGeneration(generation)) &&
        (!this.registry.isMatchOpen(generation.request.matchId) ||
          this.lifecycle.hasLocalRetirement(generation)),
    );
    for (const generation of removed) this.lifecycle.forgetGeneration(generation);
  }

  handleWebhook(rawBody: string, authorization: string) {
    return this.isInitialized()
      ? this.policy.handleWebhook(rawBody, authorization)
      : Promise.resolve({ status: 'ignored' as const });
  }

  reconcile(): Promise<void> {
    if (!this.isInitialized()) return Promise.resolve();
    if (this.maintenance) return this.maintenance;
    this.maintenance = (async () => {
      this.pruneCompletedHistory();
      await this.policy.reconcile();
      if (this.closed) return;
      this.lifecycle.reconcile();
      let connected = 0;
      for (const g of this.registry.all()) {
        if (!this.registry.isCurrent(g)) continue;
        // JWT expiry limits initial admission and cached responses (GrantIssuer), not an
        // already verified live connection: https://docs.livekit.io/frontends/reference/tokens-grants/
        // Unjoined/absent expired generations still retire; connected media requires the
        // existing game/phase/policy checks and a durable, renewable usage lease below.
        const publication = this.policy.inspect(g);
        // 364. What LiveKit bills: a participant it has seen connect and that has not ended.
        if (publication?.participantSid && !publication.terminal) connected += 1;
        if (
          g.expiresAtEpochMs <= this.deps.epochNowSeconds() * 1000 &&
          (!publication?.participantSid ||
            publication.terminal ||
            publication.lastVerifiedAt === null)
        ) {
          this.fail(g, 'TIMEOUT');
          continue;
        }
        if (this.runtime.usageLease.remaining(g) <= 60_000) {
          try {
            const reserved = await this.runtime.usageLease.reserve(g);
            if (!reserved && this.runtime.usageLease.remaining(g) <= 0)
              this.fail(g, 'BUDGET_EXHAUSTED');
          } catch {
            this.runtime.lock('USAGE_RESERVATION_UNCONFIRMED');
            this.fail(g, 'BUDGET_EXHAUSTED');
          }
        }
      }
      this.observeMonthlyUsage(connected);
      // Polling health cannot automatically restore OPEN after an actual lost prerequisite.
      this.getReadiness();
      // Do not hold media policy renewal behind disk compaction. close() drains this writer first.
      void this.durableRetention.run().catch(() => {});
    })()
      .catch(() => {
        this.runtime.lock('READINESS_UNCONFIRMED');
      })
      .finally(() => {
        this.maintenance = null;
      });
    return this.maintenance;
  }

  allowsNewMatch(): boolean {
    try {
      return this.monthly?.allowsNewMatch() ?? true;
    } catch {
      // A meter that cannot answer must not open the gate it exists to close.
      return false;
    }
  }

  monthlyUsage(): MonthlyUsageSnapshot | null {
    return this.monthly?.snapshot() ?? null;
  }

  /** Counts this pass and reports only when the gate opens or closes, not on every pass. */
  private observeMonthlyUsage(connected: number): void {
    if (!this.monthly) return;
    this.monthly.observe(connected);
    const snapshot = this.monthly.snapshot();
    if (snapshot.blocked === this.monthlyBlocked) return;
    this.monthlyBlocked = snapshot.blocked;
    this.event('media.budget.near_limit', snapshot.blocked ? 'warn' : 'info', {
      state: snapshot.blocked ? 'new-matches-stopped' : 'new-matches-open',
      value: snapshot.remainingMinutes,
      limit: snapshot.reserveMinutes,
      unit: 'participant-minutes',
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.monthly?.flush();
    if (this.timer) clearTimeout(this.timer);
    this.transition.close();
    this.lifecycle.close();
    this.policy.close();
    const retirements = this.registry
      .all()
      .filter((g) => g.state !== 'REVOKED')
      .map((g) => this.rawRetire(this.retirement(g, 'shutdown')));
    const retention = this.durableRetention.close();
    this.closing = (async () => {
      const retentionResult = await Promise.allSettled([retention]);
      const runtime = this.runtime.close();
      const pending = await Promise.allSettled([
        runtime,
        ...retirements,
        ...this.active,
        this.maintenance,
      ]);
      const cleanup = await Promise.allSettled([this.currentCleanup.close()]);
      const recovery = await Promise.allSettled([this.recovery.close()]); // Drain journal even on failure.
      this.apiBudget.close();
      this.registry.close();
      if (
        [...retentionResult, ...pending, ...cleanup, ...recovery].some(
          (result) => result.status === 'rejected',
        )
      )
        throw new Error('MEDIA_CLOSE_FAILED');
    })();
    return this.closing;
  }

  private activePlayer(input: PrepareGenerationRequest): boolean {
    return (
      !this.closed &&
      this.registry.eligible(input) &&
      this.transition.isAllowed(input.matchId, input.playerId) &&
      this.lifecycle.isGameConnected(input.matchId, input.playerId) &&
      this.registry
        .all()
        .filter((g) => g.request.playerId === input.playerId && g.request.matchId !== input.matchId)
        .every(
          (g) =>
            this.registry.wasNeverIssued(g) ||
            (this.durablyRevoked(g) &&
              !this.retirements.has(g) &&
              this.lifecycle.hasLocalRetirement(g)),
        )
    );
  }

  private find(input: RetireGenerationRequest) {
    return this.registry
      .all()
      .find(
        (g) =>
          g.request.matchId === input.matchId &&
          g.request.playerId === input.playerId &&
          g.request.mediaInstanceId === input.mediaInstanceId &&
          g.generation === input.receiverGeneration,
      );
  }
  private durablyRevoked(g: Generation): boolean {
    // Issuance checks every older generation. Reuse immutable durable records instead of
    // cloning the complete journal for each one; append/compaction invalidate this view.
    return (
      g.state === 'REVOKED' &&
      this.journal
        .readSnapshot()
        .records.some(
          ({ record }) =>
            record.state === 'REVOKED' &&
            record.identity === g.identity &&
            record.roomName === g.roomName &&
            record.generation === g.generation &&
            record.reservationId === g.reservationId &&
            record.matchId === g.request.matchId &&
            record.mediaInstanceId === g.request.mediaInstanceId &&
            record.serverEpoch === g.serverEpoch &&
            record.namespace === this.deps.config.namespace &&
            record.issuedAtEpochMs === g.issuedAtEpochMs &&
            record.expiresAtEpochMs === g.expiresAtEpochMs &&
            sameMediaOwnership(record, g),
        )
    );
  }
  private cleanupRoom(roomName: string): Promise<void> {
    const existing = this.roomCleanups.get(roomName);
    if (existing) return existing;
    const work = this.cleanupRoomOnce(roomName).finally(() => this.roomCleanups.delete(roomName));
    this.roomCleanups.set(roomName, work);
    return work;
  }
  private async cleanupRoomOnce(roomName: string): Promise<void> {
    const allRevoked = () => {
      const group = this.registry
        .all()
        .filter((g) => ownedMediaRooms(g).includes(roomName) && !this.registry.wasNeverIssued(g));
      return group.length > 0 && group.every((g) => this.durablyRevoked(g));
    };
    if (!allRevoked()) return;
    const context = () => ({
      requestId: randomUUID(),
      deadlineMs: this.deps.monotonicNow() + 1000,
      priority: 'cleanup' as const,
      beforeDispatch: allRevoked,
    });
    // Participant revocation was already proven for every issued identity, including unjoined.
    // Room absence proves only room cleanup; it never substitutes for those revocation ACKs.
    const rooms = await this.gateway.listRooms([roomName], context());
    if (!rooms.some((room) => room.name === roomName)) return;
    await this.gateway.deleteRoom(roomName, context());
    if (
      (await this.gateway.listRooms([roomName], context())).some((room) => room.name === roomName)
    )
      throw new Error('ROOM_CLEANUP_UNCONFIRMED');
  }
  private retirement(
    g: Generation,
    reason: RetireGenerationRequest['reason'],
  ): RetireGenerationRequest {
    return {
      requestId: randomUUID(),
      matchId: g.request.matchId,
      playerId: g.request.playerId,
      mediaInstanceId: g.request.mediaInstanceId,
      receiverGeneration: g.generation,
      reason,
    };
  }

  private rawRetire(input: RetireGenerationRequest): Promise<RetirementResult> {
    const g = this.find(input);
    if (!g) return Promise.resolve({ ...input, status: 'unknown', code: 'STALE_GENERATION' });
    // A definitive pre-signing rejection created no Cloud identity or browser connection.
    // This is local cancellation, not evidence that any issued token was remotely revoked.
    if (this.registry.wasNeverIssued(g))
      return Promise.resolve(this.finishRetirement({ ...input, status: 'confirmed', code: null }));
    const existing = this.retirements.get(g);
    if (existing) return existing.then((result) => this.finishRetirement({ ...result, ...input }));
    const now = this.deps.monotonicNow();
    // Only this first healthy, bounded current-process operation is normal transition work.
    if (g.state === 'PREPARED' && Number.isFinite(now)) this.pendingRetirements.set(g, now + 3000);
    const work = this.currentCleanup.retire(input).finally(() => {
      this.pendingRetirements.delete(g);
      this.retirements.delete(g);
      if (!this.closed) this.getReadiness();
    });
    this.retirements.set(g, work);
    return work.then((result) => this.finishRetirement(result));
  }

  private finishPreparation(result: PreparationResult): PreparationResult {
    const key = JSON.stringify([
      result.requestId,
      result.matchId,
      result.playerId,
      result.mediaInstanceId,
      result.status,
      result.receiverGeneration,
      result.code,
    ]);
    if (this.closed || this.published.has(key)) return result;
    const recorded = { matchId: result.matchId };
    this.published.set(key, recorded);
    this.published.settle(key, recorded);
    try {
      this.deps.enqueueControl({ type: 'MEDIA_PREPARED', result });
    } catch {
      const g = this.registry.get(result.matchId, result.playerId);
      if (g) this.fail(g, 'POLICY_UNKNOWN');
      return {
        requestId: result.requestId,
        matchId: result.matchId,
        playerId: result.playerId,
        mediaInstanceId: result.mediaInstanceId,
        status: 'rejected',
        receiverGeneration: null,
        grant: null,
        code: 'POLICY_UNKNOWN',
      };
    }
    return result;
  }

  /** The four fields a room keys its pendingRetirements by; reason and request id are not part of it. */
  private retirementScope(
    scope:
      | Generation
      | Readonly<{
          matchId: string;
          mediaInstanceId: string;
          playerId: string;
          receiverGeneration: number;
        }>,
  ): string {
    const value =
      'request' in scope
        ? {
            matchId: scope.request.matchId,
            mediaInstanceId: scope.request.mediaInstanceId,
            playerId: scope.request.playerId,
            receiverGeneration: scope.generation,
          }
        : scope;
    return JSON.stringify([
      value.matchId,
      value.mediaInstanceId,
      value.playerId,
      value.receiverGeneration,
    ]);
  }

  private finishRetirement(result: RetirementResult): RetirementResult {
    const scope = this.retirementScope(result);
    if (result.status === 'confirmed') this.unconfirmedRetirements.delete(scope);
    else this.unconfirmedRetirements.add(scope);
    const key = JSON.stringify([
      result.requestId,
      result.matchId,
      result.playerId,
      result.mediaInstanceId,
      result.receiverGeneration,
      result.reason,
      result.status,
      result.code,
    ]);
    if (!this.closed && !this.publishedRetirements.has(key)) {
      const recorded = { matchId: result.matchId };
      this.publishedRetirements.set(key, recorded);
      this.publishedRetirements.settle(key, recorded);
      try {
        this.deps.enqueueControl({ type: 'MEDIA_RETIRED', result });
      } catch {
        this.runtime.lock('READINESS_UNCONFIRMED');
      }
    }
    return result;
  }

  private fail(g: Generation, code: MediaFailureCode): void {
    if (this.closed || this.registry.get(g.request.matchId, g.request.playerId) !== g) return;
    this.transition.invalidatePlayer(
      g.request.matchId,
      g.request.playerId,
      code === 'POLICY_UNKNOWN' ? 'policy-unknown' : 'connection-lost',
    );
    this.emitFailure(g, code);
    if (code === 'POLICY_UNKNOWN') this.runtime.lock('READINESS_UNCONFIRMED');
  }
  private emitFailure(g: Generation, code: MediaFailureCode): void {
    const failures = this.failures.get(g) ?? new Set<MediaFailureCode>();
    if (failures.has(code) || this.closed) return;
    failures.add(code);
    this.failures.set(g, failures);
    this.event('media.prepare_failed', 'warn', { generation: g.generation, code });
    try {
      this.deps.enqueueControl({
        type: 'MEDIA_FAILED',
        eventId: randomUUID(),
        matchId: g.request.matchId,
        mediaInstanceId: g.request.mediaInstanceId,
        playerId: g.request.playerId,
        receiverGeneration: g.generation,
        code,
      });
    } catch {
      this.runtime.lock('READINESS_UNCONFIRMED');
    }
  }
  private track(work: Promise<unknown>): void {
    this.active.add(work);
    void work
      .finally(() => this.active.delete(work))
      .catch(() => {
        this.runtime.lock('READINESS_UNCONFIRMED');
      });
  }
  private event(
    event: StructuredEvent['event'],
    level: StructuredEvent['level'],
    fields: NonNullable<StructuredEvent['fields']>,
  ): void {
    try {
      this.deps.emitEvent?.({ event, level, atMs: this.deps.monotonicNow(), fields });
    } catch {
      /* Observer only. */
    }
  }
  private metric(name: string): void {
    try {
      this.deps.emitMetric({ name, value: 1, unit: 'count', atMs: this.deps.monotonicNow() });
    } catch {
      /* Observer only. */
    }
  }
  private schedule(): void {
    if (this.closed) return;
    this.timer = setTimeout(() => {
      void this.reconcile().finally(() => this.schedule());
    }, 250);
    this.timer.unref();
  }
}

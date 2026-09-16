/**
 * Product `kkakkung` room (protocol 0.2.0). Single assembly point for the server phase
 * machine: LOBBY → DEVICE_CHECK → TEAM_PRACTICE → MAP_FINALIZING → GAME_LOADING → COUNTDOWN →
 * PLAYING → RESULT/ABORTED → (rematch) → LOBBY. Message callbacks, leave handlers and media
 * promises only enqueue; the coordinator-driven `tick()` is the only writer of authoritative
 * state. The public schema carries round metadata; every participant receives an allowlisted
 * private view for their own logical scope.
 *
 * The authoritative rules (A core), map preparation (A), media coordination (E) and runtime
 * configuration (F) are injected. When a producer has not arrived the room stops at the last
 * phase it can serve and records `blockedReason` instead of faking progress.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import {
  DEMO_SCENARIO_IDS,
  PRODUCT_CLIENT_MESSAGES,
  PRODUCT_SERVER_MESSAGES,
  ROOM_EXPIRED_CLOSE_CODE,
  ROOM_REMOVED_CLOSE_CODE,
  demoScenarioRequestSchema,
  productJoinOptionsSchema,
  requestStatusSchema,
  type AudioPolicy,
  type CommandCode,
  type CommandEnvelope,
  type CommandOutcome,
  type CommandReceipt,
  type DemoStateMessage,
  type MediaBindings,
  type MediaStatusReport,
} from '@kkakkung/protocol/game-messages';
import {
  PublicMatchState,
  RoundResultState,
  type Cell,
  type LoadingView,
  type Phase,
  type Role,
} from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import { toProductCommand } from '../game/CommandAdapter.js';
import { CommandLimiter } from '../game/CommandLimiter.js';
import { CommandQueue, type LedgerEntry } from '../game/CommandQueue.js';
import { ClockSync } from '../game/ClockSync.js';
import { EventDispatcher, type PrivateViewBody } from '../game/EventDispatcher.js';
import { HeartbeatTracker } from '../game/Heartbeat.js';
import type { LayoutLoader } from '../game/LayoutLoader.js';
import { MatchContext } from '../game/MatchContext.js';
import { MatchDriver } from '../game/MatchDriver.js';
import { projectPrivateBody } from '../game/PlayerProjection.js';
import type { RoomTickCoordinator } from '../game/RoomTickCoordinator.js';
import type {
  CorePort,
  EmitMetric,
  MatchTuning,
  MediaControl,
  ProductMediaRuntime,
  PrepareGenerationRequest,
  PreparationResult,
  RetireGenerationRequest,
  MediaIntent,
  OutcomeResult,
  PracticeLayoutPort,
  Topology,
} from '../game/ports.js';
import type { ProductSessionStore } from '../session/ProductSessionStore.js';
import type { RoomExpiry } from '../session/RoomExpiry.js';
import type { SessionAuth } from '../session/session-types.js';
import type { SlotRegistry } from '../session/SlotRegistry.js';
import { CountdownCoordinator } from './CountdownCoordinator.js';
import {
  availableScenarios,
  createDemoRunner,
  type DemoExit,
  type DemoScenario,
  type DemoWorld,
} from './DemoScenarios.js';
import { LoadingCoordinator } from './LoadingCoordinator.js';
import { LobbyCoordinator } from './LobbyCoordinator.js';
import { PracticeCoordinator } from './PracticeCoordinator.js';
import { RematchCoordinator } from './RematchCoordinator.js';
import { preparationIssue } from './preparation-issue.js';
import type { StructuredEvent } from '../observability/StructuredEvents.js';

const MAP_FINALIZING_TIMEOUT_MS = 30_000;
/** S15P21C204-258. Puppets filling the other five seats of a demo room. */
const DEMO_PUPPET_COUNT = 5;
import type { ProductRoomHandle, RoomDirectory } from './RoomDirectory.js';

export type ProductRoomDeps<State> = Readonly<{
  serverEpoch: string;
  monotonicNow: () => number;
  sessions: ProductSessionStore;
  slots: SlotRegistry;
  directory: RoomDirectory;
  coordinator: RoomTickCoordinator;
  roomExpiry: RoomExpiry;
  /** A's core facade; null until A-09 arrives. */
  core: CorePort<State> | null;
  /** A's tuning; null until A provides server/config/tuning. */
  tuning: MatchTuning | null;
  /** A's practice layout port and the parsed server-only practice-v1 raw JSON. */
  practice: { port: PracticeLayoutPort; raw: unknown } | null;
  /** B loader assembled with A's map ports and F's content paths. */
  layouts: {
    loader: LayoutLoader;
    masterPath: string;
    fallbackPath: string;
    templateId: string;
    templateVersion: string;
  } | null;
  /** E's coordinator; null means media disabled (loading barrier checks client reports only). */
  media: ProductMediaRuntime | null;
  /**
   * S15P21C204-259. Reads the match's active exits for a demo scenario. Only the demo room calls
   * it, and a deployment without demo rooms can leave it out.
   */
  demoExits?: (state: State) => readonly DemoExit[];
  /** Start cells of the match: the rules refuse a device there, so a scenario avoids them. */
  demoStartCells?: (state: State) => readonly Cell[];
  canStart?: () => boolean;
  strictProduct?: boolean;
  assetVersion: string;
  emitMetric?: EmitMetric;
  random?: () => number;
  onInvalidateRoom?: (roomCode: string) => void;
  /**
   * F structured event sink (observability/StructuredEvents). Phase changes, preparation
   * failures and rejected preparation commands are written here with counts and codes only,
   * so a "미로를 준비하고 있어요" failure on real devices can be explained from the server log.
   */
  emitEvent?: (event: StructuredEvent) => void;
}>;

type PendingLayout =
  | { status: 'selected'; layout: import('../game/ports.js').MatchLayout }
  | { status: 'unavailable'; diagnostic: string };

const ACTIVE_CORE_PHASES: readonly Phase[] = ['TEAM_PRACTICE', 'PLAYING'];
/** Phases with a match in progress: a server-side tick fault must abort them, not resume. */
const ABORTABLE_PHASES: readonly Phase[] = [
  'TEAM_PRACTICE',
  'MAP_FINALIZING',
  'GAME_LOADING',
  'COUNTDOWN',
  'PLAYING',
];

export function createKkakkungRoom<State>(deps: ProductRoomDeps<State>) {
  const random = deps.random ?? Math.random;

  class KkakkungRoom extends Room<{ state: PublicMatchState }> implements ProductRoomHandle {
    maxClients = 6;
    maxMessagesPerSecond = 120;
    state = new PublicMatchState();
    roomCode = '';
    phase: Phase = 'LOBBY';
    blockedReason: string | null = null;
    private readonly context = new MatchContext({ serverEpoch: deps.serverEpoch });
    private readonly queue = new CommandQueue();
    private readonly limiter = new CommandLimiter();
    private readonly inboundLimiter = new CommandLimiter({ capacity: 90, refillPerSecond: 45 });
    private closing = false;
    private readonly heartbeat = new HeartbeatTracker({ serverEpoch: deps.serverEpoch });
    private readonly clockSync = new ClockSync({
      serverEpoch: deps.serverEpoch,
      now: deps.monotonicNow,
    });
    private readonly lobby = new LobbyCoordinator({ random });
    private readonly practice = new PracticeCoordinator();
    private readonly loading = new LoadingCoordinator({ requireFace: () => this.media !== null });
    private readonly countdown = new CountdownCoordinator();
    private readonly rematch = new RematchCoordinator();
    private readonly clientsByPlayer = new Map<string, Client>();
    private readonly playersByConnection = new Map<string, SessionAuth>();
    private readonly roles = new Map<string, Role>();
    private readonly mediaInstances = new Map<string, string>();
    private readonly playerGenerations = new Map<
      string,
      { mediaInstanceId: string; receiverGeneration: number }
    >();
    private readonly seenMediaRequests = new Set<string>();
    private readonly seenMediaEvents = new Set<string>();
    private readonly lastBindings = new Map<string, MediaBindings>();
    private readonly refreshAt = new Map<string, number>();
    private readonly pendingRetirements = new Map<string, RetireGenerationRequest>();
    private readonly confirmedRetirements = new Set<string>();
    private readonly grantRequests = new Map<string, PrepareGenerationRequest>();
    private readonly pendingPreparations = new Map<string, number>();
    private readonly preparingPlayers = new Map<string, number>();
    private readonly queuedPreparations = new Map<string, string>();
    private readonly uncertainPreparations = new Set<string>();
    private readonly retiringScopes = new Map<
      string,
      { mediaInstanceId: string; receiverGeneration: number }
    >();
    private readonly pendingBindings: { playerId: string; message: MediaBindings }[] = [];
    private readonly pendingAudio: { playerId: string; message: AudioPolicy }[] = [];
    private readonly observedMediaInstances = new Set<string>();
    private readonly mediaFrameWaiters = new Map<string, Set<(observed: boolean) => void>>();
    private layoutRevision = 0;
    private disposed = false;
    private finalizing: Promise<void> | null = null;
    private pendingLayout: PendingLayout | null = null;
    private startRequestedTick: number | null = null;
    private abortReason: PublicMatchState['abortReason'] | null = null;
    private readonly dispatcher: EventDispatcher;
    private readonly driver: MatchDriver<State>;
    /** S15P21C204-258. Set for a demo room: the operator's role, with five puppets filling 3:3. */
    private operatorRole: Role | null = null;
    private readonly puppets = new Set<string>();
    private readonly demoRunner = createDemoRunner();
    private puppetSequence = 0;
    private demoStateSent: string | null = null;

    /** A demo room exists to show game situations to one operator, never to admit players. */
    private get demo() {
      return this.operatorRole !== null;
    }

    /** Demo rooms take no media: puppets have no camera and nothing is published for them. */
    private get media() {
      return this.demo ? null : deps.media;
    }

    constructor() {
      super();
      this.dispatcher = new EventDispatcher({
        context: this.context,
        now: deps.monotonicNow,
        sender: {
          sendView: (playerId, view) =>
            this.clientsByPlayer.get(playerId)?.send(PRODUCT_SERVER_MESSAGES.privateView, view),
          sendEvent: (playerId, event) =>
            this.clientsByPlayer.get(playerId)?.send(PRODUCT_SERVER_MESSAGES.privateEvent, event),
          sendOutcome: (playerId, outcome) =>
            this.clientsByPlayer
              .get(playerId)
              ?.send(PRODUCT_SERVER_MESSAGES.commandOutcome, outcome),
          sendStatus: (playerId, status) =>
            this.clientsByPlayer
              .get(playerId)
              ?.send(PRODUCT_SERVER_MESSAGES.requestStatusResult, status),
        },
        viewBody: (playerId) => this.viewBody(playerId),
      });
      this.driver = new MatchDriver<State>({
        core: deps.core ?? unavailableCore<State>(),
        context: this.context,
        queue: this.queue,
        now: deps.monotonicNow,
        handlePhaseCommand: (entry, tick) => this.handlePhaseCommand(entry, tick),
        onStateCommitted: (instance) => {
          for (const playerId of this.context.membersOf(instance.gameInstanceId))
            this.dispatcher.publishView(playerId, 'change', this.phase);
        },
        stateVersionFor: (actorId) => this.dispatcher.applicableVersion(actorId),
        onOutcome: (actorId, outcome) => this.sendOutcome(actorId, outcome),
        onEvent: (event, gameInstanceId) => this.dispatcher.dispatchEvent(event, gameInstanceId),
        onMediaFrame: (frame) => {
          this.media?.observeFrame(frame);
          this.observedMediaInstances.add(frame.mediaInstanceId);
          this.settleMediaFrameWaiters(frame.mediaInstanceId, true);
        },
        onMediaIntent: (intent, gameInstanceId) => this.handleMediaIntent(intent, gameInstanceId),
        onIntegrityFailure: (gameInstanceId, reason) =>
          this.abortMatch(null, `INTEGRITY:${gameInstanceId}:${reason}`),
      });
    }

    // ---- ProductRoomHandle ----

    get matchId() {
      return this.context.matchId;
    }

    canManageInvitations(playerId: string): boolean {
      return (
        !this.closing &&
        !this.disposed &&
        (this.phase === 'LOBBY' || this.phase === 'DEVICE_CHECK') &&
        playerId === this.lobby.host &&
        this.clientsByPlayer.has(playerId)
      );
    }

    mediaScopeFor(playerId: string, purpose: 'practice' | 'game') {
      if (!this.clientsByPlayer.has(playerId)) return null;
      const instance = this.context.instanceOf(playerId);
      if (!instance || instance.kind !== purpose) return null;
      const attached = this.driver.instance(instance.gameInstanceId);
      if (!attached || deps.core?.getPlayerSelf(attached.state, playerId)?.status !== 'ACTIVE')
        return null;
      const mediaInstanceId = this.mediaInstances.get(instance.gameInstanceId);
      return mediaInstanceId ? { mediaInstanceId, gameInstanceId: instance.gameInstanceId } : null;
    }

    async requestMediaGrant(
      playerId: string,
      purpose: 'practice' | 'game',
      previousGeneration: number | null,
    ): Promise<PreparationResult | null> {
      const scope = this.mediaScopeFor(playerId, purpose);
      if (!scope || !this.media || (deps.canStart && !deps.canStart())) return null;
      this.pendingPreparations.set(
        scope.mediaInstanceId,
        (this.pendingPreparations.get(scope.mediaInstanceId) ?? 0) + 1,
      );
      this.preparingPlayers.set(playerId, (this.preparingPlayers.get(playerId) ?? 0) + 1);
      try {
        return await this.prepareMediaGrant(playerId, purpose, previousGeneration, scope);
      } finally {
        const remaining = (this.pendingPreparations.get(scope.mediaInstanceId) ?? 1) - 1;
        if (remaining === 0) this.pendingPreparations.delete(scope.mediaInstanceId);
        else this.pendingPreparations.set(scope.mediaInstanceId, remaining);
        const playerRemaining = (this.preparingPlayers.get(playerId) ?? 1) - 1;
        if (playerRemaining === 0) this.preparingPlayers.delete(playerId);
        else this.preparingPlayers.set(playerId, playerRemaining);
        this.releaseRetiredSeat(playerId);
        this.finishDisposedRoom();
      }
    }

    private async prepareMediaGrant(
      playerId: string,
      purpose: 'practice' | 'game',
      previousGeneration: number | null,
      scope: { mediaInstanceId: string },
    ): Promise<PreparationResult | null> {
      if (!this.media) return null;
      const matchId = this.matchId;
      if (!(await this.waitForMediaFrame(scope.mediaInstanceId))) return null;
      if (
        this.disposed ||
        matchId !== this.matchId ||
        this.mediaScopeFor(playerId, purpose)?.mediaInstanceId !== scope.mediaInstanceId
      )
        return null;
      let request = this.grantRequests.get(playerId);
      const current = this.playerGenerations.get(playerId);
      if (request?.mediaInstanceId !== scope.mediaInstanceId) request = undefined;
      if (!request || previousGeneration !== request.expectedPreviousGeneration) {
        if (previousGeneration !== (current?.receiverGeneration ?? null)) return null;
        request = {
          requestId: randomUUID(),
          matchId: this.context.matchId,
          mediaInstanceId: scope.mediaInstanceId,
          playerId,
          purpose,
          expectedPreviousGeneration: current?.receiverGeneration ?? null,
        };
        this.grantRequests.set(playerId, request);
      }
      let result: PreparationResult;
      try {
        result = await this.media.prepareGeneration(request);
      } catch {
        // An unclassified producer failure may have allocated a generation. Do not infer a
        // reusable previous cursor or let the practice transition silently pass this request.
        result = {
          ...request,
          status: 'rejected',
          receiverGeneration: null,
          grant: null,
          code: 'TIMEOUT',
        };
      }
      const active = this.mediaScopeFor(playerId, purpose);
      if (
        this.disposed ||
        request.matchId !== this.matchId ||
        active?.mediaInstanceId !== request.mediaInstanceId
      ) {
        this.retireOrphanPreparation(result);
        return null;
      }
      this.queuedPreparations.set(result.requestId, playerId);
      this.enqueueMediaControl({ type: 'MEDIA_PREPARED', result });
      return result;
    }

    acceptMediaReport(playerId: string, report: MediaStatusReport): boolean {
      if (
        !this.media?.lifecycle ||
        report.matchId !== this.matchId ||
        !this.clientsByPlayer.has(playerId)
      )
        return false;
      const current = this.playerGenerations.get(playerId);
      const retiring = this.retiringScopes.get(playerId);
      const instance = this.context.instanceOf(playerId);
      const activeInstanceId = instance
        ? this.mediaInstances.get(instance.gameInstanceId)
        : undefined;
      const matches = (scope: typeof current) =>
        scope?.mediaInstanceId === report.mediaInstanceId &&
        scope.receiverGeneration === report.receiverGeneration;
      // The HTTP response can reach D before the next B tick applies MEDIA_PREPARED.
      // E's lifecycle validates the exact issued generation in this trusted current instance.
      if (
        activeInstanceId !== report.mediaInstanceId &&
        !(report.status === 'closed' && (matches(current) || matches(retiring)))
      )
        return false;
      return this.media.lifecycle.report({ ...report, playerId });
    }

    enqueueMediaControl(control: MediaControl) {
      if (this.disposed) {
        if (control.type === 'MEDIA_RETIRED' || control.type === 'MEDIA_PREPARED')
          this.applyMediaControl(control);
        this.finishDisposedRoom();
        return;
      }
      this.driver.enqueueMediaControl(control);
    }

    deliverBindings(playerId: string, message: MediaBindings) {
      this.pendingBindings.push({ playerId, message });
    }

    private applyBindings(playerId: string, message: MediaBindings) {
      const current = this.playerGenerations.get(playerId);
      const instance = this.context.instanceOf(playerId);
      if (
        message.matchId !== this.matchId ||
        !instance ||
        this.mediaInstances.get(instance.gameInstanceId) !== message.mediaInstanceId ||
        current?.mediaInstanceId !== message.mediaInstanceId ||
        current.receiverGeneration !== message.receiverGeneration
      )
        return;
      this.lastBindings.set(playerId, message);
      this.clientsByPlayer.get(playerId)?.send(PRODUCT_SERVER_MESSAGES.mediaBindings, message);
      const self = message.participants.find((p) => p.playerId === playerId);
      if (self && self.publisherGeneration === message.receiverGeneration)
        this.loading.confirmSelfFace(
          playerId,
          message.mediaInstanceId,
          message.receiverGeneration,
          self.faceTrackSid,
        );
    }

    deliverAudioPolicy(playerId: string, message: AudioPolicy) {
      this.pendingAudio.push({ playerId, message });
    }

    // ---- Colyseus lifecycle ----

    static async onAuth(_token: string, options: unknown, _context: AuthContext) {
      if (deps.strictProduct && !deps.canStart?.()) throw new ServerError(503, 'NOT_READY');
      const parsed = productJoinOptionsSchema.safeParse(options);
      if (!parsed.success) throw new ServerError(400, 'INVALID_JOIN');
      if (parsed.data.protocolVersion !== PRODUCT_PROTOCOL_VERSION)
        throw new ServerError(409, 'PROTOCOL_MISMATCH');
      const auth = deps.sessions.authenticate(parsed.data.token);
      if (!auth) throw new ServerError(401, 'INVALID_SESSION');
      if (auth.roomCode !== parsed.data.roomCode) throw new ServerError(403, 'WRONG_ROOM');
      const slot = deps.slots.slotState(auth.roomCode, auth.playerId);
      if (!slot || slot === 'RETIRING') throw new ServerError(403, 'ROOM_CLOSED');
      if (slot === 'RESERVED' && !deps.slots.canJoin(auth.roomCode))
        throw new ServerError(403, 'ROOM_CLOSED');
      const phase = deps.slots.phaseOf(auth.roomCode);
      if (phase !== null && phase !== 'LOBBY' && phase !== 'DEVICE_CHECK' && slot !== 'JOINED')
        throw new ServerError(403, 'ROOM_CLOSED');
      if (deps.sessions.activeConnection(auth.sessionId) !== null)
        throw new ServerError(409, 'SESSION_IN_USE');
      return auth;
    }

    onCreate(options: unknown) {
      const roomCode =
        typeof options === 'object' && options !== null
          ? (options as { roomCode?: unknown }).roomCode
          : undefined;
      if (typeof roomCode !== 'string' || !deps.slots.hasRoom(roomCode))
        throw new ServerError(404, 'ROOM_NOT_AVAILABLE');
      this.roomCode = roomCode;
      // How the room was opened belongs to the seat registry; the room never invents it.
      const roomOptions = deps.slots.optionsOf(roomCode);
      if (!roomOptions) throw new ServerError(404, 'ROOM_NOT_AVAILABLE');
      this.operatorRole = roomOptions.operatorRole;
      this.maxClients = roomOptions.capacity;
      this.autoDispose = true;
      this.patchRate = 50;
      this.syncPublic();
      const onInbound = (type: string, handle: (client: Client, payload: unknown) => void) =>
        this.onMessage(type, (client, payload: unknown) => {
          if (this.closing || !this.inboundLimiter.allow(client.sessionId, deps.monotonicNow()))
            return;
          handle(client, payload);
        });
      onInbound(PRODUCT_CLIENT_MESSAGES.command, (client, payload: unknown) =>
        this.onCommand(client, payload),
      );
      onInbound(PRODUCT_CLIENT_MESSAGES.requestStatus, (client, payload: unknown) =>
        this.onRequestStatus(client, payload),
      );
      onInbound(PRODUCT_CLIENT_MESSAGES.viewResync, (client, payload: unknown) => {
        const auth = this.playersByConnection.get(client.sessionId);
        if (auth) this.dispatcher.handleResync(auth.playerId, payload, this.phase);
      });
      onInbound(PRODUCT_CLIENT_MESSAGES.demoScenario, (client, payload: unknown) => {
        const auth = this.playersByConnection.get(client.sessionId);
        const parsed = demoScenarioRequestSchema.safeParse(payload);
        if (!auth || !parsed.success || parsed.data.matchId !== this.context.matchId) return;
        this.startDemoScenario(auth.playerId, parsed.data.scenario);
      });
      onInbound(PRODUCT_CLIENT_MESSAGES.heartbeatAck, (client, payload: unknown) => {
        this.heartbeat.ack(client.sessionId, payload, this.context.matchId, deps.monotonicNow());
      });
      onInbound(PRODUCT_CLIENT_MESSAGES.clockProbe, (client, payload: unknown) => {
        const result = this.clockSync.handle(client.sessionId, payload);
        if (result.status === 'reply')
          client.send(PRODUCT_SERVER_MESSAGES.clockReply, result.reply);
      });
      onInbound(PRODUCT_CLIENT_MESSAGES.mediaBindingsRefresh, (client) => {
        const auth = this.playersByConnection.get(client.sessionId);
        if (!auth) return;
        const now = deps.monotonicNow();
        const last = this.refreshAt.get(auth.playerId);
        if (last !== undefined && now - last < 1000) return;
        this.refreshAt.set(auth.playerId, now);
        const bindings = this.lastBindings.get(auth.playerId);
        if (bindings) client.send(PRODUCT_SERVER_MESSAGES.mediaBindings, bindings);
      });
      onInbound('*', () => undefined);
      deps.coordinator.register(this.roomId, {
        onTick: () => this.tick(),
        onOverload: (lagMs) => this.overload(lagMs),
        onTickFailed: (error) => this.tickFailed(error),
      });
      deps.directory.register(this);
    }

    onJoin(client: Client, _options: unknown, auth: SessionAuth) {
      if (this.closing) throw new ServerError(403, 'ROOM_CLOSED');
      if (deps.strictProduct && !deps.canStart?.()) throw new ServerError(503, 'NOT_READY');
      const now = deps.monotonicNow();
      if (!auth || auth.roomCode !== this.roomCode) throw new ServerError(403, 'WRONG_ROOM');
      if (this.phase !== 'LOBBY' && this.phase !== 'DEVICE_CHECK')
        throw new ServerError(403, 'ROOM_CLOSED');
      if (this.clientsByPlayer.has(auth.playerId)) throw new ServerError(409, 'SESSION_IN_USE');
      const claim = deps.sessions.claimConnection(auth.sessionId, client.sessionId);
      if (claim !== 'claimed')
        throw new ServerError(
          claim === 'busy' ? 409 : 401,
          claim === 'busy' ? 'SESSION_IN_USE' : 'INVALID_SESSION',
        );
      if (!deps.slots.markJoined(this.roomCode, auth.playerId, now)) {
        deps.sessions.releaseConnection(auth.sessionId, client.sessionId);
        throw new ServerError(403, 'ROOM_CLOSED');
      }
      this.clientsByPlayer.set(auth.playerId, client);
      this.playersByConnection.set(client.sessionId, auth);
      this.media?.lifecycle?.setGameConnection({
        matchId: this.matchId,
        playerId: auth.playerId,
        connected: true,
      });
      const joinOrder =
        deps.slots.joinOrder(this.roomCode, auth.playerId) ?? this.lobby.list().length;
      this.lobby.add(auth.playerId, auth.nickname, joinOrder);
      if (this.demo && this.puppets.size === 0) this.addPuppets(auth.playerId);
      this.heartbeat.register(client.sessionId, auth.playerId, now);
      this.broadcastRoster();
      this.dispatcher.publishView(auth.playerId, 'initial', this.phase);
      // The operator needs the scenario list before the match starts, not only while it runs.
      if (this.demo) {
        this.demoStateSent = null;
        this.publishDemoState();
      }
      this.evaluateWaiting();
      this.syncPublic();
    }

    onLeave(client: Client) {
      this.removeConnection(client);
    }

    private removeConnection(client: Client, heartbeatLost = false) {
      const auth = this.playersByConnection.get(client.sessionId);
      this.playersByConnection.delete(client.sessionId);
      this.limiter.forget(client.sessionId);
      this.inboundLimiter.forget(client.sessionId);
      this.clockSync.forget(client.sessionId);
      const control = this.heartbeat.close(client.sessionId);
      if (!auth) return;
      deps.sessions.releaseConnection(auth.sessionId, client.sessionId);
      this.clientsByPlayer.delete(auth.playerId);
      this.lobby.setConnected(auth.playerId, false);
      if (control || heartbeatLost) this.handleConnectionLost(auth.playerId);
      if (this.phase === 'LOBBY' || this.phase === 'DEVICE_CHECK') {
        this.lobby.remove(auth.playerId);
        this.queue.forgetActor(auth.playerId);
        this.dispatcher.forget(auth.playerId);
        deps.sessions.invalidate(auth.sessionId);
        this.releaseSeat(auth.playerId, 'connection-lost');
        this.evaluateWaiting();
      }
      this.broadcastRoster();
      this.syncPublic();
    }

    onDispose() {
      this.disposed = true;
      deps.slots.beginClose(this.roomCode);
      this.invalidateLayout();
      for (const control of this.driver.drainMediaControls()) this.applyMediaControl(control);
      this.media?.releaseMatch?.(this.matchId);
      for (const mediaInstanceId of this.mediaFrameWaiters.keys())
        this.settleMediaFrameWaiters(mediaInstanceId, false);
      deps.coordinator.unregister(this.roomId);
      // Retiring seats keep a callback target until E confirms the remote boundary.
      if (!this.hasUnresolvedMedia()) deps.directory.unregister(this.roomCode, this);
      deps.sessions.invalidateRoom(this.roomCode);
      for (const member of deps.slots.members(this.roomCode))
        deps.slots.release(this.roomCode, member.playerId, {
          confirmedRetirement: !this.hasUnresolvedMedia(member.playerId),
        });
      deps.slots.closeRoom(this.roomCode);
      deps.onInvalidateRoom?.(this.roomCode);
    }

    // ---- Message handlers: enqueue only ----

    private onCommand(client: Client, payload: unknown) {
      if (this.closing) return;
      const auth = this.playersByConnection.get(client.sessionId);
      if (!auth) return;
      const now = deps.monotonicNow();
      const parsed = toProductCommand(payload, { currentMatchId: this.context.matchId });
      if (parsed.status === 'rejected')
        return this.sendReceipt(client, {
          ...parsed.correlation,
          status: 'rejected',
          code: parsed.code,
        });
      const command = parsed.command;
      const correlation = {
        matchId: command.matchId,
        requestId: command.requestId,
        sequence: command.sequence,
      };
      if (!this.limiter.allow(client.sessionId, now))
        return this.sendReceipt(client, {
          ...correlation,
          status: 'rejected',
          code: 'RATE_LIMITED',
        });
      const gate = this.acceptanceGate(parsed.kind, command.type, auth.playerId);
      if (gate) {
        this.logPreparationRejection(command.type, gate, 'gate');
        return this.sendReceipt(client, { ...correlation, status: 'rejected', code: gate });
      }
      const instance = parsed.kind === 'core' ? this.context.instanceOf(auth.playerId) : null;
      const accepted = this.queue.accept({
        actorId: auth.playerId,
        command,
        gameInstanceId: instance?.gameInstanceId ?? null,
        nowMs: now,
        stateVersion: this.dispatcher.applicableVersion(auth.playerId),
      });
      if (accepted.status === 'rejected') {
        this.logPreparationRejection(command.type, accepted.code, 'queue');
        return this.sendReceipt(client, {
          ...correlation,
          status: 'rejected',
          code: accepted.code,
        });
      }
      deps.sessions.touch(auth.sessionId);
      client.send(PRODUCT_SERVER_MESSAGES.commandResult, accepted.receipt);
      if (accepted.status === 'duplicate' && accepted.outcome)
        client.send(PRODUCT_SERVER_MESSAGES.commandOutcome, accepted.outcome);
    }

    /** Rejections of the commands that gate a match start are worth a log line each. */
    private logPreparationRejection(type: string, code: string, stage: 'gate' | 'queue') {
      if (!['READY', 'PRACTICE_READY', 'LOAD_READY', 'REMATCH'].includes(type)) return;
      this.emitEvent('room.command_rejected', 'warn', {
        command: type,
        phase: this.phase,
        code,
        stage,
      });
    }

    private acceptanceGate(
      kind: 'core' | 'phase',
      type: string,
      playerId: string,
    ): CommandCode | null {
      if (kind === 'core') {
        if (!ACTIVE_CORE_PHASES.includes(this.phase)) return 'INVALID_PHASE';
        return this.context.instanceOf(playerId) ? null : 'NOT_ACTIVE';
      }
      const allowed: Record<string, readonly Phase[]> = {
        READY: ['DEVICE_CHECK'],
        ROOM_LOCK: ['LOBBY', 'DEVICE_CHECK'],
        ROOM_KICK: ['LOBBY', 'DEVICE_CHECK'],
        PRACTICE_READY: ['TEAM_PRACTICE'],
        LOAD_READY: ['GAME_LOADING'],
        REMATCH: ['RESULT', 'ABORTED'],
      };
      if (!allowed[type]?.includes(this.phase)) return 'INVALID_PHASE';
      if ((type === 'ROOM_LOCK' || type === 'ROOM_KICK') && playerId !== this.lobby.host)
        return 'NOT_ALLOWED';
      return null;
    }

    private sendReceipt(
      client: Client,
      receipt: CommandReceipt | (Omit<CommandReceipt, 'stateVersion'> & { stateVersion?: number }),
    ) {
      const auth = this.playersByConnection.get(client.sessionId);
      client.send(PRODUCT_SERVER_MESSAGES.commandResult, {
        ...receipt,
        stateVersion:
          receipt.stateVersion ??
          (auth ? this.dispatcher.applicableVersion(auth.playerId) : this.context.stateVersion),
      });
    }

    private onRequestStatus(client: Client, payload: unknown) {
      if (this.closing) return;
      const auth = this.playersByConnection.get(client.sessionId);
      if (!auth) return;
      const parsed = requestStatusSchema.safeParse(payload);
      if (!parsed.success) return;
      this.dispatcher.sendStatus(
        auth.playerId,
        this.queue.status(auth.playerId, parsed.data.matchId, parsed.data.requestId),
      );
    }

    private sendOutcome(actorId: string, outcome: CommandOutcome) {
      this.dispatcher.sendOutcome(actorId, outcome);
    }

    // ---- Phase commands (run inside the driver's serial tick) ----

    private handlePhaseCommand(entry: LedgerEntry, _tick: number): OutcomeResult {
      const command = entry.command;
      switch (command.type) {
        case 'ROOM_LOCK':
        case 'ROOM_KICK': {
          // Recheck at execution: the host or phase may have changed since acceptance.
          if (!['LOBBY', 'DEVICE_CHECK'].includes(this.phase))
            return { result: 'rejected', code: 'INVALID_PHASE' };
          if (entry.actorId !== this.lobby.host || !this.clientsByPlayer.has(entry.actorId))
            return { result: 'rejected', code: 'NOT_ALLOWED' };
          if (command.type === 'ROOM_LOCK') {
            this.setWaitingLock(command.payload.locked);
          } else {
            const target = this.clientsByPlayer.get(command.payload.targetPlayerId);
            if (!target || command.payload.targetPlayerId === entry.actorId)
              return { result: 'rejected', code: 'NOT_ALLOWED' };
            // Close the entry race before removing the participant. The host can reopen it.
            this.setWaitingLock(true);
            this.removeConnection(target);
            target.leave(ROOM_REMOVED_CLOSE_CODE, 'REMOVED_BY_HOST');
          }
          this.broadcastRoster();
          return { result: 'applied', code: null };
        }
        case 'READY': {
          const result = this.lobby.applyReady(entry.actorId, command.payload.ready, this.phase);
          if (result.result === 'applied') this.broadcastRoster();
          return result;
        }
        case 'PRACTICE_READY':
          return this.phase === 'TEAM_PRACTICE'
            ? this.practice.applyPracticeReady(entry.actorId, command.payload.ready)
            : { result: 'rejected', code: 'INVALID_PHASE' };
        case 'LOAD_READY': {
          const result =
            this.phase === 'GAME_LOADING'
              ? this.loading.applyLoadReady(entry.actorId, command.payload)
              : { result: 'rejected' as const, code: 'INVALID_PHASE' as const };
          if (result.result === 'rejected')
            this.emitEvent('room.command_rejected', 'warn', {
              command: 'LOAD_READY',
              phase: this.phase,
              code: result.code,
              stage: 'apply',
            });
          else {
            const summary = this.loading.summary();
            this.emitEvent('room.load_ready', 'info', {
              phase: this.phase,
              reported: summary?.reported ?? null,
              faceConfirmed: summary?.faceConfirmed ?? null,
              total: summary?.total ?? null,
            });
          }
          return result;
        }
        case 'REMATCH': {
          const decision = this.rematch.apply({
            actorId: entry.actorId,
            hostId: this.lobby.host,
            phase: this.phase,
            mode: command.payload.mode,
            currentRoles: this.roles,
            remainingPlayers: this.lobby
              .list()
              .filter((p) => p.connected)
              .map((p) => p.playerId),
          });
          return decision.result === 'applied'
            ? { result: 'applied', code: null }
            : { result: decision.result, code: decision.code };
        }
        default:
          return { result: 'rejected', code: 'INVALID_COMMAND' };
      }
    }

    private setWaitingLock(locked: boolean) {
      if (!deps.slots.setJoinLocked(this.roomCode, locked)) return;
      if (!locked) return;
      // Invalidate grants issued before the lock, including onAuth -> onJoin races.
      // Joined and remotely retiring seats retain their existing lifetimes.
      for (const member of deps.slots.members(this.roomCode)) {
        if (member.state !== 'RESERVED') continue;
        const session = deps.sessions.getByPlayer(member.playerId);
        if (session) deps.sessions.invalidate(session.sessionId);
        deps.slots.release(this.roomCode, member.playerId);
      }
    }

    // ---- Tick ----

    tick() {
      if (this.disposed || this.closing) return;
      const now = deps.monotonicNow();
      for (const { connectionId, heartbeat } of this.heartbeat.due(
        now,
        this.context.matchId,
        this.context.serverTick,
      )) {
        const auth = this.playersByConnection.get(connectionId);
        if (auth)
          this.clientsByPlayer
            .get(auth.playerId)
            ?.send(PRODUCT_SERVER_MESSAGES.heartbeat, heartbeat);
      }
      for (const control of this.heartbeat.sweep(now)) {
        if (control.type !== 'CONNECTION_LOST') continue;
        const client = this.clientsByPlayer.get(control.playerId);
        if (!client) continue;
        // Clean up synchronously before this tick evaluates readiness. A later onLeave is safe.
        this.removeConnection(client, true);
        client.leave(4000, 'HEARTBEAT_TIMEOUT');
      }
      for (const control of this.driver.drainMediaControls()) this.applyMediaControl(control);
      for (const { playerId, message } of this.pendingBindings.splice(0))
        this.applyBindings(playerId, message);
      for (const { playerId, message } of this.pendingAudio.splice(0)) {
        const current = this.playerGenerations.get(playerId);
        const instance = this.context.instanceOf(playerId);
        if (
          message.matchId === this.matchId &&
          instance &&
          this.mediaInstances.get(instance.gameInstanceId) === message.mediaInstanceId &&
          current?.mediaInstanceId === message.mediaInstanceId &&
          current.receiverGeneration === message.receiverGeneration
        )
          this.clientsByPlayer.get(playerId)?.send(PRODUCT_SERVER_MESSAGES.audioPolicy, message);
      }
      this.driver.tick();
      // The scenario reads the state this tick produced and queues puppet commands for the next.
      if (this.demo) this.advanceDemo();
      if (this.phase !== 'ABORTED' && this.phase !== 'RESULT' && deps.core) {
        const aborted = this.driver
          .attached()
          .map((instance) => deps.core!.getFrame(instance.state))
          .find((frame) => frame.abortReason !== null);
        if (aborted?.abortReason) this.abortMatch(aborted.abortReason, 'CORE_ABORT');
      }
      this.advancePhase(now);
      this.checkExpiry(now);
      this.syncPublic();
    }

    private advancePhase(now: number) {
      switch (this.phase) {
        case 'LOBBY':
        case 'DEVICE_CHECK':
          this.evaluateWaiting();
          return;
        case 'TEAM_PRACTICE': {
          const members = this.lobby
            .list()
            .filter((p) => p.connected)
            .map((p) => p.playerId);
          const verdict = this.practice.evaluate(now, members);
          if (verdict === 'continue') return;
          if (this.media) {
            const pending = this.hasPendingPreparations();
            const prepared = members.every((playerId) => {
              const scope = this.mediaScopeFor(playerId, 'practice');
              return (
                scope &&
                this.playerGenerations.get(playerId)?.mediaInstanceId === scope.mediaInstanceId
              );
            });
            // PRACTICE_READY can precede the first grant HTTP request. In addition to settled
            // promises, require each current practice generation to be committed by this tick.
            // Never await inside the tick or extend the original practice deadline.
            if (pending || !prepared) {
              if (!this.practice.expired(now)) return;
              if (pending) this.abortMatch('MEDIA_UNAVAILABLE', 'MEDIA_PREPARE_TIMEOUT');
              else this.returnToDeviceCheck('PRACTICE_MEDIA_NOT_READY');
              return;
            }
          }
          const next =
            verdict === 'end-all-ready'
              ? 'to-map-finalizing'
              : this.practice.next(members, (id) => this.lobby.isReady(id));
          this.endPractice(next);
          return;
        }
        case 'MAP_FINALIZING': {
          const startedAt = deps.slots.phaseStartedAt(this.roomCode);
          if (startedAt !== null && now - startedAt >= MAP_FINALIZING_TIMEOUT_MS) {
            this.abortMatch(
              this.hasUnresolvedMedia() ? 'MEDIA_UNAVAILABLE' : null,
              'MAP_FINALIZING_TIMEOUT',
            );
            return;
          }
          if (this.hasUnresolvedMedia()) return;
          if (!this.finalizing) this.startFinalizing();
          if (this.pendingLayout) {
            const result = this.pendingLayout;
            this.pendingLayout = null;
            this.finalizing = null;
            if (result.status === 'selected') this.startLoading(result.layout, now);
            else this.returnToDeviceCheck(`LAYOUT:${result.diagnostic}`);
          }
          return;
        }
        case 'GAME_LOADING': {
          const verdict = this.loading.evaluate(now);
          if (verdict === 'complete') this.startCountdown(now);
          else if (verdict === 'timeout') this.returnToDeviceCheck('LOADING_TIMEOUT');
          return;
        }
        case 'COUNTDOWN': {
          const game = this.gameInstance();
          if (!game) return;
          if (this.countdown.due(now)) {
            this.startRequestedTick = this.context.serverTick + 1;
            this.driver.enqueueControl(game.gameInstanceId, {
              type: 'START_PLAYING',
              startTick: this.startRequestedTick,
            });
            return;
          }
          const frame = this.driver.instance(game.gameInstanceId);
          if (frame && this.startRequestedTick !== null && deps.core && deps.tuning) {
            const view = deps.core.getFrame(frame.state);
            if (view.phase === 'PLAYING') {
              this.context.fixStart(this.startRequestedTick, deps.tuning.roundTicks);
              this.setPhase('PLAYING');
            }
          }
          return;
        }
        case 'PLAYING': {
          const game = this.gameInstance();
          const attached = game ? this.driver.instance(game.gameInstanceId) : null;
          if (!attached || !deps.core) return;
          const frame = deps.core.getFrame(attached.state);
          if (frame.abortReason) this.abortMatch(frame.abortReason, 'CORE_ABORT');
          else if (frame.result || frame.phase === 'RESULT') this.finishMatch();
          return;
        }
        case 'RESULT':
        case 'ABORTED': {
          const request = this.rematch.pending;
          if (
            request &&
            this.rematch.canStart({ mediaRetirementConfirmed: !this.hasUnresolvedMedia() })
          )
            this.startNewRound();
          return;
        }
      }
    }

    private evaluateWaiting() {
      const verdict = this.lobby.evaluate(this.phase);
      if (verdict === 'to-device-check') this.setPhase('DEVICE_CHECK');
      else if (verdict === 'to-lobby') {
        this.lobby.clearReady();
        this.setPhase('LOBBY');
      } else if (verdict === 'all-ready') this.startPractice();
    }

    // ---- Phase transitions ----

    /**
     * S15P21C204-258. Fills the other five places of a demo room with server-owned puppets and
     * fixes the 3:3 assignment around the operator's chosen role. Puppets hold no seat and no
     * session: they exist as participants so the real match rules have someone to act on. Their
     * roster entries carry a neutral name, so the roster still never reveals a role.
     */
    private addPuppets(operatorId: string) {
      if (!this.operatorRole) return;
      for (let index = 0; index < DEMO_PUPPET_COUNT; index++) {
        const playerId = `demo-puppet-${index + 1}`;
        this.puppets.add(playerId);
        // A high join order keeps the operator as host and first in the roster.
        this.lobby.add(playerId, `인형 ${index + 1}`, 100 + index);
        this.lobby.markSystemReady(playerId);
      }
      this.context.setRolePlan(this.puppetRolePlan(operatorId));
    }

    /** The 3:3 assignment around the operator's chosen role; puppets fill the rest in order. */
    private puppetRolePlan(operatorId: string): Map<string, Role> | null {
      const role = this.operatorRole;
      if (!role) return null;
      const plan = new Map<string, Role>([[operatorId, role]]);
      const remaining = { runner: role === 'runner' ? 2 : 3, tagger: role === 'tagger' ? 2 : 3 };
      for (const playerId of this.puppets) {
        const puppetRole: Role = remaining.runner > 0 ? 'runner' : 'tagger';
        remaining[puppetRole] -= 1;
        plan.set(playerId, puppetRole);
      }
      return plan;
    }

    /** The one participant of a demo room that is not a puppet, or null before anyone joined. */
    private operatorId(): string | null {
      return this.lobby.list().find((p) => !this.puppets.has(p.playerId))?.playerId ?? null;
    }

    /**
     * S15P21C204-259. Runs one tick of the current demo scenario. Puppet commands go through the
     * same queue as any client command, so the rules judge them exactly the same way.
     */
    private advanceDemo() {
      const world = this.demoWorld();
      if (!world) {
        // The round ended under a running scenario: its steps have nothing left to act on.
        if (this.demoRunner.status.scenario !== null) {
          this.demoRunner.stop();
          this.publishDemoState();
        }
        return;
      }
      this.demoRunner.advance(world, {
        send: (actor, command) =>
          this.enqueuePuppetCommand(actor, command as Pick<CommandEnvelope, 'type' | 'payload'>),
        drop: (actor) => this.dropPuppet(actor),
      });
      this.publishDemoState(world);
    }

    /**
     * Treats a puppet as if its socket died: the same control the heartbeat raises for a silent
     * client, so the rules abort the match with GAME_CONNECTION_LOST and nothing else changes.
     * The puppet keeps its roster place, so a rematch fills the room again.
     */
    private dropPuppet(playerId: string): boolean {
      if (!this.puppets.has(playerId)) return false;
      const instance = this.context.instanceOf(playerId);
      if (!instance) return false;
      this.driver.enqueueControl(instance.gameInstanceId, { type: 'CONNECTION_LOST', playerId });
      return true;
    }

    /** The world a scenario reads: positions from the core frame, exits from the demo reader. */
    private demoWorld(): DemoWorld | null {
      const instance = this.gameInstance();
      const attached = instance ? this.driver.instance(instance.gameInstanceId) : null;
      if (!attached || !deps.core || this.phase !== 'PLAYING') return null;
      const frame = deps.core.getFrame(attached.state);
      const operatorId = [...this.roles.keys()].find((playerId) => !this.puppets.has(playerId));
      if (!operatorId) return null;
      const challenges: Record<string, string> = {};
      const exchanges: Record<string, string> = {};
      for (const playerId of this.puppets) {
        const self = deps.core.getPlayerSelf(attached.state, playerId);
        if (self?.status !== 'ACTIVE') continue;
        if (self.challenge) challenges[playerId] = self.challenge.challengeId;
        if (self.exchange) exchanges[playerId] = self.exchange.exchangeId;
      }
      return {
        tick: frame.tick,
        topology: attached.topology,
        participants: frame.participants,
        exits: deps.demoExits?.(attached.state) ?? [],
        startCells: deps.demoStartCells?.(attached.state) ?? [],
        challenges,
        exchanges,
        operatorId,
        puppetIds: [...this.puppets],
      };
    }

    /** Accepts a scenario request from the operator of a demo room. */
    private startDemoScenario(playerId: string, scenario: DemoScenario) {
      if (!this.demo || this.puppets.has(playerId)) return;
      const world = this.demoWorld();
      if (!world || world.operatorId !== playerId) return;
      this.demoRunner.start(scenario, world);
      this.publishDemoState(world);
    }

    /**
     * Before the match the whole list is offered; during it only what the operator's role and
     * the puppets still alive can carry out, so a button never asks for a scenario that fails.
     */
    private publishDemoState(world: DemoWorld | null = null) {
      const status = this.demoRunner.status;
      const message: DemoStateMessage = {
        matchId: this.context.matchId,
        available: world ? availableScenarios(world) : [...DEMO_SCENARIO_IDS],
        running: status.scenario,
        step: status.step,
        failure: status.failure,
      };
      const fingerprint = JSON.stringify(message);
      if (fingerprint === this.demoStateSent) return;
      this.demoStateSent = fingerprint;
      for (const [playerId, client] of this.clientsByPlayer)
        if (!this.puppets.has(playerId)) client.send(PRODUCT_SERVER_MESSAGES.demoState, message);
    }

    /**
     * A puppet command enters the ordinary queue with a server-made envelope. The wire never
     * carries it: no client can pretend to be a puppet, because puppets hold no session.
     */
    private enqueuePuppetCommand(
      playerId: string,
      input: Pick<CommandEnvelope, 'type' | 'payload'>,
    ): boolean {
      if (!this.puppets.has(playerId) || this.closing) return false;
      const command = {
        matchId: this.context.matchId,
        requestId: randomUUID(),
        sequence: ++this.puppetSequence,
        ...input,
      } as CommandEnvelope;
      const parsed = toProductCommand(command, { currentMatchId: this.context.matchId });
      if (parsed.status !== 'accepted') return false;
      if (this.acceptanceGate(parsed.kind, command.type, playerId)) return false;
      const instance = parsed.kind === 'core' ? this.context.instanceOf(playerId) : null;
      const accepted = this.queue.accept({
        actorId: playerId,
        command,
        gameInstanceId: instance?.gameInstanceId ?? null,
        nowMs: deps.monotonicNow(),
        stateVersion: this.dispatcher.applicableVersion(playerId),
      });
      return accepted.status === 'accepted';
    }

    /** Reports a puppet is ready for whatever the room is currently waiting on. */
    private settlePuppets() {
      for (const playerId of this.puppets) {
        this.lobby.markSystemReady(playerId);
        if (this.phase === 'TEAM_PRACTICE') this.practice.applyPracticeReady(playerId, true);
        const barrier = this.loading.current;
        if (this.phase === 'GAME_LOADING' && barrier)
          this.loading.applyLoadReady(playerId, {
            loadId: barrier.loadId,
            mediaInstanceId: barrier.mediaInstanceId,
            receiverGeneration: this.loading.receiverGeneration(playerId) ?? 0,
          });
      }
    }

    private startPractice() {
      if (deps.canStart && !deps.canStart()) {
        this.blockedReason = 'NOT_READY';
        return;
      }
      const now = deps.monotonicNow();
      if (!deps.core || !deps.practice || !deps.tuning) {
        this.blockedReason = 'PRACTICE_PRODUCER_MISSING';
        return;
      }
      const roles = this.lobby.assignRoles(this.context.takeRolePlan());
      this.roles.clear();
      for (const [playerId, role] of roles) this.roles.set(playerId, role);
      if (this.context.seed === null)
        this.context.fixRoundInputs({ tuning: deps.tuning, seed: randomBytes(4).readUInt32BE(0) });
      const teams = this.practice.start(roles, now);
      for (const role of ['runner', 'tagger'] as const) {
        const players = teams[role].map((playerId) => ({ playerId, role }));
        if (players.length === 0) continue;
        const prepared = deps.practice.port.preparePracticeLayout(deps.practice.raw, players, role);
        if (prepared.status !== 'ready') {
          this.practice.stop();
          this.returnToDeviceCheck(`PRACTICE_LAYOUT:${prepared.path.join('.')}`);
          return;
        }
        const instance = this.context.createInstance('practice', role);
        const state = deps.core.createPractice({
          matchId: this.context.matchId,
          gameInstanceId: instance.gameInstanceId,
          seed: this.context.seed ?? 0,
          tuning: deps.tuning,
          layout: prepared.layout,
          players,
          role,
        });
        const mediaInstanceId = this.media ? randomUUID() : null;
        if (mediaInstanceId) this.mediaInstances.set(instance.gameInstanceId, mediaInstanceId);
        this.driver.attach({
          gameInstanceId: instance.gameInstanceId,
          kind: 'practice',
          state,
          topology: prepared.layout.topology,
          mediaInstanceId,
        });
        for (const { playerId } of players)
          this.context.enterInstance(playerId, instance.gameInstanceId);
      }
      this.blockedReason = null;
      this.setPhase('TEAM_PRACTICE');
      // Puppets report their practice readiness at once; only the operator is waited for.
      this.settlePuppets();
    }

    private endPractice(next: 'to-map-finalizing' | 'to-device-check') {
      for (const instance of this.driver.attached().filter((i) => i.kind === 'practice'))
        this.retireInstance(instance.gameInstanceId, 'phase-change');
      this.practice.stop();
      if (next === 'to-map-finalizing') this.setPhase('MAP_FINALIZING');
      else this.setPhase('DEVICE_CHECK');
    }

    private startFinalizing() {
      if (!deps.layouts || !deps.core || !deps.tuning) {
        this.finalizing = Promise.resolve();
        this.pendingLayout = { status: 'unavailable', diagnostic: 'LAYOUT_PRODUCER_MISSING' };
        return;
      }
      const players = [...this.roles.entries()].map(([playerId, role]) => ({ playerId, role }));
      const seed = this.context.seed ?? 0;
      const { loader, masterPath, fallbackPath, templateId, templateVersion } = deps.layouts;
      const revision = ++this.layoutRevision;
      const matchId = this.matchId;
      this.finalizing = loader
        .prepare({ masterPath, fallbackPath, templateId, templateVersion, players, seed })
        .then((result) => {
          if (
            this.disposed ||
            revision !== this.layoutRevision ||
            matchId !== this.matchId ||
            this.phase !== 'MAP_FINALIZING'
          )
            return;
          this.pendingLayout =
            result.status === 'selected'
              ? { status: 'selected', layout: result.layout.layout }
              : { status: 'unavailable', diagnostic: result.diagnostic };
        })
        .catch(() => {
          if (
            this.disposed ||
            revision !== this.layoutRevision ||
            matchId !== this.matchId ||
            this.phase !== 'MAP_FINALIZING'
          )
            return;
          this.pendingLayout = { status: 'unavailable', diagnostic: 'LOADER_THREW' };
        });
    }

    private startLoading(layout: import('../game/ports.js').MatchLayout, now: number) {
      if (!deps.core || !deps.tuning) return this.returnToDeviceCheck('CORE_MISSING');
      const players = [...this.roles.entries()].map(([playerId, role]) => ({ playerId, role }));
      const instance = this.context.createInstance('game');
      const state = deps.core.createMatch({
        matchId: this.context.matchId,
        gameInstanceId: instance.gameInstanceId,
        seed: this.context.seed ?? 0,
        tuning: deps.tuning,
        layout,
        players,
      });
      const mediaInstanceId = randomUUID();
      this.mediaInstances.set(instance.gameInstanceId, mediaInstanceId);
      this.driver.attach({
        gameInstanceId: instance.gameInstanceId,
        kind: 'game',
        state,
        topology: layout.topology,
        mediaInstanceId: this.media ? mediaInstanceId : null,
      });
      const playerIds = players.map((p) => p.playerId);
      this.loading.open({ loadId: randomUUID(), mediaInstanceId, playerIds, nowMs: now });
      for (const playerId of playerIds) {
        this.context.enterInstance(playerId, instance.gameInstanceId);
        if (!this.media) this.loading.setReceiverGeneration(playerId, mediaInstanceId, 0);
        // The authenticated HTTP request starts or reuses this player's generation request.
      }
      this.setPhase('GAME_LOADING');
      this.settlePuppets();
    }

    private startCountdown(now: number) {
      if (deps.canStart && !deps.canStart()) return;
      const barrier = this.loading.current;
      if (!barrier) return;
      const startAt = this.countdown.arm(barrier.loadId, now);
      if (startAt === null) return;
      this.context.scheduleStart(startAt);
      this.setPhase('COUNTDOWN');
    }

    private finishMatch() {
      this.driver.cancelAllPending('ROUND_ENDED');
      this.setPhase('RESULT');
    }

    private emitEvent(
      event: StructuredEvent['event'],
      level: StructuredEvent['level'],
      fields: NonNullable<StructuredEvent['fields']>,
    ) {
      try {
        deps.emitEvent?.({
          event,
          level,
          atMs: deps.monotonicNow(),
          fields: { roomRef: this.roomCode, ...fields },
        });
      } catch {
        // Diagnostics never change the room outcome.
      }
    }

    private reportPreparationFailure(
      outcome: 'ABORTED' | 'DEVICE_CHECK',
      diagnostic: string,
      abortReason: string | null,
    ) {
      const loading = this.loading.summary();
      this.emitEvent('room.preparation_failed', 'warn', {
        phase: this.phase,
        outcome,
        reason: diagnostic,
        code: abortReason,
        total: loading?.total ?? null,
        reported: loading?.reported ?? null,
        faceConfirmed: loading?.faceConfirmed ?? null,
        unresolvedMedia: this.hasUnresolvedMedia(),
        count: this.clientsByPlayer.size,
      });
    }

    private abortMatch(reason: PublicMatchState['abortReason'] | null, diagnostic: string) {
      this.reportPreparationFailure('ABORTED', diagnostic, reason);
      this.invalidateLayout();
      this.blockedReason = diagnostic;
      this.abortReason = reason;
      this.driver.cancelAllPending('ROUND_ENDED');
      for (const instance of this.driver.attached())
        this.retireInstance(instance.gameInstanceId, 'aborted');
      this.loading.invalidate();
      this.countdown.cancel();
      this.practice.stop();
      this.setPhase('ABORTED');
    }

    private returnToDeviceCheck(diagnostic: string) {
      // Retiring an instance while an allocation is unresolved can hide E's newest cursor.
      // A fresh match is required for this exceptional path; ordinary device retries remain.
      if (this.hasPendingPreparations()) {
        this.abortMatch('MEDIA_UNAVAILABLE', diagnostic);
        return;
      }
      this.reportPreparationFailure('DEVICE_CHECK', diagnostic, null);
      this.invalidateLayout();
      this.blockedReason = diagnostic;
      this.lobby.clearReady();
      for (const instance of this.driver.attached())
        this.retireInstance(instance.gameInstanceId, 'phase-change');
      this.loading.invalidate();
      this.countdown.cancel();
      this.finalizing = null;
      this.pendingLayout = null;
      this.setPhase('DEVICE_CHECK');
    }

    private retireInstance(
      gameInstanceId: string,
      reason: 'phase-change' | 'aborted' | 'round-ended',
    ) {
      this.driver.detach(gameInstanceId, reason === 'round-ended' ? 'ROUND_ENDED' : 'CANCELED');
      const members = this.context.retireInstance(gameInstanceId);
      const mediaInstanceId = this.mediaInstances.get(gameInstanceId);
      this.mediaInstances.delete(gameInstanceId);
      if (mediaInstanceId) {
        this.observedMediaInstances.delete(mediaInstanceId);
        this.settleMediaFrameWaiters(mediaInstanceId, false);
      }
      for (const playerId of members) {
        this.dispatcher.publishView(playerId, 'scope', this.phase);
        if (mediaInstanceId && this.media) this.retireGeneration(playerId, mediaInstanceId, reason);
      }
    }

    private retireGeneration(
      playerId: string,
      mediaInstanceId: string,
      reason: 'phase-change' | 'aborted' | 'round-ended' | 'connection-lost' | 'personal-ended',
    ) {
      const generation = this.playerGenerations.get(playerId);
      if (!this.media || !generation || generation.mediaInstanceId !== mediaInstanceId) return;
      this.retireKnownGeneration(
        {
          matchId: this.context.matchId,
          mediaInstanceId,
          receiverGeneration: generation.receiverGeneration,
          playerId,
        },
        reason === 'aborted' ? 'phase-change' : reason,
      );
    }

    private generationKey(scope: {
      matchId: string;
      mediaInstanceId: string;
      playerId: string;
      receiverGeneration: number;
    }) {
      return JSON.stringify([
        scope.matchId,
        scope.mediaInstanceId,
        scope.playerId,
        scope.receiverGeneration,
      ]);
    }

    private retireKnownGeneration(
      scope: Omit<RetireGenerationRequest, 'requestId' | 'reason'>,
      reason: RetireGenerationRequest['reason'],
    ) {
      if (!this.media) return;
      const key = this.generationKey(scope);
      if (this.confirmedRetirements.has(key) || this.pendingRetirements.has(key)) return;
      const request: RetireGenerationRequest = { ...scope, requestId: randomUUID(), reason };
      this.pendingRetirements.set(key, request);
      this.retiringScopes.set(scope.playerId, scope);
      this.media
        .retireGeneration(request)
        .then((result) => this.enqueueMediaControl({ type: 'MEDIA_RETIRED', result }))
        .catch(() =>
          this.enqueueMediaControl({
            type: 'MEDIA_RETIRED',
            result: { ...request, status: 'unknown', code: 'TIMEOUT' },
          }),
        );
    }

    private retireOrphanPreparation(result: PreparationResult) {
      if (result.receiverGeneration !== null) {
        this.retireKnownGeneration(
          {
            matchId: result.matchId,
            mediaInstanceId: result.mediaInstanceId,
            playerId: result.playerId,
            receiverGeneration: result.receiverGeneration,
          },
          this.disposed ? 'shutdown' : 'connection-lost',
        );
      } else if (
        result.code === 'TIMEOUT' ||
        result.code === 'RETIREMENT_UNCONFIRMED' ||
        result.code === 'POLICY_UNKNOWN' ||
        result.code === 'REMOTE_UNAVAILABLE'
      ) {
        // A failed producer may have allocated remotely without returning a cursor.
        this.uncertainPreparations.add(result.playerId);
      }
      this.releaseRetiredSeat(result.playerId);
    }

    private hasUnresolvedMedia(playerId?: string) {
      const matches = (id: string) => playerId === undefined || id === playerId;
      return (
        [...this.pendingRetirements.values()].some((scope) => matches(scope.playerId)) ||
        [...this.preparingPlayers.keys()].some(matches) ||
        [...this.queuedPreparations.values()].some(matches) ||
        [...this.uncertainPreparations].some(matches)
      );
    }

    private releaseRetiredSeat(playerId: string) {
      if (this.clientsByPlayer.has(playerId) || this.hasUnresolvedMedia(playerId)) return;
      if (deps.slots.slotState(this.roomCode, playerId) === 'RETIRING')
        deps.slots.release(this.roomCode, playerId, { confirmedRetirement: true });
    }

    private finishDisposedRoom() {
      if (!this.disposed || this.hasUnresolvedMedia()) return;
      deps.directory.unregister(this.roomCode, this);
      deps.slots.closeRoom(this.roomCode);
    }

    private startNewRound() {
      if (this.hasUnresolvedMedia()) return;
      this.invalidateLayout();
      const request = this.rematch.take();
      const now = deps.monotonicNow();
      for (const instance of this.driver.attached())
        this.retireInstance(instance.gameInstanceId, 'round-ended');
      this.driver.cancelAllPending('ROUND_ENDED');
      this.media?.releaseMatch?.(this.matchId);
      this.context.startNewRound();
      this.queue.reset();
      this.heartbeat.resetForMatch(now);
      this.dispatcher.resetForMatch();
      this.lobby.clearReady();
      this.roles.clear();
      // A demo room's "back to lobby" rematch still keeps the operator's chosen role: a random
      // draw could hand the operator a role the scenario list was not made for.
      const operatorId = this.demo ? this.operatorId() : null;
      this.context.setRolePlan(
        request?.plan ?? (operatorId ? this.puppetRolePlan(operatorId) : null),
      );
      this.loading.invalidate();
      this.countdown.cancel();
      this.practice.stop();
      this.startRequestedTick = null;
      this.abortReason = null;
      this.blockedReason = null;
      this.seenMediaRequests.clear();
      this.seenMediaEvents.clear();
      this.playerGenerations.clear();
      this.grantRequests.clear();
      this.retiringScopes.clear();
      this.confirmedRetirements.clear();
      this.pendingBindings.length = 0;
      this.pendingAudio.length = 0;
      this.lastBindings.clear();
      this.phase = 'LOBBY';
      this.context.bumpVersion();
      deps.slots.setPhase(this.roomCode, 'LOBBY', now);
      deps.coordinator.rearm(this.roomId);
      this.syncPublic();
      this.broadcastRoster();
      for (const playerId of this.clientsByPlayer.keys()) {
        this.media?.lifecycle?.setGameConnection({
          matchId: this.matchId,
          playerId,
          connected: true,
        });
        this.dispatcher.publishView(playerId, 'initial', this.phase);
      }
      // Puppets have no client to report READY again; the operator alone gates the next round.
      if (this.demo) {
        this.demoRunner.stop();
        this.settlePuppets();
        this.publishDemoState();
      }
      this.evaluateWaiting();
    }

    private setPhase(next: Phase) {
      if (this.phase === next) return;
      this.emitEvent('room.phase', 'info', {
        phase: next,
        stage: this.phase,
        count: this.clientsByPlayer.size,
      });
      this.phase = next;
      if (next !== 'ABORTED') this.abortReason = null;
      this.context.bumpVersion();
      deps.slots.setPhase(this.roomCode, next, deps.monotonicNow());
      this.syncPublic();
      this.broadcastRoster();
      for (const playerId of this.clientsByPlayer.keys())
        this.dispatcher.publishView(playerId, 'phase', next);
    }

    // ---- Media controls (applied in the serial tick) ----

    private applyMediaControl(control: MediaControl) {
      if (control.type === 'MEDIA_PREPARED') {
        const { result } = control;
        this.queuedPreparations.delete(result.requestId);
        const request = this.grantRequests.get(result.playerId);
        if (
          (this.seenMediaRequests.has(result.requestId) && result.status === 'ready') ||
          result.matchId !== this.context.matchId ||
          request?.requestId !== result.requestId
        )
          return;
        const active = this.mediaScopeFor(result.playerId, request.purpose);
        if (this.disposed || active?.mediaInstanceId !== result.mediaInstanceId) {
          this.retireOrphanPreparation(result);
          return;
        }
        if (result.status === 'ready') {
          this.seenMediaRequests.add(result.requestId);
          this.playerGenerations.set(result.playerId, {
            mediaInstanceId: result.mediaInstanceId,
            receiverGeneration: result.receiverGeneration,
          });
          this.loading.setReceiverGeneration(
            result.playerId,
            result.mediaInstanceId,
            result.receiverGeneration,
          );
          this.dispatcher.publishView(result.playerId, 'change', this.phase);
        } else {
          // E can reject after allocation/retirement. Preserve any returned metadata for
          // cleanup, but never turn a failed/unknown preparation into a same-match retry.
          if (result.receiverGeneration !== null)
            this.playerGenerations.set(result.playerId, {
              mediaInstanceId: result.mediaInstanceId,
              receiverGeneration: result.receiverGeneration,
            });
          this.abortMatch('MEDIA_UNAVAILABLE', `MEDIA_PREPARE:${result.code}`);
        }
      } else if (control.type === 'MEDIA_RETIRED') {
        const { result } = control;
        const key = this.generationKey(result);
        if (!this.pendingRetirements.has(key)) return;
        if (result.status === 'confirmed') {
          this.pendingRetirements.delete(key);
          this.confirmedRetirements.add(key);
          this.releaseRetiredSeat(result.playerId);
        }
      } else if (control.type === 'MEDIA_FAILED') {
        // Practice instances are already detached here. A failure for their pending
        // retirement still belongs to this transition, but must never release its barrier.
        if (
          this.phase === 'MAP_FINALIZING' &&
          control.matchId === this.matchId &&
          this.pendingRetirements.has(this.generationKey(control))
        ) {
          this.abortMatch(
            control.code === 'POLICY_UNKNOWN' ? 'MEDIA_POLICY_UNCERTAIN' : 'MEDIA_UNAVAILABLE',
            `MEDIA_FINALIZING:${control.code}`,
          );
          return;
        }
        const current = this.playerGenerations.get(control.playerId);
        const instance = this.context.instanceOf(control.playerId);
        if (
          control.matchId !== this.matchId ||
          !instance ||
          this.mediaInstances.get(instance.gameInstanceId) !== control.mediaInstanceId ||
          current?.mediaInstanceId !== control.mediaInstanceId ||
          current.receiverGeneration !== control.receiverGeneration
        )
          return;
        if (this.seenMediaEvents.has(control.eventId)) return;
        this.seenMediaEvents.add(control.eventId);
        if (this.phase === 'PLAYING' || this.phase === 'COUNTDOWN') {
          const game = this.gameInstance();
          if (game)
            this.driver.enqueueControl(game.gameInstanceId, {
              type: 'ABORT_MATCH',
              reason:
                control.code === 'POLICY_UNKNOWN' ? 'MEDIA_POLICY_UNCERTAIN' : 'MEDIA_UNAVAILABLE',
            });
        } else if (this.phase === 'GAME_LOADING' || this.phase === 'TEAM_PRACTICE')
          this.abortMatch('MEDIA_UNAVAILABLE', `MEDIA_FAILED:${control.code}`);
      }
    }

    private handleMediaIntent(intent: MediaIntent, gameInstanceId: string) {
      const mediaInstanceId = this.mediaInstances.get(gameInstanceId);
      if (!mediaInstanceId || !this.media) return;
      if (intent.type === 'RETIRE_PLAYER')
        this.retireGeneration(intent.playerId, mediaInstanceId, intent.reason);
      else
        for (const playerId of this.context.membersOf(gameInstanceId))
          this.retireGeneration(playerId, mediaInstanceId, intent.reason);
    }

    private handleConnectionLost(playerId: string) {
      this.media?.lifecycle?.setGameConnection({
        matchId: this.matchId,
        playerId,
        connected: false,
      });
      const instance = this.context.instanceOf(playerId);
      if (instance)
        this.driver.enqueueControl(instance.gameInstanceId, { type: 'CONNECTION_LOST', playerId });
      const mediaInstanceId = instance
        ? this.mediaInstances.get(instance.gameInstanceId)
        : undefined;
      if (mediaInstanceId && this.media) {
        this.retireGeneration(playerId, mediaInstanceId, 'connection-lost');
      }
      if (this.hasUnresolvedMedia(playerId)) deps.slots.markRetiring(this.roomCode, playerId);
      else deps.slots.release(this.roomCode, playerId, { confirmedRetirement: true });
    }

    private releaseSeat(playerId: string, _reason: 'connection-lost') {
      if (deps.slots.slotState(this.roomCode, playerId) === 'RETIRING') return;
      deps.slots.release(this.roomCode, playerId);
    }

    // ---- Expiry ----

    private checkExpiry(now: number) {
      if (this.closing) return;
      const decision = deps.roomExpiry.decide({
        phase: this.phase,
        connectedCount: this.clientsByPlayer.size,
        liveSessionCount: deps.sessions.sessionsInRoom(this.roomCode).length,
        lastActivityMs: deps.slots.lastActivity(this.roomCode) ?? now,
        phaseStartedAtMs: deps.slots.phaseStartedAt(this.roomCode) ?? now,
        nowMs: now,
      });
      if (decision === 'keep') return;
      this.closing = true;
      deps.slots.beginClose(this.roomCode);
      deps.sessions.invalidateRoom(this.roomCode);
      void this.disconnect(ROOM_EXPIRED_CLOSE_CODE);
    }

    // ---- Views and public state ----

    private viewBody(playerId: string): PrivateViewBody | null {
      const instance = this.context.instanceOf(playerId);
      const attached = instance ? this.driver.instance(instance.gameInstanceId) : null;
      if (!instance || !attached || !deps.core) return null;
      const loading: LoadingView | null =
        this.phase === 'GAME_LOADING'
          ? this.loading.loadingView(playerId, this.context.stateVersion, deps.assetVersion)
          : null;
      return projectPrivateBody(deps.core, attached.state, playerId, loading);
    }

    private gameInstance() {
      return this.context.activeInstances().find((i) => i.kind === 'game') ?? null;
    }

    private broadcastRoster() {
      const access = deps.slots.access(this.roomCode);
      if (access)
        this.broadcast(
          PRODUCT_SERVER_MESSAGES.roomAccess,
          { matchId: this.context.matchId, ...access },
          { afterNextPatch: true },
        );
      // The client must observe a new match before its roster; old-match data is rejected.
      this.broadcast(
        PRODUCT_SERVER_MESSAGES.roomRoster,
        this.lobby.roster(this.context.matchId, this.context.stateVersion, this.phase),
        { afterNextPatch: true },
      );
    }

    private syncPublic() {
      const s = this.state;
      s.phase = this.phase;
      s.matchId = this.context.matchId;
      s.stateVersion = this.context.stateVersion;
      s.serverTick = this.context.serverTick;
      // Null round fields are encoded as absent; the schema builder types them as required.
      const nullable = s as unknown as Record<string, unknown>;
      nullable.startTick = this.context.startTick ?? undefined;
      nullable.startAt = this.context.startAt ?? undefined;
      nullable.deadlineTick = this.context.deadlineTick ?? undefined;
      nullable.abortReason = this.abortReason ?? undefined;
      nullable.preparationIssue = ['LOBBY', 'DEVICE_CHECK'].includes(this.phase)
        ? preparationIssue(this.blockedReason)
        : undefined;
      nullable.rematchState = ['RESULT', 'ABORTED'].includes(this.phase)
        ? this.rematch.pending
          ? 'requested'
          : this.hasUnresolvedMedia()
            ? 'settling'
            : 'available'
        : undefined;
      const remaining = deps.roomExpiry.remainingMs({
        phase: this.phase,
        lastActivityMs: deps.slots.lastActivity(this.roomCode) ?? deps.monotonicNow(),
        phaseStartedAtMs: deps.slots.phaseStartedAt(this.roomCode) ?? deps.monotonicNow(),
        nowMs: deps.monotonicNow(),
      });
      nullable.roomExpiresInSeconds =
        remaining !== null && remaining <= 60_000 ? Math.ceil(remaining / 1000) : undefined;
      const game = this.gameInstance();
      const attached = game ? this.driver.instance(game.gameInstanceId) : null;
      const frame = attached && deps.core ? deps.core.getFrame(attached.state) : null;
      s.counts.escaped = frame?.counts.escaped ?? 0;
      s.counts.captured = frame?.counts.captured ?? 0;
      if (frame?.result) {
        if (!s.result) s.result = new RoundResultState();
        s.result.winner = frame.result.winner;
        s.result.reason = frame.result.reason;
      } else if (s.result && s.result.winner !== '') {
        s.result.winner = '';
        s.result.reason = '';
      }
    }

    private overload(lagMs: number) {
      if (ABORTABLE_PHASES.includes(this.phase))
        this.abortMatch('SERVER_TICK_OVERLOAD', `OVERLOAD:${Math.round(lagMs)}`);
      deps.coordinator.rearm(this.roomId);
    }

    private invalidateLayout() {
      this.layoutRevision += 1;
      this.finalizing = null;
      this.pendingLayout = null;
    }

    private waitForMediaFrame(mediaInstanceId: string): Promise<boolean> {
      if (this.observedMediaInstances.has(mediaInstanceId)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const waiters = this.mediaFrameWaiters.get(mediaInstanceId) ?? new Set();
        waiters.add(resolve);
        this.mediaFrameWaiters.set(mediaInstanceId, waiters);
      });
    }

    private hasPendingPreparations() {
      return [...this.mediaInstances.values()].some(
        (mediaInstanceId) => (this.pendingPreparations.get(mediaInstanceId) ?? 0) > 0,
      );
    }

    private settleMediaFrameWaiters(mediaInstanceId: string, observed: boolean) {
      const waiters = this.mediaFrameWaiters.get(mediaInstanceId);
      this.mediaFrameWaiters.delete(mediaInstanceId);
      for (const resolve of waiters ?? []) resolve(observed);
    }

    /**
     * A tick threw. The coordinator already stopped replaying this room and emitted the
     * overload metric; the match cannot be trusted after a partial tick, so it aborts with the
     * existing server-fault reason and the room re-arms for a new round. `AbortReason` is
     * protocol-owned and gains no new value: the cause is carried in `blockedReason`.
     */
    private tickFailed(error: unknown) {
      const cause = error instanceof Error ? error.message : String(error);
      if (ABORTABLE_PHASES.includes(this.phase))
        this.abortMatch('SERVER_TICK_OVERLOAD', `TICK_FAILED:${cause}`);
      deps.coordinator.rearm(this.roomId);
    }
  }

  return KkakkungRoom;
}

/** Placeholder used only when A's core has not arrived: every call is an explicit error. */
function unavailableCore<State>(): CorePort<State> {
  const missing = (): never => {
    throw new Error('CORE_UNAVAILABLE');
  };
  return {
    createMatch: missing,
    createPractice: missing,
    stepMatch: missing,
    getPlayerKnowledge: missing,
    getVisibleEntities: missing,
    getPlayerSelf: missing,
    getVisibleSurfaces: missing,
    getFrame: missing,
  };
}

export type { Topology };

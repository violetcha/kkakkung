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
  PRODUCT_CLIENT_MESSAGES,
  PRODUCT_SERVER_MESSAGES,
  productJoinOptionsSchema,
  requestStatusSchema,
  type AudioPolicy,
  type CommandCode,
  type CommandOutcome,
  type CommandReceipt,
  type MediaBindings,
} from '@kkakkung/protocol/game-messages';
import {
  PublicMatchState,
  RoundResultState,
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
  MediaCoordinator,
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
import { LoadingCoordinator } from './LoadingCoordinator.js';
import { LobbyCoordinator } from './LobbyCoordinator.js';
import { PracticeCoordinator } from './PracticeCoordinator.js';
import { RematchCoordinator } from './RematchCoordinator.js';
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
  media: MediaCoordinator | null;
  assetVersion: string;
  emitMetric?: EmitMetric;
  random?: () => number;
  onInvalidateRoom?: (roomCode: string) => void;
}>;

type PendingLayout =
  | { status: 'selected'; layout: import('../game/ports.js').MatchLayout }
  | { status: 'unavailable'; diagnostic: string };

const ACTIVE_CORE_PHASES: readonly Phase[] = ['TEAM_PRACTICE', 'PLAYING'];

export function createKkakkungRoom<State>(deps: ProductRoomDeps<State>) {
  const random = deps.random ?? Math.random;

  class KkakkungRoom extends Room<{ state: PublicMatchState }> implements ProductRoomHandle {
    maxClients = 6;
    state = new PublicMatchState();
    roomCode = '';
    phase: Phase = 'LOBBY';
    blockedReason: string | null = null;
    private readonly context = new MatchContext({ serverEpoch: deps.serverEpoch });
    private readonly queue = new CommandQueue();
    private readonly limiter = new CommandLimiter();
    private readonly heartbeat = new HeartbeatTracker({ serverEpoch: deps.serverEpoch });
    private readonly clockSync = new ClockSync({
      serverEpoch: deps.serverEpoch,
      now: deps.monotonicNow,
    });
    private readonly lobby = new LobbyCoordinator({ random });
    private readonly practice = new PracticeCoordinator();
    private readonly loading = new LoadingCoordinator({ requireFace: deps.media !== null });
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
    private readonly pendingRetirements = new Set<string>();
    private finalizing: Promise<void> | null = null;
    private pendingLayout: PendingLayout | null = null;
    private startRequestedTick: number | null = null;
    private abortReason: PublicMatchState['abortReason'] | null = null;
    private readonly dispatcher: EventDispatcher;
    private readonly driver: MatchDriver<State>;

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
        onMediaFrame: (frame) => deps.media?.observeFrame(frame),
        onMediaIntent: (intent, gameInstanceId) => this.handleMediaIntent(intent, gameInstanceId),
        onIntegrityFailure: (gameInstanceId, reason) =>
          this.abortMatch(null, `INTEGRITY:${gameInstanceId}:${reason}`),
      });
    }

    // ---- ProductRoomHandle ----

    get matchId() {
      return this.context.matchId;
    }

    mediaScopeFor(playerId: string, purpose: 'practice' | 'game') {
      const instance = this.context.instanceOf(playerId);
      if (!instance || instance.kind !== purpose) return null;
      const mediaInstanceId = this.mediaInstances.get(instance.gameInstanceId);
      return mediaInstanceId ? { mediaInstanceId, gameInstanceId: instance.gameInstanceId } : null;
    }

    enqueueMediaControl(control: MediaControl) {
      this.driver.enqueueMediaControl(control);
    }

    deliverBindings(playerId: string, message: MediaBindings) {
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
      this.clientsByPlayer.get(playerId)?.send(PRODUCT_SERVER_MESSAGES.audioPolicy, message);
    }

    // ---- Colyseus lifecycle ----

    static async onAuth(_token: string, options: unknown, _context: AuthContext) {
      const parsed = productJoinOptionsSchema.safeParse(options);
      if (!parsed.success) throw new ServerError(400, 'INVALID_JOIN');
      if (parsed.data.protocolVersion !== PRODUCT_PROTOCOL_VERSION)
        throw new ServerError(409, 'PROTOCOL_MISMATCH');
      const auth = deps.sessions.authenticate(parsed.data.token);
      if (!auth) throw new ServerError(401, 'INVALID_SESSION');
      if (auth.roomCode !== parsed.data.roomCode) throw new ServerError(403, 'WRONG_ROOM');
      const slot = deps.slots.slotState(auth.roomCode, auth.playerId);
      if (!slot || slot === 'RETIRING') throw new ServerError(403, 'ROOM_CLOSED');
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
      this.autoDispose = true;
      this.patchRate = 50;
      this.syncPublic();
      this.onMessage(PRODUCT_CLIENT_MESSAGES.command, (client, payload: unknown) =>
        this.onCommand(client, payload),
      );
      this.onMessage(PRODUCT_CLIENT_MESSAGES.requestStatus, (client, payload: unknown) =>
        this.onRequestStatus(client, payload),
      );
      this.onMessage(PRODUCT_CLIENT_MESSAGES.viewResync, (client, payload: unknown) => {
        const auth = this.playersByConnection.get(client.sessionId);
        if (auth) this.dispatcher.handleResync(auth.playerId, payload, this.phase);
      });
      this.onMessage(PRODUCT_CLIENT_MESSAGES.heartbeatAck, (client, payload: unknown) => {
        this.heartbeat.ack(client.sessionId, payload, this.context.matchId, deps.monotonicNow());
      });
      this.onMessage(PRODUCT_CLIENT_MESSAGES.clockProbe, (client, payload: unknown) => {
        const result = this.clockSync.handle(client.sessionId, payload);
        if (result.status === 'reply')
          client.send(PRODUCT_SERVER_MESSAGES.clockReply, result.reply);
      });
      this.onMessage(PRODUCT_CLIENT_MESSAGES.mediaBindingsRefresh, (client) => {
        const auth = this.playersByConnection.get(client.sessionId);
        if (!auth) return;
        const now = deps.monotonicNow();
        const last = this.refreshAt.get(auth.playerId);
        if (last !== undefined && now - last < 1000) return;
        this.refreshAt.set(auth.playerId, now);
        const bindings = this.lastBindings.get(auth.playerId);
        if (bindings) client.send(PRODUCT_SERVER_MESSAGES.mediaBindings, bindings);
      });
      this.onMessage('*', () => undefined);
      deps.coordinator.register(this.roomId, {
        onTick: () => this.tick(),
        onOverload: (lagMs) => this.overload(lagMs),
      });
      deps.directory.register(this);
    }

    onJoin(client: Client, _options: unknown, auth: SessionAuth) {
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
      const joinOrder =
        deps.slots.joinOrder(this.roomCode, auth.playerId) ?? this.lobby.list().length;
      this.lobby.add(auth.playerId, auth.nickname, joinOrder);
      this.heartbeat.register(client.sessionId, auth.playerId, now);
      this.broadcastRoster();
      this.dispatcher.publishView(auth.playerId, 'initial', this.phase);
      this.evaluateWaiting();
      this.syncPublic();
    }

    onLeave(client: Client) {
      const auth = this.playersByConnection.get(client.sessionId);
      this.playersByConnection.delete(client.sessionId);
      this.limiter.forget(client.sessionId);
      this.clockSync.forget(client.sessionId);
      const control = this.heartbeat.close(client.sessionId);
      if (!auth) return;
      deps.sessions.releaseConnection(auth.sessionId, client.sessionId);
      this.clientsByPlayer.delete(auth.playerId);
      this.lobby.setConnected(auth.playerId, false);
      if (control) this.handleConnectionLost(auth.playerId);
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
      deps.coordinator.unregister(this.roomId);
      deps.directory.unregister(this.roomCode, this);
      deps.sessions.invalidateRoom(this.roomCode);
      for (const member of deps.slots.members(this.roomCode))
        deps.slots.release(this.roomCode, member.playerId, {
          confirmedRetirement: !this.pendingRetirements.has(member.playerId),
        });
      deps.slots.closeRoom(this.roomCode);
      deps.onInvalidateRoom?.(this.roomCode);
    }

    // ---- Message handlers: enqueue only ----

    private onCommand(client: Client, payload: unknown) {
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
      if (gate) return this.sendReceipt(client, { ...correlation, status: 'rejected', code: gate });
      const instance = parsed.kind === 'core' ? this.context.instanceOf(auth.playerId) : null;
      const accepted = this.queue.accept({
        actorId: auth.playerId,
        command,
        gameInstanceId: instance?.gameInstanceId ?? null,
        nowMs: now,
        stateVersion: this.dispatcher.applicableVersion(auth.playerId),
      });
      if (accepted.status === 'rejected')
        return this.sendReceipt(client, {
          ...correlation,
          status: 'rejected',
          code: accepted.code,
        });
      deps.sessions.touch(auth.sessionId);
      client.send(PRODUCT_SERVER_MESSAGES.commandResult, accepted.receipt);
      if (accepted.status === 'duplicate' && accepted.outcome)
        client.send(PRODUCT_SERVER_MESSAGES.commandOutcome, accepted.outcome);
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
        PRACTICE_READY: ['TEAM_PRACTICE'],
        LOAD_READY: ['GAME_LOADING'],
        REMATCH: ['RESULT', 'ABORTED'],
      };
      return allowed[type]?.includes(this.phase) ? null : 'INVALID_PHASE';
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
        case 'READY': {
          const result = this.lobby.applyReady(entry.actorId, command.payload.ready, this.phase);
          if (result.result === 'applied') this.broadcastRoster();
          return result;
        }
        case 'PRACTICE_READY':
          return this.phase === 'TEAM_PRACTICE'
            ? this.practice.applyPracticeReady(entry.actorId, command.payload.ready)
            : { result: 'rejected', code: 'INVALID_PHASE' };
        case 'LOAD_READY':
          return this.phase === 'GAME_LOADING'
            ? this.loading.applyLoadReady(entry.actorId, command.payload)
            : { result: 'rejected', code: 'INVALID_PHASE' };
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

    // ---- Tick ----

    tick() {
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
      for (const control of this.heartbeat.sweep(now))
        if (control.type === 'CONNECTION_LOST') this.handleConnectionLost(control.playerId);
      for (const control of this.driver.drainMediaControls()) this.applyMediaControl(control);
      this.driver.tick();
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
          const next =
            verdict === 'end-all-ready'
              ? 'to-map-finalizing'
              : this.practice.next(members, (id) => this.lobby.isReady(id));
          this.endPractice(next);
          return;
        }
        case 'MAP_FINALIZING':
          if (!this.finalizing) this.startFinalizing();
          if (this.pendingLayout) {
            const result = this.pendingLayout;
            this.pendingLayout = null;
            this.finalizing = null;
            if (result.status === 'selected') this.startLoading(result.layout, now);
            else this.returnToDeviceCheck(`LAYOUT:${result.diagnostic}`);
          }
          return;
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
            this.rematch.canStart({ mediaRetirementConfirmed: this.pendingRetirements.size === 0 })
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

    private startPractice() {
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
        const mediaInstanceId = deps.media ? randomUUID() : null;
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
      this.finalizing = loader
        .prepare({ masterPath, fallbackPath, templateId, templateVersion, players, seed })
        .then((result) => {
          this.pendingLayout =
            result.status === 'selected'
              ? { status: 'selected', layout: result.layout.layout }
              : { status: 'unavailable', diagnostic: result.diagnostic };
        })
        .catch(() => {
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
        mediaInstanceId: deps.media ? mediaInstanceId : null,
      });
      const playerIds = players.map((p) => p.playerId);
      this.loading.open({ loadId: randomUUID(), mediaInstanceId, playerIds, nowMs: now });
      for (const playerId of playerIds) {
        this.context.enterInstance(playerId, instance.gameInstanceId);
        if (!deps.media) this.loading.setReceiverGeneration(playerId, mediaInstanceId, 0);
        else this.prepareGeneration(playerId, mediaInstanceId, 'game');
      }
      this.setPhase('GAME_LOADING');
    }

    private prepareGeneration(
      playerId: string,
      mediaInstanceId: string,
      purpose: 'practice' | 'game',
    ) {
      if (!deps.media) return;
      const previous = this.playerGenerations.get(playerId);
      const requestId = randomUUID();
      deps.media
        .prepareGeneration({
          requestId,
          matchId: this.context.matchId,
          playerId,
          mediaInstanceId,
          purpose,
          expectedPreviousGeneration: previous?.receiverGeneration ?? null,
        })
        .then((result) => this.driver.enqueueMediaControl({ type: 'MEDIA_PREPARED', result }))
        .catch(() =>
          this.driver.enqueueMediaControl({
            type: 'MEDIA_PREPARED',
            result: {
              requestId,
              matchId: this.context.matchId,
              playerId,
              mediaInstanceId,
              status: 'unknown',
              receiverGeneration: previous?.receiverGeneration ?? 0,
              grant: null,
              code: 'TIMEOUT',
            },
          }),
        );
    }

    private startCountdown(now: number) {
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

    private abortMatch(reason: PublicMatchState['abortReason'] | null, diagnostic: string) {
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
      this.blockedReason = diagnostic;
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
      for (const playerId of members) {
        this.dispatcher.publishView(playerId, 'scope', this.phase);
        if (mediaInstanceId && deps.media) this.retireGeneration(playerId, mediaInstanceId, reason);
      }
    }

    private retireGeneration(
      playerId: string,
      mediaInstanceId: string,
      reason: 'phase-change' | 'aborted' | 'round-ended' | 'connection-lost' | 'personal-ended',
    ) {
      const generation = this.playerGenerations.get(playerId);
      if (!deps.media || !generation || generation.mediaInstanceId !== mediaInstanceId) return;
      this.pendingRetirements.add(playerId);
      const requestId = randomUUID();
      const request = {
        requestId,
        matchId: this.context.matchId,
        mediaInstanceId,
        receiverGeneration: generation.receiverGeneration,
        playerId,
        reason: reason === 'aborted' ? ('phase-change' as const) : reason,
      };
      deps.media
        .retireGeneration(request)
        .then((result) => this.driver.enqueueMediaControl({ type: 'MEDIA_RETIRED', result }))
        .catch(() =>
          this.driver.enqueueMediaControl({
            type: 'MEDIA_RETIRED',
            result: { ...request, status: 'unknown', code: 'TIMEOUT' },
          }),
        );
    }

    private startNewRound() {
      const request = this.rematch.take();
      const now = deps.monotonicNow();
      for (const instance of this.driver.attached())
        this.retireInstance(instance.gameInstanceId, 'round-ended');
      this.driver.cancelAllPending('ROUND_ENDED');
      this.context.startNewRound();
      this.queue.reset();
      this.heartbeat.resetForMatch(now);
      this.dispatcher.resetForMatch();
      this.lobby.clearReady();
      this.roles.clear();
      this.context.setRolePlan(request?.plan ?? null);
      this.loading.invalidate();
      this.countdown.cancel();
      this.practice.stop();
      this.startRequestedTick = null;
      this.abortReason = null;
      this.blockedReason = null;
      this.seenMediaRequests.clear();
      this.seenMediaEvents.clear();
      this.playerGenerations.clear();
      this.lastBindings.clear();
      this.phase = 'LOBBY';
      this.context.bumpVersion();
      deps.slots.setPhase(this.roomCode, 'LOBBY', now);
      deps.coordinator.rearm(this.roomId);
      this.syncPublic();
      this.broadcastRoster();
      for (const playerId of this.clientsByPlayer.keys())
        this.dispatcher.publishView(playerId, 'initial', this.phase);
      this.evaluateWaiting();
    }

    private setPhase(next: Phase) {
      if (this.phase === next) return;
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
        if (this.seenMediaRequests.has(result.requestId) || result.matchId !== this.context.matchId)
          return;
        this.seenMediaRequests.add(result.requestId);
        if (result.status === 'ready') {
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
        } else if (this.phase === 'GAME_LOADING')
          this.returnToDeviceCheck(`MEDIA_PREPARE:${result.code}`);
      } else if (control.type === 'MEDIA_RETIRED') {
        const { result } = control;
        if (result.status === 'confirmed') {
          this.pendingRetirements.delete(result.playerId);
          this.playerGenerations.delete(result.playerId);
          if (deps.slots.slotState(this.roomCode, result.playerId) === 'RETIRING')
            deps.slots.release(this.roomCode, result.playerId, { confirmedRetirement: true });
        }
      } else if (control.type === 'MEDIA_FAILED') {
        if (this.seenMediaEvents.has(control.eventId)) return;
        this.seenMediaEvents.add(control.eventId);
        if (this.phase === 'PLAYING' || this.phase === 'COUNTDOWN') {
          const game = this.gameInstance();
          if (game)
            this.driver.enqueueControl(game.gameInstanceId, {
              type: 'ABORT_MATCH',
              reason: 'MEDIA_UNAVAILABLE',
            });
        } else if (this.phase === 'GAME_LOADING')
          this.returnToDeviceCheck(`MEDIA_FAILED:${control.code}`);
      }
    }

    private handleMediaIntent(intent: MediaIntent, gameInstanceId: string) {
      const mediaInstanceId = this.mediaInstances.get(gameInstanceId);
      if (!mediaInstanceId || !deps.media) return;
      if (intent.type === 'RETIRE_PLAYER')
        this.retireGeneration(intent.playerId, mediaInstanceId, intent.reason);
      else
        for (const playerId of this.context.membersOf(gameInstanceId))
          this.retireGeneration(playerId, mediaInstanceId, intent.reason);
    }

    private handleConnectionLost(playerId: string) {
      const instance = this.context.instanceOf(playerId);
      if (instance)
        this.driver.enqueueControl(instance.gameInstanceId, { type: 'CONNECTION_LOST', playerId });
      const mediaInstanceId = instance
        ? this.mediaInstances.get(instance.gameInstanceId)
        : undefined;
      if (mediaInstanceId && deps.media) {
        deps.slots.markRetiring(this.roomCode, playerId);
        this.retireGeneration(playerId, mediaInstanceId, 'connection-lost');
      }
    }

    private releaseSeat(playerId: string, _reason: 'connection-lost') {
      if (deps.slots.slotState(this.roomCode, playerId) === 'RETIRING') return;
      deps.slots.release(this.roomCode, playerId);
    }

    // ---- Expiry ----

    private checkExpiry(now: number) {
      const decision = deps.roomExpiry.decide({
        phase: this.phase,
        connectedCount: this.clientsByPlayer.size,
        liveSessionCount: deps.sessions.sessionsInRoom(this.roomCode).length,
        lastActivityMs: deps.slots.lastActivity(this.roomCode) ?? now,
        nowMs: now,
      });
      if (decision === 'keep') return;
      if (this.clientsByPlayer.size === 0 || decision === 'expire-sessions') void this.disconnect();
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
      this.broadcast(
        PRODUCT_SERVER_MESSAGES.roomRoster,
        this.lobby.roster(this.context.matchId, this.context.stateVersion, this.phase),
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
      deps.emitMetric?.({
        name: 'tick.overload',
        value: lagMs,
        unit: 'ms',
        atMs: deps.monotonicNow(),
        matchRef: this.roomId,
      });
      if (
        ['TEAM_PRACTICE', 'MAP_FINALIZING', 'GAME_LOADING', 'COUNTDOWN', 'PLAYING'].includes(
          this.phase,
        )
      )
        this.abortMatch('SERVER_TICK_OVERLOAD', `OVERLOAD:${Math.round(lagMs)}`);
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

import {
  readPublicRoundState,
  type PublicMatchState,
  type PublicRoundState,
  type PrivateView,
} from '@kkakkung/protocol/game-schema';
import {
  roomRosterSchema,
  audioPolicySchema,
  mediaBindingsSchema,
  mediaGrantSchema,
  MEDIA_ROUTES,
  type SessionResponse,
  type RoomRosterMessage,
} from '@kkakkung/protocol/game-messages';
import { createGameHeartbeat } from '../features/room/game-heartbeat';
import { createFaceTextures, videoFaceTexture } from '../features/game/scene/face-textures';
import { createPrivateEvents } from '../features/room/private-events';
import type { HunterMarker } from '../features/game/map/past-event-markers';
import { exchangePresenter, permitsExchange } from '../features/game/map/exchange-presenter';
import {
  createCommandLifecycle,
  type CommandInput,
  type RequestDisplay,
} from '../features/room/command-lifecycle';
import { createClockSync } from '../features/room/clock-sync';
import { createProductView } from '../features/room/product-view';
import { createInteractionBridge } from './interaction-bridge';
import { createParticipationLifetime } from './SessionRuntime';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';
import {
  createLoadingController,
  SCENE_ASSET_VERSION,
} from '../features/game/flow/loading-controller';
import { createQualityControl, type QualityPreset } from '../features/game/scene/quality-presets';
import type {
  DeviceStatus,
  InteractionDeps,
  InteractionRuntime,
  InteractionState,
  MediaBindings,
  MediaStatus,
  InteractionContext,
} from '../features/input/InteractionRuntime';

export interface ProductRoomPort {
  state: PublicMatchState;
  send(type: string, payload: unknown): void;
  onMessage(type: string, handler: (value: unknown) => void): () => void;
  onStateChange(handler: (state: PublicMatchState) => void): () => void;
  onLeave(handler: () => void): () => void;
  onError(handler: () => void): () => void;
  leave(): Promise<unknown>;
}
export type ProductSnapshot = {
  round: PublicRoundState | null;
  view: PrivateView | null;
  roster: RoomRosterMessage | null;
  devices: DeviceStatus;
  media: MediaStatus | null;
  request: RequestDisplay | null;
  requests: Partial<Record<CommandInput['type'], RequestDisplay>>;
  interaction: InteractionState;
  exchangeTarget: string | null;
  markers: HunterMarker[];
  exchangeNotice: string | null;
  faceRevision: number;
  lost: boolean;
  error: string | null;
  quality: QualityPreset;
  endedSelf: PrivateView['self'];
};
export function bindProductRoom(
  room: ProductRoomPort,
  session: SessionResponse,
  deps: {
    now(): number;
    uuid(): string;
    changed(snapshot: ProductSnapshot): void;
    fetcher?: typeof fetch;
    interactionFactory?: (deps: InteractionDeps) => InteractionRuntime;
  },
) {
  let active = true;
  let participating = true;
  let pageActive = true;
  let generation = 0;
  let snapshot: ProductSnapshot = {
    round: null,
    view: null,
    roster: null,
    devices: INITIAL_DEVICES,
    media: null,
    request: null,
    requests: {},
    interaction: { selectedEquipment: 'sensor', mode: 'motion' },
    exchangeTarget: null,
    markers: [],
    exchangeNotice: null,
    faceRevision: 0,
    lost: false,
    error: null,
    quality: 'medium',
    endedSelf: null,
  };
  let interaction: InteractionState = { selectedEquipment: 'sensor', mode: 'motion' };
  const faces = createFaceTextures(videoFaceTexture);
  let bindings: MediaBindings | null = null;
  let previewHost: HTMLElement | null = null;
  let bridge!: ReturnType<typeof createInteractionBridge>;
  let participation!: ReturnType<typeof createParticipationLifetime>;
  let attemptedScope: string | null = null;
  let mediaJob: Promise<void> = Promise.resolve();
  const unsubscribers: (() => void)[] = [];
  const publish = (patch: Partial<ProductSnapshot>) => {
    if (active) {
      snapshot = { ...snapshot, ...patch };
      deps.changed(snapshot);
    }
  };
  let lastViewResync = -Infinity;
  const send = (type: string, value: unknown) => {
    if (type === 'view-resync') {
      if (deps.now() - lastViewResync < 1000) return;
      lastViewResync = deps.now();
    }
    if (active && !snapshot.lost) room.send(type, value);
  };
  const commands = createCommandLifecycle({
    now: deps.now,
    uuid: deps.uuid,
    send,
    changed: (request) =>
      publish({ request, requests: { ...snapshot.requests, [request.type]: request } }),
  });
  const clock = createClockSync({
    now: deps.now,
    uuid: deps.uuid,
    send: (value) => send('clock-probe', value),
  });
  const loading = createLoadingController((payload) =>
    commands.send({ type: 'LOAD_READY', payload }),
  );
  const error = () =>
    publish({ error: '연결 상태를 확인해 주세요. 준비되지 않은 기능은 실행하지 않습니다.' });
  const lose = () => {
    if (!active || snapshot.lost) return;
    publish({ lost: true });
    clock.clear();
    heartbeat.dispose();
    void participation.leave().catch(error);
  };
  const heartbeat = createGameHeartbeat({
    now: deps.now,
    ack: (value) => send('game-heartbeat-ack', value),
    lost: lose,
    onAnchor: (value) => clock.anchor(value),
  });
  const events = createPrivateEvents({
    now: deps.now,
    resync: () =>
      snapshot.round &&
      send('view-resync', {
        matchId: snapshot.round.matchId,
        lastStateVersion: snapshot.view?.stateVersion ?? 0,
      }),
    apply: (event) => {
      if (!participating) return;
      if (event.type === 'HUNTER_MARKER' && snapshot.view?.self?.role === 'tagger') {
        const tick = clock.renderTick() ?? snapshot.round?.serverTick ?? 0;
        if (event.payload.expiresTick > tick)
          publish({
            markers: [
              ...snapshot.markers.filter(
                (m) => m.expiresTick > tick && m.markerId !== event.payload.markerId,
              ),
              event.payload,
            ].slice(-64),
          });
      }
      if (event.type === 'EXCHANGE_COMPLETED')
        publish({ exchangeNotice: '지도 교환이 완료되었습니다.' });
      if (event.type === 'EXCHANGE_CANCELED')
        publish({ exchangeNotice: `교환이 종료되었습니다. (${event.payload.reason})` });
    },
  });
  const views = createProductView({
    now: deps.now,
    resync: (matchId, lastStateVersion) => send('view-resync', { matchId, lastStateVersion }),
    changed: (view) => {
      const oldScope = snapshot.view?.gameScope;
      if (!view || !oldScope || oldScope.revision !== view.gameScope.revision)
        publish({ markers: [], exchangeNotice: null });
      publish({ view });
      faces.visible(
        view?.self?.status === 'ACTIVE'
          ? view.visibleEntities
              .filter((p) => p.kind === 'player' && p.id !== session.playerId)
              .map((p) => p.id)
          : [],
      );
      events.update(view, snapshot.round?.matchId ?? '');
      if (view) commands.view(view.stateVersion);
      if (view?.self && view.self.status !== 'ACTIVE') {
        publish({ endedSelf: view.self });
        void participation.end().catch(error);
      }
      updateContext();
      updateLoading();
    },
  });
  async function post(path: string, body: unknown) {
    const response = await (deps.fetcher ?? fetch)(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.sessionToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('MEDIA_UNAVAILABLE');
    return response.json() as Promise<unknown>;
  }
  function makeBridge() {
    const born = generation;
    const live = () => active && born === generation;
    return createInteractionBridge(
      {
        sendCommand: (command) => sendCommand(command),
        requestMediaGrant: async (request) => {
          if (
            !snapshot.round ||
            !['TEAM_PRACTICE', 'GAME_LOADING'].includes(snapshot.round.phase) ||
            request.matchId !== snapshot.round.matchId
          )
            throw new Error('INVALID_PHASE');
          return mediaGrantSchema.parse(await post(MEDIA_ROUTES.grants, request));
        },
        reportMediaStatus: async (report) => {
          await post(MEDIA_ROUTES.report, report);
        },
        requestBindingsRefresh: (request) => send('media-bindings-refresh', request),
        onDeviceStatus: (devices) => {
          if (live()) publish({ devices });
        },
        onMediaStatus: (media) => {
          if (!live()) return;
          faces.setScope(
            participating &&
              media.matchId === snapshot.round?.matchId &&
              media.mediaInstanceId &&
              media.receiverGeneration !== null &&
              !['closed', 'failed', 'idle'].includes(media.state)
              ? {
                  matchId: media.matchId,
                  mediaInstanceId: media.mediaInstanceId,
                  receiverGeneration: media.receiverGeneration,
                }
              : null,
          );
          publish({ media });
          updateLoading();
        },
        onInteractionState: (state) => {
          if (!live()) return;
          interaction = state;
          publish({ interaction });
          updateContext();
        },
        onLocalPreview: () => {},
        onSensors: () => {},
        onFaceTrack: (event) => {
          if (live() && participating && faces.receive(event))
            publish({ faceRevision: snapshot.faceRevision + 1 });
        },
      },
      deps.interactionFactory,
    );
  }
  function makeParticipation() {
    const owner = bridge;
    return createParticipationLifetime({
      lock: () => {
        participating = false;
        updateContext();
        bridge.runtime.setAudioOutputLock('locked');
      },
      clear: () => {
        faces.clear();
        events.clear();
        commands.clear();
        loading.clear();
        publish({ view: null, request: null, requests: {}, markers: [], exchangeNotice: null });
      },
      end: () => owner.runtime.endParticipation(),
      leave: async () => {
        stop();
        await room.leave();
      },
    });
  }
  function updateContext() {
    const round = snapshot.round;
    if (!bridge || !round) return;
    const self = snapshot.view?.self;
    const own = self?.status === 'ACTIVE' ? self : null;
    const target = exchangePresenter(snapshot.view, snapshot.exchangeTarget, 0)?.selected ?? null;
    if (target !== snapshot.exchangeTarget) publish({ exchangeTarget: target });
    const context: InteractionContext = {
      matchId: round.matchId,
      selfPlayerId: session.playerId,
      role: self?.role ?? null,
      phase: round.phase,
      status: self?.status ?? snapshot.endedSelf?.status ?? 'ACTIVE',
      ...interaction,
      ...(target ? { targetPlayerId: target } : {}),
      pageActive:
        pageActive &&
        participating &&
        !snapshot.lost &&
        (round.phase === 'DEVICE_CHECK' ||
          ((round.phase === 'TEAM_PRACTICE' || round.phase === 'PLAYING') && own !== null)),
      ...(own?.exchange?.direction === 'incoming'
        ? { incomingExchangeId: own.exchange.exchangeId }
        : {}),
      ...(own?.exchange?.direction === 'outgoing'
        ? { outgoingExchangeId: own.exchange.exchangeId }
        : {}),
      ...(own?.challenge
        ? {
            challengeId: own.challenge.challengeId,
            exitId: own.challenge.exitId,
            poseKind: own.challenge.poseKind,
          }
        : {}),
      ...(own?.installation ? { installationId: own.installation.installationId } : {}),
    };
    bridge.setContext(context);
    bridge.runtime.setAudioOutputLock(
      context.pageActive && (round.phase === 'PLAYING' || round.phase === 'TEAM_PRACTICE')
        ? 'open'
        : 'locked',
    );
  }
  function updateLoading() {
    if (!snapshot.round) return;
    const key = loading.update(snapshot.round, snapshot.view);
    // Only this locally compiled primitive asset version is known. Unknown server versions stay blocked.
    loading.assetsLoaded(key, SCENE_ASSET_VERSION);
    loading.check(snapshot.view, bindings, snapshot.media);
  }
  function sendCommand(command: CommandInput) {
    if (!active || snapshot.lost || !snapshot.round) return '';
    const allowedAfterEnd = command.type === 'REMATCH';
    if (!participating && !allowedAfterEnd) return '';
    if (!permitsExchange(snapshot.view, command)) return '';
    const own = snapshot.view?.self;
    if (
      command.type === 'INSTALL' &&
      (own?.status !== 'ACTIVE' || own.role !== 'tagger' || own.installation || own.challenge)
    )
      return '';
    if (
      command.type === 'INSTALL_CANCEL' &&
      (own?.status !== 'ACTIVE' ||
        own.installation?.installationId !== command.payload.installationId)
    )
      return '';
    if (
      [
        'INSTALL',
        'INSTALL_CANCEL',
        'EXIT_START',
        'EXIT_PROGRESS',
        'EXCHANGE_REQUEST',
        'EXCHANGE_ACCEPT',
        'EXCHANGE_CANCEL',
        'REMATCH',
      ].includes(command.type)
    ) {
      const pending = commands.pending(command.type);
      if (pending) return pending;
    }
    if (
      ['MOVE_INTENT', 'TURN', 'INSTALL', 'EXCHANGE_REQUEST', 'EXIT_START'].includes(command.type) &&
      (!pageActive || !['PLAYING', 'TEAM_PRACTICE'].includes(snapshot.round.phase))
    )
      return '';
    return commands.send(command);
  }
  async function connectForView() {
    const view = snapshot.view;
    const round = snapshot.round;
    if (
      !view ||
      view.self?.status !== 'ACTIVE' ||
      !round ||
      !participating ||
      !['TEAM_PRACTICE', 'GAME_LOADING'].includes(round.phase) ||
      view.gameScope.kind === 'none'
    )
      return;
    const key = `${round.matchId}:${view.gameScope.revision}:${view.gameScope.gameInstanceId}`;
    if (attemptedScope === key) return;
    attemptedScope = key;
    const run = generation;
    const owner = bridge;
    mediaJob = mediaJob.then(async () => {
      if (!active || run !== generation || !participating) return;
      try {
        if (snapshot.media?.mediaInstanceId)
          await owner.runtime.retireMediaGeneration('phase-change');
        if (!active || run !== generation || !participating) return;
        const grant = mediaGrantSchema.parse(
          await post(MEDIA_ROUTES.grants, {
            matchId: round.matchId,
            purpose: view.gameScope.kind,
            ...(snapshot.media?.receiverGeneration !== null &&
            snapshot.media?.receiverGeneration !== undefined
              ? { previousReceiverGeneration: snapshot.media.receiverGeneration }
              : {}),
          }),
        );
        if (
          !active ||
          run !== generation ||
          !participating ||
          attemptedScope !== key ||
          snapshot.view?.gameScope.gameInstanceId !== view.gameScope.gameInstanceId ||
          !snapshot.round ||
          !['TEAM_PRACTICE', 'GAME_LOADING'].includes(snapshot.round.phase)
        ) {
          await post(MEDIA_ROUTES.report, {
            matchId: grant.matchId,
            mediaInstanceId: grant.mediaInstanceId,
            receiverGeneration: grant.receiverGeneration,
            status: 'closed',
          });
          return;
        }
        if (owner.runtime.getGenerationState() !== 'live') owner.runtime.beginMediaGeneration();
        await owner.runtime.connectMedia(grant);
        if (!active || run !== generation || !participating) return;
        await owner.runtime.publishMedia();
        updateLoading();
      } catch {
        if (active && run === generation) error();
      }
    });
    await mediaJob;
  }
  function stop() {
    if (!active) return;
    active = false;
    generation++;
    heartbeat.dispose();
    clock.clear();
    commands.clear();
    loading.clear();
    views.clear();
    events.clear();
    faces.clear();
    unsubscribers.splice(0).forEach((off) => off());
  }
  bridge = makeBridge();
  participation = makeParticipation();
  const quality = createQualityControl((value) => {
    bridge.runtime.setQualityPreset(value);
    publish({ quality: value });
  });
  function sync(state: PublicMatchState) {
    if (!active || snapshot.lost || !state.matchId) return;
    const round = readPublicRoundState(state);
    if (
      snapshot.round?.matchId === round.matchId &&
      round.stateVersion < snapshot.round.stateVersion
    )
      return;
    const rematch = snapshot.round !== null && snapshot.round.matchId !== round.matchId;
    const phaseChanged = snapshot.round?.phase !== round.phase;
    if (rematch) {
      faces.clear();
      generation++;
      participating = false;
      attemptedScope = null;
      bindings = null;
      const old = bridge;
      const run = generation;
      publish({
        view: null,
        roster: null,
        endedSelf: null,
        devices: INITIAL_DEVICES,
        media: null,
        request: null,
      });
      void old
        .dispose()
        .then(() => {
          if (!active || run !== generation) return;
          bridge = makeBridge();
          bridge.setPreviewHost(previewHost);
          participating = true;
          participation = makeParticipation();
          updateContext();
        })
        .catch(error);
    }
    if (phaseChanged) {
      publish({ request: null, requests: {} });
      commands.clear();
    }
    publish({ round });
    commands.setMatch(round.matchId);
    heartbeat.setMatch(round.matchId);
    views.round(round);
    if (round.phase === 'RESULT' || round.phase === 'ABORTED')
      void participation.end().catch(error);
    updateContext();
    updateLoading();
    void connectForView();
  }
  unsubscribers.push(room.onStateChange(sync), room.onLeave(lose), room.onError(lose));
  const on = (type: string, handler: (value: unknown) => void) =>
    unsubscribers.push(
      room.onMessage(type, (value) => {
        if (active && !snapshot.lost) handler(value);
      }),
    );
  on('game-heartbeat', (value) => heartbeat.receive(value));
  on('clock-reply', (value) => clock.receive(value));
  on('command-result', commands.receipt);
  on('command-outcome', commands.outcome);
  on('request-status-result', commands.lookup);
  on('private-event', events.receive);
  on('room-roster', (value) => {
    const result = roomRosterSchema.safeParse(value);
    if (
      result.success &&
      result.data.matchId === snapshot.round?.matchId &&
      result.data.stateVersion >= (snapshot.roster?.stateVersion ?? -1)
    )
      publish({ roster: result.data });
  });
  on('private-view', (value) => {
    if (views.receive(value)) void connectForView();
  });
  on('media-bindings', (value) => {
    const result = mediaBindingsSchema.safeParse(value);
    if (!result.success || result.data.matchId !== snapshot.round?.matchId || !participating)
      return;
    bindings = result.data;
    bridge.runtime.applyMediaBindings(bindings);
    updateLoading();
  });
  on('audio-policy', (value) => {
    const result = audioPolicySchema.safeParse(value);
    if (result.success && result.data.matchId === snapshot.round?.matchId && participating)
      bridge.runtime.applyAudioPolicy(result.data);
  });
  try {
    sync(room.state);
  } catch {
    stop();
    void bridge.dispose().catch(() => {});
    throw new Error('CONNECTION_FAILED');
  }
  return {
    faces,
    poll() {
      if (!active) return;
      heartbeat.poll();
      if (snapshot.lost) return;
      commands.poll();
      clock.poll();
      views.poll();
      events.poll();
    },
    send: sendCommand,
    setPageActive(value: boolean) {
      pageActive = value;
      updateContext();
    },
    setPreviewHost(host: HTMLElement | null) {
      previewHost = host;
      bridge.setPreviewHost(host);
    },
    startDevices: (microphone: boolean) => bridge.startDevices(microphone).catch(error),
    ready: (value: boolean) => bridge.ready(value),
    quality: (value: QualityPreset) => quality.select(value),
    selectEquipment(value: InteractionState['selectedEquipment']) {
      interaction = { ...interaction, selectedEquipment: value };
      publish({ interaction });
      updateContext();
    },
    selectExchangeTarget(id: string) {
      publish({ exchangeTarget: exchangePresenter(snapshot.view, id, 0)?.selected ?? null });
      updateContext();
    },
    serverNow: clock.serverNow,
    renderTick: clock.renderTick,
    getSnapshot: () => snapshot,
    async leave() {
      try {
        await participation.leave();
      } finally {
        await bridge.dispose();
      }
    },
  };
}

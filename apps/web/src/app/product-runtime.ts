import {
  readPublicRoundState,
  type PublicMatchState,
  type PublicRoundState,
  type PrivateView,
} from '@kkakkung/protocol/game-schema';
import {
  roomRosterSchema,
  roomAccessSchema,
  audioPolicySchema,
  mediaBindingsSchema,
  mediaGrantSchema,
  MEDIA_ROUTES,
  ROOM_EXPIRED_CLOSE_CODE,
  ROOM_REMOVED_CLOSE_CODE,
  type SessionResponse,
  type RoomRosterMessage,
  type RoomAccessMessage,
} from '@kkakkung/protocol/game-messages';
import { createGameHeartbeat } from '../features/room/game-heartbeat';
import type { ChallengeKey } from '../features/game/pose/key-challenge';
import {
  createChallengeController,
  exitCandidate,
  facesExit,
} from '../features/game/pose/challenge-controller';
import { createFaceTextures, videoFaceTexture } from '../features/game/scene/face-textures';
import { createPrivateEvents } from '../features/room/private-events';
import type { HunterMarker } from '../features/game/map/past-event-markers';
import { exchangePresenter, permitsExchange } from '../features/game/map/exchange-presenter';
import { equipmentPresenter } from '../features/game/equipment/equipment-presenter';
import {
  createCommandLifecycle,
  type CommandInput,
  type RequestDisplay,
} from '../features/room/command-lifecycle';
import { createClockSync } from '../features/room/clock-sync';
import { createProductView } from '../features/room/product-view';
import { createInteractionBridge } from './interaction-bridge';
import type { RuntimeMetrics } from './runtime-metrics';
import {
  DEFAULT_AUDIO_PREFERENCES,
  normalizeAudioPreferences,
  type AudioPreferences,
} from '../features/media/audio-preferences';
import { createParticipationLifetime } from './SessionRuntime';
import { INITIAL_DEVICES, deviceReady } from '../features/game/flow/device-readiness';
import { practicePresenter } from '../features/game/flow/practice-presenter';
import {
  createLoadingController,
  describePending,
  SCENE_ASSET_VERSION,
} from '../features/game/flow/loading-controller';
import type { FaceConditionNotice } from '../features/media/face-condition';
import type { ReadinessTrace } from '../features/devices/readiness-trace';
import { createQualityControl, type QualityPreset } from '../features/game/scene/quality-presets';
import type {
  DeviceStatus,
  InteractionDeps,
  InteractionRuntime,
  InteractionState,
  MediaBindings,
  MediaStatus,
  MediaScope,
  InteractionContext,
} from '../features/input/InteractionRuntime';

export interface ProductRoomPort {
  state: PublicMatchState;
  send(type: string, payload: unknown): void;
  onMessage(type: string, handler: (value: unknown) => void): () => void;
  onStateChange(handler: (state: PublicMatchState) => void): () => void;
  onLeave(handler: (code?: number) => void): () => void;
  onError(handler: () => void): () => void;
  leave(): Promise<unknown>;
}
/** 첫 게시가 재협상 중 실패했을 때 한 번 다시 시도하기 전 대기. */
const PUBLISH_RETRY_DELAY_MS = 500;

export type ProductSnapshot = {
  round: PublicRoundState | null;
  view: PrivateView | null;
  roster: RoomRosterMessage | null;
  roomAccess?: RoomAccessMessage | null;
  devices: DeviceStatus;
  media: MediaStatus | null;
  /** GAME_LOADING 에서 내가 아직 못 낸 준비 항목. 보고를 보낸 뒤에는 빈 배열이다. */
  loadingPending?: string[];
  /** 장치 런타임이 낸 얼굴 조건 안내. 표시·해제·중복 억제는 런타임이 이미 판단했다. */
  faceGuidance?: FaceConditionNotice | null;
  request: RequestDisplay | null;
  requests: Partial<Record<CommandInput['type'], RequestDisplay>>;
  interaction: InteractionState;
  exchangeTarget: string | null;
  markers: HunterMarker[];
  exchangeNotice: string | null;
  faceRevision: number;
  poseProgress: number;
  exitStarting: boolean;
  keyIndex: number;
  practiceReady: boolean;
  lost: boolean;
  roomExpired?: boolean;
  removedByHost?: boolean;
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
    /** Present only when the run collects its own measurements (W06). */
    metrics?: RuntimeMetrics;
  },
) {
  let active = true;
  let participating = true;
  let pageActive = true;
  let audioPreferences = DEFAULT_AUDIO_PREFERENCES;
  let generation = 0;
  /** 가장 최근 준비 단계 기록. runtime 이 직접 읽기를 지원하지 않을 때의 대체값이다. */
  let readinessTrace: ReadinessTrace | null = null;
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
    poseProgress: 0,
    exitStarting: false,
    keyIndex: 0,
    practiceReady: false,
    lost: false,
    error: null,
    quality: 'medium',
    endedSelf: null,
  };
  let interaction: InteractionState = { selectedEquipment: 'sensor', mode: 'motion' };
  let microphoneWanted = false;
  let deviceAction = 0;
  const canRecoverDevices = () =>
    active &&
    participating &&
    !snapshot.lost &&
    ['DEVICE_CHECK', 'TEAM_PRACTICE', 'PLAYING'].includes(snapshot.round?.phase ?? '');
  const faces = createFaceTextures(videoFaceTexture);
  let sensorGeneration = -1;
  let practiceReadyReported = false;
  let startPending: { exitId: string; requestId: string; until: number | null } | null = null;
  const challenge = createChallengeController((command) => sendCommand(command));
  let bindings: MediaBindings | null = null;
  let previewHost: HTMLElement | null = null;
  let bridge!: ReturnType<typeof createInteractionBridge>;
  let participation!: ReturnType<typeof createParticipationLifetime>;
  let attemptedScope: string | null = null;
  let mediaJob: Promise<void> = Promise.resolve();
  let mediaScope: MediaScope | null = null;
  // Connection ownership may be empty during an HTTP request. Preserve the latest issued
  // generation separately so a queued logical phase change can still name its predecessor.
  let lastIssuedMediaScope: MediaScope | null = null;
  let mediaViewContext: {
    matchId: string;
    gameScope: PrivateView['gameScope'];
    active: boolean;
  } | null = null;
  const retiredScopes = new Map<string, Promise<void>>();
  const recoveryAttempts = new Set<string>();
  let recoveryQueued = false;
  const initialMediaPhases = ['TEAM_PRACTICE', 'GAME_LOADING'];
  const recoveryMediaPhases = [...initialMediaPhases, 'COUNTDOWN', 'PLAYING'];
  const sameMediaScope = (scope: MediaScope) =>
    mediaScope !== null &&
    scope.matchId === mediaScope.matchId &&
    scope.mediaInstanceId === mediaScope.mediaInstanceId &&
    scope.receiverGeneration === mediaScope.receiverGeneration;
  const currentMediaContext = () => {
    const phase = snapshot.round?.phase;
    const kind = mediaViewContext?.gameScope.kind;
    return mediaViewContext?.active &&
      mediaViewContext.matchId === snapshot.round?.matchId &&
      ((kind === 'practice' && phase === 'TEAM_PRACTICE') ||
        (kind === 'game' &&
          phase !== undefined &&
          recoveryMediaPhases.includes(phase) &&
          phase !== 'TEAM_PRACTICE'))
      ? mediaViewContext
      : null;
  };
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
    changed: (request) => {
      if (
        request.type === 'PRACTICE_READY' &&
        ['rejected', 'canceled', 'unconfirmed'].includes(request.status)
      ) {
        practiceReadyReported = false;
        publish({ practiceReady: false });
      }
      if (request.type === 'EXIT_START' && startPending) {
        startPending.requestId = request.requestId;
        if (['rejected', 'canceled', 'unconfirmed'].includes(request.status)) {
          startPending = null;
          publish({ exitStarting: false });
        } else if (request.status === 'applied') startPending.until = deps.now() + 2000;
      }
      publish({ request, requests: { ...snapshot.requests, [request.type]: request } });
    },
  });
  const clock = createClockSync({
    now: deps.now,
    uuid: deps.uuid,
    send: (value) => send('clock-probe', value),
  });
  const loading = createLoadingController((payload) =>
    commands.send({ type: 'LOAD_READY', payload }),
  );
  // 실패 원인은 항상 콘솔에 남긴다(6인 시험에서 어느 경로가 실패했는지 알 수 있게). 화면에는
  // 사용자가 조치할 수 있는 실패만 그 상황에 맞는 문구로 알리고, 뒷정리 실패(경기 종료 뒤 미디어
  // 정리, 방 나가기)는 알리지 않는다. 문구는 경기 단계가 바뀌면 지운다.
  const describeFailure = (cause: unknown) => {
    if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
    if (typeof cause === 'object' && cause !== null && 'code' in cause)
      return String((cause as { code: unknown }).code);
    return String(cause);
  };
  const failed = (context: string, notice: string | null) => (cause: unknown) => {
    console.warn(`[kkakkung] ${context} 실패: ${describeFailure(cause)}`);
    if (notice) publish({ error: notice });
  };
  const CONNECTION_NOTICE = '연결 상태를 확인해 주세요. 준비되지 않은 기능은 실행하지 않습니다.';
  const MEDIA_REPORT_NOTICE = '미디어 상태를 서버에 알리지 못했습니다. 연결 상태를 확인해 주세요.';
  const DEVICE_NOTICE =
    '카메라·마이크를 시작하지 못했습니다. 브라우저의 장치 권한과 다른 앱의 카메라 사용을 확인해 주세요.';
  const lose = (code?: number) => {
    if (!active || snapshot.lost) return;
    audioPreferences = DEFAULT_AUDIO_PREFERENCES;
    publish({
      lost: true,
      roomExpired: code === ROOM_EXPIRED_CLOSE_CODE,
      removedByHost: code === ROOM_REMOVED_CLOSE_CODE,
    });
    clock.clear();
    heartbeat.dispose();
    void participation.leave().catch(failed('방 나가기', null));
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
      if (view)
        mediaViewContext = {
          matchId: view.matchId,
          gameScope: view.gameScope,
          active: view.self?.status === 'ACTIVE',
        };
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
      if (view?.self?.status === 'ACTIVE' && view.self.challenge?.exitId === startPending?.exitId) {
        startPending = null;
        publish({ exitStarting: false });
      }
      updateChallenge();
      if (view?.self && view.self.status !== 'ACTIVE') {
        publish({ endedSelf: view.self });
        void participation.end().catch(failed('참가 종료 뒤 미디어 정리', null));
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
    if (response.status === 204) return null;
    return response.json() as Promise<unknown>;
  }
  function makeBridge() {
    const born = generation;
    const live = () => active && born === generation;
    const created = createInteractionBridge(
      {
        sendCommand: (command) => sendCommand(command),
        requestMediaGrant: async (request) => {
          const mediaContext = currentMediaContext();
          const replacement =
            mediaScope !== null &&
            request.previousReceiverGeneration === mediaScope.receiverGeneration &&
            mediaContext?.gameScope.kind === request.purpose;
          if (
            !snapshot.round ||
            !(replacement ? recoveryMediaPhases : initialMediaPhases).includes(
              snapshot.round.phase,
            ) ||
            request.matchId !== snapshot.round.matchId
          )
            throw new Error('INVALID_PHASE');
          return mediaGrantSchema.parse(await post(MEDIA_ROUTES.grants, request));
        },
        reportMediaStatus: async (report) => {
          await post(MEDIA_ROUTES.report, report);
        },
        requestBindingsRefresh: (request) => send('media-bindings-refresh', request),
        onFaceGuidance: (notice) => {
          if (!live()) return;
          const current = snapshot.faceGuidance ?? null;
          if (current?.condition === notice?.condition && current?.message === notice?.message)
            return;
          publish({ faceGuidance: notice });
        },
        onReadinessTrace: (trace) => {
          if (!live()) return;
          readinessTrace = trace;
          updateLoading();
        },
        onDeviceStatus: (devices) => {
          if (!live()) return;
          publish({ devices });
          updateContext();
          if (
            practiceReadyReported &&
            !deviceReady(devices) &&
            snapshot.round?.phase === 'TEAM_PRACTICE'
          )
            sendCommand({ type: 'PRACTICE_READY', payload: { ready: false } });
          updateLoading();
        },
        onMediaStatus: (media) => {
          if (!live()) return;
          deps.metrics?.recordMedia(media);
          if (
            media.matchId !== null &&
            media.mediaInstanceId !== null &&
            media.receiverGeneration !== null
          ) {
            const scope = {
              matchId: media.matchId,
              mediaInstanceId: media.mediaInstanceId,
              receiverGeneration: media.receiverGeneration,
            };
            if (!sameMediaScope(scope)) return;
            // SDK disconnected is a failure report, never a local cleanup acknowledgement.
            if (
              participating &&
              !retiredScopes.has(JSON.stringify(scope)) &&
              ['recovering', 'failed', 'closed'].includes(media.state)
            ) {
              const reported = post(MEDIA_ROUTES.report, {
                ...scope,
                status: media.state === 'recovering' ? 'recovering' : 'failed',
              });
              if (media.state === 'recovering')
                void reported.catch(failed('미디어 복구 상태 보고', MEDIA_REPORT_NOTICE));
              else queueRecovery(scope, reported);
            }
          }
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
        onSensors: (value) => {
          if (live()) deps.metrics?.recordSensors(value);
          if (!live() || !participating || value.runtimeGeneration < sensorGeneration) return;
          sensorGeneration = value.runtimeGeneration;
          updateChallenge();
        },
        onFaceTrack: (event) => {
          if (live()) deps.metrics?.recordFaceTrack(event.element !== null);
          if (live() && participating && faces.receive(event))
            publish({ faceRevision: snapshot.faceRevision + 1 });
        },
      },
      deps.interactionFactory,
    );
    created.runtime.setAudioPreferences(audioPreferences);
    created.runtime.setQualityPreset(snapshot.quality);
    return created;
  }
  function retireAndReport(
    owner: ReturnType<typeof createInteractionBridge>,
    scope: MediaScope | null,
    reason: 'phase-change' | 'reconnect' = 'phase-change',
  ) {
    if (!scope) return owner.runtime.retireMediaGeneration(reason);
    const key = JSON.stringify(scope);
    let result = retiredScopes.get(key);
    if (!result) {
      result = Promise.resolve().then(async () => {
        await owner.runtime.retireMediaGeneration(reason);
        // B owns retirement after game-connection loss and rejects reports from that client.
        // Keep local cleanup mandatory; this never confirms remote retirement or permits rejoin.
        if (snapshot.lost) return;
        try {
          await post(MEDIA_ROUTES.report, { ...scope, status: 'closed' });
        } catch (cause) {
          if (!snapshot.lost) throw cause;
        }
      });
      retiredScopes.set(key, result);
    }
    return result;
  }
  function makeParticipation() {
    const owner = bridge;
    let endingScope: MediaScope | null = null;
    return createParticipationLifetime({
      lock: () => {
        endingScope = mediaScope;
        participating = false;
        updateContext();
        bridge.runtime.setAudioOutputLock('locked');
      },
      clear: () => {
        challenge.clear();
        startPending = null;
        publish({ poseProgress: 0, exitStarting: false, keyIndex: 0 });
        faces.clear();
        events.clear();
        commands.clear();
        loading.clear();
        publish({ view: null, request: null, requests: {}, markers: [], exchangeNotice: null });
      },
      end: async () => {
        try {
          if (endingScope) await retireAndReport(owner, endingScope);
        } finally {
          await owner.runtime.endParticipation();
        }
      },
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
    const exit = exitCandidate(snapshot.view);
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
        (interaction.mode === 'keyboard' || snapshot.devices.calibration !== 'running') &&
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
        : exit && facesExit(own, exit)
          ? { exitId: exit.exitId }
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
    // LOAD_READY 는 장치 상태(카메라·추적·보정·소리)에 묶지 않는다. 얼굴 게시는 서버가 바인딩으로
    // 독립 확인하고, 추적이 잠깐 끊긴 것은 경기 중 폴백이 다룬다. 2026-09-14 실기기: 얼굴 6/6 확인에도
    // 클라이언트가 '장치 준비' 대기로 보고를 보내지 않아 30초 타임아웃이 반복됐다.
    loading.check(snapshot.view, bindings, snapshot.media);
    const pending =
      snapshot.round.phase === 'GAME_LOADING'
        ? describePending(
            loading.pending(snapshot.view, bindings, snapshot.media),
            bridge?.runtime.getReadinessTrace?.() ?? readinessTrace,
          )
        : [];
    if ((snapshot.loadingPending ?? []).join('|') !== pending.join('|'))
      publish({ loadingPending: pending });
  }
  function updateChallenge() {
    if (!bridge) return;
    const progress = challenge.update(
      snapshot.view,
      clock.renderTick() ?? snapshot.round?.serverTick ?? 0,
      deps.now(),
      bridge.sensors,
      sensorGeneration,
      snapshot.requests.EXIT_PROGRESS,
      participating && pageActive && snapshot.round?.phase === 'PLAYING',
      interaction.mode === 'keyboard' ? 'keys' : 'pose',
    );
    if (progress !== snapshot.poseProgress || challenge.keyIndex !== snapshot.keyIndex)
      publish({ poseProgress: progress, keyIndex: challenge.keyIndex });
  }
  function sendCommand(command: CommandInput) {
    if (!active || snapshot.lost || !snapshot.round) return '';
    const allowedAfterEnd = command.type === 'REMATCH';
    if (!participating && !allowedAfterEnd) return '';
    const currentTick = clock.renderTick() ?? snapshot.round.serverTick;
    if (!permitsExchange(snapshot.view, command, currentTick)) return '';
    const own = snapshot.view?.self;
    if (command.type === 'ROOM_LOCK' || command.type === 'ROOM_KICK') {
      if (
        !['LOBBY', 'DEVICE_CHECK'].includes(snapshot.round.phase) ||
        snapshot.roster?.hostId !== session.playerId ||
        !snapshot.roomAccess ||
        (command.type === 'ROOM_KICK' &&
          (command.payload.targetPlayerId === session.playerId ||
            !snapshot.roster.players.some(
              (player) => player.playerId === command.payload.targetPlayerId && player.connected,
            )))
      )
        return '';
    }
    if (command.type === 'PRACTICE_READY') {
      if (
        snapshot.round.phase !== 'TEAM_PRACTICE' ||
        (command.payload.ready &&
          !practicePresenter(snapshot.round, snapshot.view, snapshot.devices)?.canReady)
      )
        return '';
      if (command.payload.ready && practiceReadyReported)
        return commands.pending('PRACTICE_READY') ?? '';
      practiceReadyReported = command.payload.ready;
      publish({ practiceReady: practiceReadyReported });
    }
    if (command.type === 'EXIT_START') {
      if (startPending) return startPending.requestId;
      const exit = exitCandidate(snapshot.view);
      if (
        own?.status !== 'ACTIVE' ||
        own.challenge ||
        own.action ||
        own.exchange ||
        own.restraintUntilTick !== null ||
        !exit ||
        exit.exitId !== command.payload.exitId ||
        !facesExit(own, exit) ||
        snapshot.round.phase !== 'PLAYING'
      )
        return '';
    }
    if (command.type === 'EXIT_CANCEL' || command.type === 'EXIT_PROGRESS') {
      if (
        own?.status !== 'ACTIVE' ||
        own.challenge?.challengeId !== command.payload.challengeId ||
        snapshot.round.phase !== 'PLAYING'
      )
        return '';
      if (command.type === 'EXIT_CANCEL') challenge.suspend();
    }
    if (command.type === 'INSTALL') {
      const equipment = equipmentPresenter(snapshot.view, currentTick);
      if (
        !equipment ||
        equipment.locked ||
        equipment.installation ||
        equipment.remaining[command.payload.kind] <= 0
      )
        return '';
    }
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
        'EXIT_CANCEL',
        'EXCHANGE_REQUEST',
        'EXCHANGE_ACCEPT',
        'EXCHANGE_CANCEL',
        'REMATCH',
        'ROOM_LOCK',
        'ROOM_KICK',
      ].includes(command.type)
    ) {
      const pending = commands.pending(command.type);
      if (pending) return pending;
    }
    if (
      ['MOVE_INTENT', 'TURN', 'INSTALL', 'EXCHANGE_REQUEST', 'EXIT_START'].includes(command.type) &&
      (((!pageActive ||
        (interaction.mode === 'motion' && snapshot.devices.calibration === 'running')) &&
        !(command.type === 'MOVE_INTENT' && command.payload.direction === null)) ||
        !['PLAYING', 'TEAM_PRACTICE'].includes(snapshot.round.phase))
    )
      return '';
    if (command.type === 'EXIT_START') {
      startPending = { exitId: command.payload.exitId, requestId: '', until: null };
      publish({ exitStarting: true });
    }
    return commands.send(command);
  }
  function queueRecovery(scope: MediaScope, reported: Promise<unknown>) {
    const key = JSON.stringify(scope);
    if (recoveryQueued || recoveryAttempts.has(key)) {
      void reported.catch(failed('미디어 실패 상태 보고', MEDIA_REPORT_NOTICE));
      return;
    }
    recoveryAttempts.add(key);
    recoveryQueued = true;
    // The server owns the original 10-second deadline. One failed SDK replacement does not
    // recursively enqueue another replacement or restart that deadline on this client.
    void connectForView({ scope, reported }).finally(() => {
      recoveryQueued = false;
    });
  }
  async function connectForView(recovery?: { scope: MediaScope; reported: Promise<unknown> }) {
    const view = currentMediaContext();
    const round = snapshot.round;
    const allowedPhases = recovery ? recoveryMediaPhases : initialMediaPhases;
    if (
      !view ||
      !round ||
      !participating ||
      !allowedPhases.includes(round.phase) ||
      view.gameScope.kind === 'none'
    ) {
      if (recovery)
        void recovery.reported.catch(failed('미디어 실패 상태 보고', MEDIA_REPORT_NOTICE));
      return;
    }
    const key = `${round.matchId}:${view.gameScope.revision}:${view.gameScope.gameInstanceId}`;
    if (!recovery) {
      if (attemptedScope === key) return;
      attemptedScope = key;
    }
    const run = generation;
    const owner = bridge;
    const current = () =>
      active &&
      !snapshot.lost &&
      run === generation &&
      participating &&
      attemptedScope === key &&
      snapshot.round?.matchId === round.matchId &&
      allowedPhases.includes(snapshot.round.phase) &&
      currentMediaContext()?.gameScope.gameInstanceId === view.gameScope.gameInstanceId &&
      currentMediaContext()?.gameScope.revision === view.gameScope.revision;
    // Attach rejection handling immediately, even when another connect/publish owns mediaJob.
    const reported = recovery?.reported.then(
      () => true,
      () => false,
    );
    mediaJob = mediaJob.then(async () => {
      let mediaStage = 'MEDIA_PREPARATION_FAILED';
      try {
        if (reported && !(await reported)) throw new Error('MEDIA_UNAVAILABLE');
        if (!current() || (recovery && !sameMediaScope(recovery.scope))) return;
        const previous = recovery?.scope ?? lastIssuedMediaScope;
        if (previous)
          await retireAndReport(owner, previous, recovery ? 'reconnect' : 'phase-change');
        if (!current()) return;
        mediaScope = null;
        bindings = null;
        const grant = mediaGrantSchema.parse(
          await post(MEDIA_ROUTES.grants, {
            matchId: round.matchId,
            purpose: view.gameScope.kind,
            ...(previous !== null
              ? { previousReceiverGeneration: previous.receiverGeneration }
              : {}),
          }),
        );
        const invalidGrant =
          grant.matchId !== round.matchId ||
          (recovery &&
            (grant.mediaInstanceId !== recovery.scope.mediaInstanceId ||
              grant.receiverGeneration <= recovery.scope.receiverGeneration));
        const issuedScope = {
          matchId: grant.matchId,
          mediaInstanceId: grant.mediaInstanceId,
          receiverGeneration: grant.receiverGeneration,
        };
        if (!invalidGrant && run === generation && snapshot.round?.matchId === grant.matchId)
          lastIssuedMediaScope = issuedScope;
        if (!current() || invalidGrant) {
          await retireAndReport(owner, issuedScope);
          if (current() && invalidGrant) throw new Error('WRONG_SCOPE');
          return;
        }
        mediaScope = issuedScope;
        if (owner.runtime.getGenerationState() !== 'live') owner.runtime.beginMediaGeneration();
        mediaStage = 'MEDIA_CONNECT_FAILED';
        await owner.runtime.connectMedia(grant);
        if (!current() || !sameMediaScope(grant)) return;
        mediaStage = 'MEDIA_PUBLISH_FAILED';
        // SDK 가 연결 직후 재협상 중이면 첫 게시가 닫힌 peer connection 으로 실패할 수 있다
        // (2026-09-14 실기기: "could not createOffer with closed peer connection"). 한 번만 다시 시도한다.
        let faceSid: string | null;
        try {
          faceSid = await owner.runtime.publishMedia();
        } catch (firstFailure) {
          if (!current() || !sameMediaScope(grant)) return;
          await new Promise((resolve) => setTimeout(resolve, PUBLISH_RETRY_DELAY_MS));
          if (!current() || !sameMediaScope(grant)) return;
          if (owner.runtime.getGenerationState() !== 'live') throw firstFailure;
          faceSid = await owner.runtime.publishMedia();
        }
        if (!current() || !sameMediaScope(grant)) return;
        if (!faceSid) {
          mediaStage = 'FACE_PUBLICATION_MISSING';
          try {
            await post(MEDIA_ROUTES.report, { ...mediaScope, status: 'failed' });
          } finally {
            await retireAndReport(owner, mediaScope);
          }
          throw new Error('FACE_PUBLICATION_MISSING');
        }
        if (!current() || !sameMediaScope(grant)) return;
        send('media-bindings-refresh', { ...mediaScope, lastBindingRevision: 0 });
        updateLoading();
      } catch {
        if (current() && (recovery || !recoveryQueued))
          publish({ error: `미디어 준비에 실패했습니다. (${mediaStage})` });
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
    challenge.clear();
    startPending = null;
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
      sensorGeneration = -1;
      faces.clear();
      generation++;
      participating = false;
      attemptedScope = null;
      bindings = null;
      const old = bridge;
      const oldScope = mediaScope;
      mediaScope = null;
      lastIssuedMediaScope = null;
      mediaViewContext = null;
      const run = generation;
      publish({
        view: null,
        roster: null,
        roomAccess: null,
        endedSelf: null,
        devices: INITIAL_DEVICES,
        media: null,
        request: null,
      });
      void (async () => {
        try {
          if (oldScope) await retireAndReport(old, oldScope);
        } finally {
          await old.dispose();
        }
      })()
        .then(() => {
          if (!active || run !== generation) return;
          readinessTrace = null;
          publish({ faceGuidance: null });
          bridge = makeBridge();
          bridge.setPreviewHost(previewHost);
          participating = true;
          participation = makeParticipation();
          updateContext();
          void connectForView();
        })
        .catch(failed('경기 단계 전환 뒤 미디어 정리·재연결', CONNECTION_NOTICE));
    }
    if (phaseChanged) {
      practiceReadyReported = false;
      publish({ practiceReady: false, error: null });
      challenge.clear();
      startPending = null;
      publish({ poseProgress: 0, exitStarting: false });
      publish({ request: null, requests: {} });
      commands.clear();
    }
    publish({ round });
    // One measurement bucket per match: a rematch opens a new one and a decided
    // round closes it, so repeated matches stay comparable.
    deps.metrics?.startMatch(round.matchId);
    if (round.phase === 'RESULT' || round.phase === 'ABORTED') deps.metrics?.endMatch();
    if (!currentMediaContext()) mediaViewContext = null;
    commands.setMatch(round.matchId);
    heartbeat.setMatch(round.matchId);
    views.round(round);
    if (round.phase === 'RESULT' || round.phase === 'ABORTED')
      void participation.end().catch(failed('경기 종료 뒤 미디어 정리', null));
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
  on('room-access', (value) => {
    const result = roomAccessSchema.safeParse(value);
    if (
      result.success &&
      result.data.matchId === snapshot.round?.matchId &&
      result.data.revision >= (snapshot.roomAccess?.revision ?? -1)
    )
      publish({ roomAccess: result.data });
  });
  on('room-roster', (value) => {
    const result = roomRosterSchema.safeParse(value);
    if (
      result.success &&
      result.data.matchId === snapshot.round?.matchId &&
      result.data.stateVersion >= (snapshot.roster?.stateVersion ?? -1)
    ) {
      const ids = new Set(result.data.players.map((player) => player.playerId));
      audioPreferences = normalizeAudioPreferences({
        ...audioPreferences,
        mutedPlayerIds: audioPreferences.mutedPlayerIds.filter(
          (id) => ids.has(id) && id !== session.playerId,
        ),
      });
      bridge.runtime.setAudioPreferences(audioPreferences);
      publish({ roster: result.data });
    }
  });
  on('private-view', (value) => {
    if (views.receive(value)) void connectForView();
  });
  on('media-bindings', (value) => {
    const result = mediaBindingsSchema.safeParse(value);
    if (
      !result.success ||
      result.data.matchId !== snapshot.round?.matchId ||
      !participating ||
      !sameMediaScope(result.data) ||
      (bindings && result.data.bindingRevision <= bindings.bindingRevision)
    )
      return;
    bindings = result.data;
    bridge.runtime.applyMediaBindings(bindings);
    updateLoading();
  });
  on('audio-policy', (value) => {
    const result = audioPolicySchema.safeParse(value);
    if (
      result.success &&
      result.data.matchId === snapshot.round?.matchId &&
      participating &&
      sameMediaScope(result.data)
    )
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
    get sensors() {
      return bridge.sensors;
    },
    challengeMetrics: () => challenge.metrics(),
    challengeKey(key: ChallengeKey, repeat = false) {
      if (!participating || !pageActive || interaction.mode !== 'keyboard') return;
      updateChallenge();
      challenge.key(key, repeat);
      updateChallenge();
    },
    poll() {
      if (!active) return;
      heartbeat.poll();
      if (snapshot.lost) return;
      commands.poll();
      clock.poll();
      views.poll();
      events.poll();
      updateChallenge();
      // 대기 항목의 경과 시간을 갱신한다. 문자열이 바뀔 때만 발행하므로 초당 한 번 수준이다.
      if (snapshot.round?.phase === 'GAME_LOADING') updateLoading();
      if (startPending?.until !== null && startPending && deps.now() >= startPending.until) {
        startPending = null;
        const request = snapshot.requests.EXIT_START;
        publish({
          exitStarting: false,
          error: '도전 상태를 확인하지 못했습니다. 현재 출구 상태를 확인한 뒤 다시 시도해 주세요.',
          ...(request
            ? {
                request: { ...request, status: 'unconfirmed' },
                requests: {
                  ...snapshot.requests,
                  EXIT_START: { ...request, status: 'unconfirmed' },
                },
              }
            : {}),
        });
        send('view-resync', {
          matchId: snapshot.round?.matchId,
          lastStateVersion: snapshot.view?.stateVersion ?? 0,
        });
      }
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
    startDevices: (microphone: boolean) => {
      microphoneWanted = microphone;
      return bridge.startDevices(microphone).catch(failed('장치 시작', DEVICE_NOTICE));
    },
    async recoverDevices() {
      if (!canRecoverDevices()) return;
      deviceAction++;
      await bridge.startDevices(microphoneWanted).catch(failed('장치 복구', DEVICE_NOTICE));
    },
    async setMicrophone(enabled: boolean) {
      if (!canRecoverDevices()) return;
      microphoneWanted = enabled;
      await bridge
        .updateMicrophone(enabled)
        .catch(
          failed(
            '마이크 설정',
            '마이크 설정을 바꾸지 못했습니다. 브라우저의 마이크 권한을 확인해 주세요.',
          ),
        );
    },
    selectInputMode(mode: InteractionState['mode']) {
      if (!active || !participating || snapshot.lost) return;
      deviceAction++;
      if (mode === 'motion' && snapshot.devices.calibration !== 'ready') return;
      interaction = { ...interaction, mode };
      publish({ interaction });
      updateContext();
    },
    async calibrateMotion() {
      if (
        !canRecoverDevices() ||
        snapshot.devices.camera !== 'ready' ||
        snapshot.devices.calibration === 'running'
      )
        return;
      const owner = bridge;
      const run = ++deviceAction;
      try {
        const status = await owner.runtime.calibrate();
        if (!canRecoverDevices() || owner !== bridge || run !== deviceAction) return;
        interaction = {
          ...interaction,
          mode: status.calibration === 'ready' ? 'motion' : 'keyboard',
        };
        publish({ interaction });
        updateContext();
      } catch (cause) {
        if (!canRecoverDevices() || owner !== bridge || run !== deviceAction) return;
        interaction = { ...interaction, mode: 'keyboard' };
        publish({ interaction });
        updateContext();
        failed(
          '동작 보정',
          '보정을 마치지 못해 키보드 조작으로 바꿨습니다. 카메라에 얼굴과 어깨가 보이는지 확인한 뒤 다시 보정해 주세요.',
        )(cause);
      }
    },
    ready: (value: boolean) => bridge.ready(value),
    getLocalAudioStatus: () => ({
      ...bridge.runtime.getLocalAudioStatus(),
      preferences: audioPreferences,
    }),
    setAudioPreferences(value: AudioPreferences) {
      if (!active || !participating || snapshot.lost) return;
      const ids = new Set(snapshot.roster?.players.map((player) => player.playerId) ?? []);
      audioPreferences = normalizeAudioPreferences({
        ...value,
        mutedPlayerIds: value.mutedPlayerIds.filter((id) => ids.has(id) && id !== session.playerId),
      });
      bridge.runtime.setAudioPreferences(audioPreferences);
    },
    playTestTone: () => bridge.runtime.playTestTone(),
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
      audioPreferences = DEFAULT_AUDIO_PREFERENCES;
      try {
        await participation.leave();
      } finally {
        await bridge.dispose();
      }
    },
  };
}

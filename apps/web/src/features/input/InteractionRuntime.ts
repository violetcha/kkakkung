// D의 유일한 공개 진입점. C는 이 factory만 소비하고 devices/vision/media 구현을 직접 만들지 않는다.
// EXEC-CONTRACT-3 contracts/types.ts의 InteractionRuntime/InteractionDeps와 같은 모양이다.
//
// 구현 단계: D-01 장치 수명까지 완성. 이후 번호에서 같은 facade를 채운다.
// 미구현 메서드는 조용한 no-op이나 성공 Promise 대신 명확한 오류로 종결한다.
import {
  createDeviceManager,
  type AudioUnlockPort,
  type DeviceEnvironment,
  type DeviceManager,
} from '../devices/device-manager';
import {
  INITIAL_DEVICE_STATUS,
  type DeviceStatus,
  type DeviceStatusPatch,
} from '../devices/device-status';
import {
  createFramePump,
  createModelSelector,
  type FramePump,
  type FrameSource,
} from '../vision/frame-pump';
import { PINNED_MODEL_PATHS } from '../vision/worker-protocol';
import {
  createVisionWorker,
  createWorkerScheduler,
  type WorkerPort,
  type WorkerScheduler,
} from '../vision/worker-scheduler';
import {
  isSampleFresh,
  isUsableQuality,
  type Sample,
  type PoseSensor,
} from '../vision/sensor-types';
import { torsoLeanRad } from '../vision/pose-sensor';
import {
  createFaceCompositor,
  type CompositorContext,
  type CompositorEnvironment,
  type FaceCompositor,
} from '../media/face-compositor';
import { createSafeFacePolicy, type SafeFacePolicy } from '../media/safe-face';
import { createMediaSession, type MediaSession } from '../media/media-session';
import { createBindingStore, type BindingStore } from '../media/media-bindings';
import { createPendingTrackStore, type PendingTrackStore } from '../media/pending-tracks';
import {
  createRemoteFaces,
  type InstancePurpose,
  type RemoteFaces,
  type RemoteTrack,
} from '../media/remote-faces';
import { IDLE_MEDIA_STATUS, type MediaRoomFactory } from '../media/media-types';
import {
  createTrackPublisher,
  type PublisherPort,
  type PublicationRecord,
  type QualityPreset,
  type TrackPublisher,
} from '../media/track-publisher';
import { createCalibrator, isNeutralUsable, relativeToNeutral } from './calibration';
import { createContextStore, type ContextStore } from './interaction-context';
import {
  createGestureIntentController,
  type GameKey,
  type GestureIntentController,
} from './gesture-intent';
import { createInputFallback, type InputFallback } from './input-fallback';
import { createMoveIntentController, type MoveIntentController } from './move-intent';
import { createTurnIntentController, type TurnIntentController } from './turn-intent';
import { INPUT_TUNING, type InputTuning } from './input-tuning';
import type { SensorSnapshot } from '../vision/sensor-types';

export type { DeviceStatus } from '../devices/device-status';
export type {
  FaceSensor,
  GestureSensor,
  NormalizedLandmark,
  PoseSensor,
  Sample,
  SensorSnapshot,
} from '../vision/sensor-types';

export type {
  EquipmentKind,
  InputMode,
  InteractionContext,
  InteractionState,
  Phase,
  PlayerStatus,
  PoseKind,
  Role,
} from './interaction-context';

import type { EquipmentKind, InteractionContext, InteractionState } from './interaction-context';

export type MediaScope = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  receiverGeneration: number;
}>;

export type MediaGrant = MediaScope &
  Readonly<{
    url: string;
    token: string;
    roomName: string;
    mediaIdentity: string;
    expiresAt: number;
  }>;

export type MediaGrantRequest = Readonly<{
  matchId: string;
  purpose: 'practice' | 'game';
  previousReceiverGeneration?: number;
}>;

export type MediaStatusReport = MediaScope &
  Readonly<{ status: 'ready' | 'recovering' | 'failed' | 'closed' }>;

export type MediaRefreshRequest = MediaScope & Readonly<{ lastBindingRevision: number }>;

export type MediaBinding = Readonly<{
  playerId: string;
  publisherGeneration: number;
  mediaIdentity: string;
  participantSid: string;
  faceTrackSid?: string;
  audioTrackSid?: string;
}>;

export type MediaBindings = MediaScope &
  Readonly<{ bindingRevision: number; participants: readonly MediaBinding[] }>;

export type AudioPolicy = MediaScope &
  Readonly<{
    policyRevision: number;
    bindingRevision: number;
    stateVersion: number;
    voices: readonly Readonly<{
      playerId: string;
      trackSid: string;
      gain: number;
      azimuthRad: number;
      lowpassHz: number;
    }>[];
    effects: readonly Readonly<{
      eventId: string;
      kind: 'footstep' | 'sensor' | 'trap';
      gain: number;
      azimuthRad: number;
      lowpassHz: number;
      tick: number;
    }>[];
  }>;

export type MediaStatus = Readonly<{
  matchId: string | null;
  mediaInstanceId: string | null;
  receiverGeneration: number | null;
  state: 'idle' | 'connecting' | 'connected' | 'recovering' | 'closed' | 'failed';
  code: string | null;
}>;

export type FaceTrackEvent = MediaScope &
  Readonly<{
    playerId: string;
    publisherGeneration: number;
    trackSid: string;
    element: HTMLVideoElement | null;
  }>;

export type CommandPayloads = {
  MOVE_INTENT: { direction: 'forward' | 'back' | null };
  TURN: { direction: 'left' | 'right' };
  READY: { ready: boolean };
  PRACTICE_READY: { ready: boolean };
  LOAD_READY: { loadId: string; mediaInstanceId: string; receiverGeneration: number };
  EXCHANGE_REQUEST: { targetPlayerId: string };
  EXCHANGE_ACCEPT: { exchangeId: string };
  EXCHANGE_CANCEL: { exchangeId: string };
  INSTALL: { kind: EquipmentKind };
  INSTALL_CANCEL: { installationId: string };
  EXIT_START: { exitId: string };
  EXIT_CANCEL: { challengeId: string };
  EXIT_PROGRESS: { challengeId: string; method: 'pose' | 'keys'; completed: boolean };
  REMATCH: { mode: 'same' | 'swap' | 'lobby' };
};
export type CommandType = keyof CommandPayloads;
export type CommandInput = {
  [K in CommandType]: { type: K; payload: CommandPayloads[K] };
}[CommandType];

export type InteractionDeps = Readonly<{
  sendCommand: (command: CommandInput) => string;
  requestMediaGrant: (request: MediaGrantRequest) => Promise<MediaGrant>;
  reportMediaStatus: (report: MediaStatusReport) => Promise<void>;
  requestBindingsRefresh: (request: MediaRefreshRequest) => void;
  onDeviceStatus: (status: DeviceStatus) => void;
  onFaceTrack: (event: FaceTrackEvent) => void;
  onMediaStatus: (status: MediaStatus) => void;
  onSensors: (snapshot: SensorSnapshot) => void;
  onInteractionState: (state: InteractionState) => void;
  onLocalPreview: (element: HTMLVideoElement | null) => void;
}>;

export interface InteractionRuntime {
  startDevices(input: { microphone: boolean }): Promise<DeviceStatus>;
  calibrate(): Promise<DeviceStatus>;
  setContext(context: InteractionContext): void;
  connectMedia(grant: MediaGrant): Promise<void>;
  applyAudioPolicy(policy: AudioPolicy): void;
  applyMediaBindings(bindings: MediaBindings): void;
  setQualityPreset(preset: 'medium' | 'low'): void;
  retireMediaGeneration(): Promise<void>;
  /** D-14. 승인된 세대에서 가공 얼굴/선택 마이크를 게시한다. */
  publishMedia(): Promise<string | null>;
  getPublications(): readonly PublicationRecord[];
  /** D-15. SDK 구독 사건을 넘긴다. */
  addRemoteTrack(track: RemoteTrack): void;
  removeRemoteTrack(trackSid: string): void;
  endParticipation(): Promise<void>;
  dispose(): Promise<void>;
}

/** 아직 구현하지 않은 단계의 호출은 이 오류로 종결한다. 성공 stub을 만들지 않는다. */
export class InteractionNotImplementedError extends Error {
  constructor(
    readonly method: string,
    readonly plannedTask: string,
  ) {
    super(`${method} is not implemented yet (planned in ${plannedTask})`);
    this.name = 'InteractionNotImplementedError';
  }
}

/** 현재 facade가 실제로 구현한 단계. C가 호출 가능한 범위를 확인한다. */
export const IMPLEMENTED_STAGES = Object.freeze(['D-01'] as const);

/** D-06. 비전 파이프라인 주입점. 생략하면 실제 Worker와 video 프레임을 쓴다. */
export type VisionEnvironment = Readonly<{
  createWorker(): WorkerPort;
  createFrameSource(video: HTMLVideoElement): FrameSource;
  now(): number;
  setTimer(handler: () => void, delayMs: number): number;
  clearTimer(handle: number): void;
}>;

export type InteractionRuntimeOptions = Readonly<{
  /** 브라우저 자원 주입점. 생략하면 실제 DOM/navigator를 사용한다. */
  environment?: DeviceEnvironment;
  vision?: VisionEnvironment;
  compositor?: CompositorEnvironment;
  /** SDK Room 주입점. 생략하면 실제 livekit-client Room을 만든다. */
  createMediaRoom?: MediaRoomFactory;
  /** SDK LocalParticipant 주입점. 생략하면 게시를 시도하지 않는다. */
  getPublisher?: () => PublisherPort | null;
  /** 원격 video element 생성. 생략하면 document를 쓴다. */
  createRemoteElement?: () => HTMLVideoElement;
  /** SDK 구독 해제. 생략하면 아무 것도 하지 않는다. */
  unsubscribeTrack?: (track: RemoteTrack) => void;
  epochNowSeconds?: () => number;
  /** 키 listener를 붙일 대상. 생략하면 window다. */
  keyboardTarget?: KeyboardTarget;
  tuning?: InputTuning;
}>;

/** 보정 수집 상한. 이 시간 안에 충분한 표본이 없으면 미보정으로 끝낸다. */
export const CALIBRATION_WINDOW_MS = 2000;

function browserEnvironment(): DeviceEnvironment {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createPreviewElement: () => document.createElement('video'),
    createAudioUnlock: () => {
      const Constructor: typeof AudioContext | undefined =
        typeof AudioContext === 'undefined' ? undefined : AudioContext;
      if (!Constructor) return null;
      const context = new Constructor();
      const port: AudioUnlockPort = {
        get state() {
          return context.state;
        },
        resume: () => context.resume(),
        close: () => context.close(),
      };
      return port;
    },
    onDeviceChange: (listener) => {
      const target = navigator.mediaDevices;
      target.addEventListener('devicechange', listener);
      return () => target.removeEventListener('devicechange', listener);
    },
  };
}

function browserVision(): VisionEnvironment {
  return {
    createWorker: () => createVisionWorker() as unknown as WorkerPort,
    createFrameSource: (video) => ({
      schedule: (callback) => {
        // requestVideoFrameCallback이 있으면 표시 프레임에 맞춘다.
        const withCallback = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (handler: () => void) => number;
          cancelVideoFrameCallback?: (handle: number) => void;
        };
        if (typeof withCallback.requestVideoFrameCallback === 'function') {
          const handle = withCallback.requestVideoFrameCallback(callback);
          return () => withCallback.cancelVideoFrameCallback?.(handle);
        }
        const handle = requestAnimationFrame(() => callback());
        return () => cancelAnimationFrame(handle);
      },
      grab: async () => {
        if (video.readyState < 2 || video.videoWidth === 0) return null;
        return createImageBitmap(video);
      },
      now: () => performance.now(),
    }),
    now: () => performance.now(),
    setTimer: (handler, delayMs) => window.setTimeout(handler, delayMs),
    clearTimer: (handle) => window.clearTimeout(handle),
  };
}

function browserCompositor(): CompositorEnvironment {
  return {
    createCanvas: (width, height) => {
      // 일반 HTMLCanvasElement만 쓴다. OffscreenCanvas에서 captureStream을 부르지 않는다.
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return {
        width,
        height,
        getContext: (id) => canvas.getContext(id) as unknown as CompositorContext | null,
        captureStream: (frameRate) => canvas.captureStream(frameRate),
      };
    },
    now: () => performance.now(),
  };
}

/** D-11. D만 등록하는 게임 키. 방향키 시퀀스와 화면 취소 버튼은 C가 소유한다. */
const MOVE_KEYS: Readonly<Record<string, 'forward' | 'back'>> = Object.freeze({
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
});
const TURN_KEYS: Readonly<Record<string, 'left' | 'right'>> = Object.freeze({
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
});
const ACTION_KEYS: Readonly<Record<string, GameKey>> = Object.freeze({
  KeyE: 'E',
  KeyF: 'F',
  Digit1: '1',
  Digit2: '2',
  Escape: 'Escape',
});

/** 입력 요소나 IME 조합 중에는 게임 단축키를 만들지 않는다. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return element.isContentEditable === true;
}

export type KeyboardTarget = Readonly<{
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
}>;

export const createInteractionRuntime = (
  deps: InteractionDeps,
  options: InteractionRuntimeOptions = {},
): InteractionRuntime => {
  const tuning = options.tuning ?? INPUT_TUNING;
  let disposed = false;
  let devices: DeviceManager | null = null;
  let lastStatus: DeviceStatus = INITIAL_DEVICE_STATUS;

  // runtimeGeneration은 장치/비전을 새로 기동할 때마다 증가한다.
  let runtimeGeneration = 0;
  let scheduler: WorkerScheduler | null = null;
  let pump: FramePump | null = null;
  let modelsLoaded = false;
  let lastSnapshot: SensorSnapshot | null = null;
  let compositor: FaceCompositor | null = null;
  const safeFace: SafeFacePolicy = createSafeFacePolicy();
  const calibrator = createCalibrator(tuning);
  const context: ContextStore = createContextStore();
  let publisher: TrackPublisher | null = null;
  let qualityPreset: QualityPreset = 'medium';
  let mediaPurpose: InstancePurpose = 'game';
  const bindingStore: BindingStore = createBindingStore();
  const pendingTracks: PendingTrackStore = createPendingTrackStore();
  const remoteFaces: RemoteFaces = createRemoteFaces({
    bindings: bindingStore,
    createElement: () =>
      options.createRemoteElement?.() ??
      (typeof document === 'undefined'
        ? ({ srcObject: null } as unknown as HTMLVideoElement)
        : document.createElement('video')),
    now: () => vision.now(),
    onFaceTrack: (event) => {
      if (!disposed) deps.onFaceTrack(event);
    },
    unsubscribe: (track) => options.unsubscribeTrack?.(track),
    requestBindingsRefresh: (request) => deps.requestBindingsRefresh(request),
    getPurpose: () => mediaPurpose,
    pending: pendingTracks,
  });

  const ensurePublisher = (): TrackPublisher | null => {
    if (publisher) return publisher;
    const participant = options.getPublisher?.() ?? null;
    if (!participant) return null;
    publisher = createTrackPublisher({ participant, now: () => vision.now() });
    return publisher;
  };
  const media: MediaSession = createMediaSession({
    createRoom: () => {
      if (!options.createMediaRoom)
        throw new InteractionNotImplementedError('createMediaRoom', 'F/D 실제 SDK 주입');
      return options.createMediaRoom();
    },
    onStatus: (status) => {
      if (!disposed) deps.onMediaStatus(status);
    },
    epochNowSeconds: options.epochNowSeconds ?? (() => Math.floor(Date.now() / 1000)),
    getPhase: () => context.get()?.phase ?? null,
  });
  let keyboardBound: (() => void) | null = null;

  const move: MoveIntentController = createMoveIntentController({
    send: (direction) => {
      deps.sendCommand({ type: 'MOVE_INTENT', payload: { direction } });
    },
    now: () => vision.now(),
    setTimer: (handler, delayMs) => vision.setTimer(handler, delayMs),
    clearTimer: (handle) => vision.clearTimer(handle),
    tuning,
  });
  const turn: TurnIntentController = createTurnIntentController({
    send: (direction) => {
      deps.sendCommand({ type: 'TURN', payload: { direction } });
    },
    tuning,
  });
  const gestures: GestureIntentController = createGestureIntentController({
    context,
    send: (command) => deps.sendCommand(command as CommandInput),
    onInteractionState: (state) => deps.onInteractionState(state),
  });

  /** 문맥 변화·장애에서 이동 timer, 회전 latch, gesture hold를 함께 비운다. */
  const clearHolds = () => {
    move.release();
    turn.reset();
    gestures.reset();
  };

  /** 장애는 보조 입력 전환이다. 참가·Room·미디어 세대를 끝내지 않는다. */
  const fallback: InputFallback = createInputFallback({
    clearHolds,
    onModeChange: (nextMode) => {
      turn.setMode(nextMode);
      gestures.setMode(nextMode);
    },
    onFailure: (code) => {
      patch({ errorCode: code });
    },
  });
  let calibrationObserver: ((snapshot: SensorSnapshot) => void) | null = null;

  const vision = options.vision ?? browserVision();

  const patch = (value: DeviceStatusPatch) => {
    if (!devices) return;
    lastStatus = devices.patchStatus(value);
  };

  const stopVision = () => {
    pump?.stop();
    pump = null;
    scheduler?.dispose();
    scheduler = null;
    compositor?.dispose();
    compositor = null;
    safeFace.reset();
    modelsLoaded = false;
    lastSnapshot = null;
    calibrationObserver = null;
  };

  const hasFreshValidFace = (): boolean => {
    const face = lastSnapshot?.face ?? null;
    if (!isSampleFresh(face, 'face', vision.now())) return false;
    return face!.status === 'valid' && isUsableQuality(face!.data.quality);
  };

  /**
   * vision 상태를 다시 계산한다.
   * D-07 가공 프레임과 D-08 안전 프레임이 붙기 전에는 ready가 될 수 없다.
   */
  const refreshVisionStatus = () => {
    if (!scheduler) return;
    const ready = isVisionReady({
      modelsLoaded,
      hasFreshValidFace: hasFreshValidFace(),
      hasFirstSafeFrame: compositor?.hasFirstSafeFrame === true,
      hasLiveProcessedTrack: compositor?.isTrackLive === true,
    });
    patch({ vision: ready ? 'ready' : 'loading' });
  };

  /**
   * 보정된 상대 각도로만 이동/회전 의도를 만든다.
   * 보정 전이나 표본이 신선하지 않으면 null을 넣어 어떤 의도도 만들지 않는다.
   */
  const applyMotionIntents = (snapshot: SensorSnapshot) => {
    const nowMs = vision.now();
    if (!context.acceptsInput || context.inChallenge) {
      move.updateMotion(null, nowMs);
      turn.updateMotion(null, nowMs);
      return;
    }
    const neutral = calibrator.getNeutral();
    if (!isNeutralUsable(neutral, runtimeGeneration, tuning)) {
      move.updateMotion(null, nowMs);
      turn.updateMotion(null, nowMs);
      return;
    }
    const pose = snapshot.pose;
    const usablePose =
      isSampleFresh(pose, 'pose', nowMs) &&
      pose!.status === 'valid' &&
      isUsableQuality(pose!.data.quality);
    const lean = usablePose
      ? torsoLeanRad((pose as Sample<PoseSensor> & { status: 'valid' }).data.landmarks)
      : null;
    move.updateMotion(lean === null ? null : relativeToNeutral(lean, neutral.leanRad), nowMs);

    const face = snapshot.face;
    const usableFace =
      isSampleFresh(face, 'face', nowMs) &&
      face!.status === 'valid' &&
      isUsableQuality(face!.data.quality);
    turn.updateMotion(
      usableFace ? relativeToNeutral(face!.data.yawRad, neutral.yawRad) : null,
      nowMs,
    );
  };

  const publishSnapshot = (snapshot: SensorSnapshot) => {
    if (disposed) return;
    // 구 세대 결과는 발행하지 않는다.
    if (snapshot.runtimeGeneration !== runtimeGeneration) return;
    lastSnapshot = snapshot;
    // 가공 얼굴은 안전 프레임 정책이 정한 모드로만 그린다. raw 영상 fallback은 없다.
    if (compositor) {
      const decision = safeFace.decide(snapshot, vision.now(), runtimeGeneration);
      const face = snapshot.face;
      compositor.drawMode(decision.mode, face?.status === 'valid' ? face.data : null);
    }
    refreshVisionStatus();
    calibrationObserver?.(snapshot);
    fallback.observe(snapshot, vision.now(), runtimeGeneration);
    applyMotionIntents(snapshot);
    gestures.observe(snapshot, vision.now(), runtimeGeneration);
    deps.onSensors(snapshot);
  };

  const startVision = (video: HTMLVideoElement) => {
    if (scheduler) return;
    const generation = runtimeGeneration;
    {
      compositor = createFaceCompositor({
        environment: options.compositor ?? browserCompositor(),
        // 원본 video는 읽기만 한다. 게시 가능한 source는 compositor Canvas뿐이다.
        getSource: () =>
          video.videoWidth > 0
            ? { source: video, width: video.videoWidth, height: video.videoHeight }
            : null,
      });
    }
    const worker = vision.createWorker();
    const created = createWorkerScheduler(
      {
        worker,
        now: vision.now,
        onSnapshot: publishSnapshot,
        onError: (code) => {
          if (generation !== runtimeGeneration) return;
          fallback.report('WORKER_ERROR');
          patch({ vision: 'failed', errorCode: code });
        },
        onReady: () => {
          if (generation !== runtimeGeneration) return;
          modelsLoaded = true;
          // 모델 로드만으로 vision ready로 올리지 않는다. 나머지 조건은 D-07/D-08이 채운다.
          refreshVisionStatus();
        },
      },
      generation,
    );
    worker.onmessage = (event) => created.handleMessage(event.data);
    worker.onerror = () => created.handleWorkerError();
    worker.postMessage({ type: 'init', runtimeGeneration: generation, paths: PINNED_MODEL_PATHS });

    const models = createModelSelector();
    const frames = createFramePump({
      source: vision.createFrameSource(video),
      submit: (frame) => {
        const sent = created.submit(frame);
        if (sent) models.markSent(frame.sampledAtMs, frame.models);
        return sent;
      },
      selectModels: (nowMs) => models.select(nowMs),
      onError: (code) => {
        if (generation !== runtimeGeneration) return;
        patch({ vision: 'failed', errorCode: code });
      },
    });
    scheduler = created;
    pump = frames;
    patch({ vision: 'loading', errorCode: null });
    frames.start();
  };

  const bindKeyboard = () => {
    if (keyboardBound) return;
    const target = options.keyboardTarget ?? (typeof window === 'undefined' ? null : window);
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // 입력 요소·IME 조합 중에는 게임 단축키를 만들지 않는다.
      if (event.isComposing || isTextEntryTarget(event.target)) return;
      const action = ACTION_KEYS[event.code];
      if (action) {
        // Esc는 challenge 취소만 담당한다.
        if (gestures.pressKey(action) !== null) event.preventDefault();
        return;
      }
      if (!context.acceptsInput || context.inChallenge) return;
      const moveKey = MOVE_KEYS[event.code];
      if (moveKey) {
        if (!event.repeat) move.setKey(moveKey, true);
        event.preventDefault();
        return;
      }
      const turnKey = TURN_KEYS[event.code];
      if (turnKey) {
        turn.keyDown(turnKey, event.repeat);
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const moveKey = MOVE_KEYS[event.code];
      if (moveKey) {
        move.setKey(moveKey, false);
        return;
      }
      const turnKey = TURN_KEYS[event.code];
      if (turnKey) turn.keyUp(turnKey);
    };
    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    keyboardBound = () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
    };
  };

  const unbindKeyboard = () => {
    keyboardBound?.();
    keyboardBound = null;
  };

  const ensureDevices = (): DeviceManager => {
    if (devices) return devices;
    devices = createDeviceManager({
      environment: options.environment ?? browserEnvironment(),
      onStatus: (status) => {
        lastStatus = status;
        if (!disposed) deps.onDeviceStatus(status);
      },
      onLocalPreview: (element) => deps.onLocalPreview(element),
      onCameraTrack: (track) => {
        if (track !== null) return;
        // 원본이 사라지면 비전도 멈추고 보정을 버린다. 참가는 유지한다.
        stopVision();
        calibrator.reset();
        fallback.report('CAMERA_ENDED');
        patch({ vision: 'idle', calibration: 'idle' });
      },
    });
    return devices;
  };

  return {
    async startDevices(input) {
      if (disposed) return lastStatus;
      const manager = ensureDevices();
      const status = await manager.start(input);
      if (disposed) return status;
      const preview = manager.getPreviewElement();
      if (status.camera === 'ready' && preview && !scheduler) {
        runtimeGeneration += 1;
        startVision(preview);
      }
      return lastStatus;
    },

    async calibrate() {
      if (disposed || !devices) return lastStatus;
      if (lastStatus.camera !== 'ready') {
        patch({ calibration: 'failed', errorCode: 'CALIBRATION_NO_CAMERA' });
        return lastStatus;
      }
      const generation = runtimeGeneration;
      calibrator.begin(generation);
      patch({ calibration: 'running', errorCode: null });

      await new Promise<void>((resolve) => {
        let settled = false;
        let timer = 0;
        const finish = () => {
          if (settled) return;
          settled = true;
          calibrationObserver = null;
          vision.clearTimer(timer);
          resolve();
        };
        calibrationObserver = (snapshot) => {
          calibrator.observe(snapshot, vision.now());
          if (calibrator.sampleCount >= tuning.calibrationMinSamples) finish();
        };
        // 이미 받은 최신 표본도 한 번 확인한다.
        if (lastSnapshot) calibrationObserver(lastSnapshot);
        if (!settled) timer = vision.setTimer(finish, CALIBRATION_WINDOW_MS);
      });

      if (disposed || generation !== runtimeGeneration) return lastStatus;
      const result = calibrator.finish();
      if (result.state === 'ready')
        fallback.restoreMotion({
          calibrated: true,
          requestedMode: context.get()?.mode ?? 'motion',
        });
      patch(
        result.state === 'ready'
          ? { calibration: 'ready', errorCode: null }
          : { calibration: 'failed', errorCode: result.errorCode },
      );
      return lastStatus;
    },

    setContext(next: InteractionContext) {
      if (disposed) return;
      const change = context.set(next);
      if (change.shouldClearHolds) clearHolds();
      // pageActive=false이면 입력과 버퍼를 비우고 새 의도를 막는다.
      if (!context.acceptsInput) clearHolds();
      turn.setMode(next.mode);
      gestures.setMode(next.mode);
      bindKeyboard();
    },

    async connectMedia(grant) {
      if (disposed) return;
      await media.connect(grant);
    },

    applyAudioPolicy() {
      throw new InteractionNotImplementedError('applyAudioPolicy', 'D-16 / ME-06');
    },

    /** B의 검증 목록만 신원 매핑 근거로 쓴다. 이름·metadata로 추측하지 않는다. */
    applyMediaBindings(bindings) {
      if (disposed) return;
      const selfPlayerId = context.get()?.selfPlayerId ?? '';
      const result = bindingStore.apply(bindings, selfPlayerId);
      if (result.status !== 'applied') return;
      // 자기 항목은 게시 검증용으로만 읽는다.
      const self = bindingStore.getSelf();
      const scope = bindingStore.getScope();
      if (publisher && scope)
        publisher.confirmFromBindings(scope, self?.faceTrackSid ? [self.faceTrackSid] : []);
      // 바인딩이 뒤늦게 와도 이미 받은 publication을 다시 대조한다.
      remoteFaces.reconcile();
    },

    /** SDK TrackSubscribed. 검증 전에는 attach하지 않는다. */
    addRemoteTrack(track) {
      if (disposed) return;
      remoteFaces.addTrack(track);
    },

    removeRemoteTrack(trackSid) {
      if (disposed) return;
      remoteFaces.removeTrack(trackSid);
    },

    /** C VI-05의 저사양 전환. 이후 게시부터 낮은 인코딩을 쓴다. */
    setQualityPreset(preset) {
      qualityPreset = preset;
    },

    /** 가공 얼굴과 선택 마이크만 게시한다. 원본은 handle 검사에서 거절된다. */
    async publishMedia() {
      const scope = media.getScope();
      const target = ensurePublisher();
      if (!scope || !target) return null;
      const handle = compositor?.getHandle() ?? null;
      if (!handle) return null;
      const faceSid = await target.publishFace(handle, scope, qualityPreset);
      const microphone = devices?.getMicrophoneTrack() ?? null;
      if (microphone) await target.publishMicrophone(microphone, scope);
      return faceSid;
    },

    getPublications() {
      return publisher?.getPublications() ?? [];
    },

    /** 미디어 세대만 끝낸다. 논리 참가 종료(D-17)와 분리한다. */
    async retireMediaGeneration() {
      remoteFaces.clear();
      bindingStore.reset();
      await publisher?.unpublishAll();
      publisher = null;
      await media.retire();
    },

    /** 논리 참가 종료. D-17에서 미디어 세대 종료와 분리해 확장한다. */
    async endParticipation() {
      unbindKeyboard();
      clearHolds();
      context.clear();
      fallback.reset();
      remoteFaces.clear();
      bindingStore.reset();
      await publisher?.unpublishAll();
      publisher = null;
      await media.dispose();
      deps.onMediaStatus(IDLE_MEDIA_STATUS);
      stopVision();
      calibrator.reset();
      await devices?.dispose();
      devices = null;
      runtimeGeneration += 1;
    },

    async dispose() {
      if (disposed) return;
      unbindKeyboard();
      clearHolds();
      context.clear();
      remoteFaces.clear();
      bindingStore.reset();
      await publisher?.unpublishAll();
      publisher = null;
      await media.dispose();
      disposed = true;
      stopVision();
      calibrator.reset();
      await devices?.dispose();
      devices = null;
    },
  };
};

/** vision ready 판정에 필요한 입력. 아직 없는 조건을 참으로 가정하지 않는다. */
export type VisionReadinessInputs = Readonly<{
  modelsLoaded: boolean;
  hasFreshValidFace: boolean;
  hasFirstSafeFrame: boolean;
  hasLiveProcessedTrack: boolean;
}>;

/**
 * vision ready는 모델 로드만으로 성립하지 않는다.
 * 유효 얼굴·첫 안전 가공 프레임·살아있는 가공 트랙까지 모두 있어야 한다.
 */
export function isVisionReady(inputs: VisionReadinessInputs): boolean {
  return (
    inputs.modelsLoaded &&
    inputs.hasFreshValidFace &&
    inputs.hasFirstSafeFrame &&
    inputs.hasLiveProcessedTrack
  );
}

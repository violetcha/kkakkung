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
import { isSampleFresh, isUsableQuality } from '../vision/sensor-types';
import { createCalibrator } from './calibration';
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

export type Role = 'runner' | 'tagger';
export type PlayerStatus = 'ACTIVE' | 'ESCAPED' | 'CAPTURED';
export type EquipmentKind = 'sensor' | 'trap';
export type PoseKind = 'left' | 'right' | 'y';
export type Phase =
  | 'LOBBY'
  | 'DEVICE_CHECK'
  | 'TEAM_PRACTICE'
  | 'MAP_FINALIZING'
  | 'GAME_LOADING'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'RESULT'
  | 'ABORTED';

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

export type InteractionContext = Readonly<{
  matchId: string;
  selfPlayerId: string;
  role: Role | null;
  phase: Phase;
  status: PlayerStatus;
  targetPlayerId?: string;
  incomingExchangeId?: string;
  outgoingExchangeId?: string;
  challengeId?: string;
  exitId?: string;
  poseKind?: PoseKind;
  selectedEquipment?: EquipmentKind;
  installationId?: string;
  mode: 'motion' | 'keyboard';
  pageActive: boolean;
}>;

export type InteractionState = Readonly<{
  selectedEquipment: EquipmentKind;
  mode: 'motion' | 'keyboard';
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
  const calibrator = createCalibrator(tuning);
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
      hasFirstSafeFrame: false,
      hasLiveProcessedTrack: false,
    });
    patch({ vision: ready ? 'ready' : 'loading' });
  };

  const publishSnapshot = (snapshot: SensorSnapshot) => {
    if (disposed) return;
    // 구 세대 결과는 발행하지 않는다.
    if (snapshot.runtimeGeneration !== runtimeGeneration) return;
    lastSnapshot = snapshot;
    refreshVisionStatus();
    calibrationObserver?.(snapshot);
    deps.onSensors(snapshot);
  };

  const startVision = (video: HTMLVideoElement) => {
    if (scheduler) return;
    const generation = runtimeGeneration;
    const worker = vision.createWorker();
    const created = createWorkerScheduler(
      {
        worker,
        now: vision.now,
        onSnapshot: publishSnapshot,
        onError: (code) => {
          if (generation !== runtimeGeneration) return;
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
        // 원본이 사라지면 비전도 멈추고 보정을 버린다.
        stopVision();
        calibrator.reset();
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
      patch(
        result.state === 'ready'
          ? { calibration: 'ready', errorCode: null }
          : { calibration: 'failed', errorCode: result.errorCode },
      );
      return lastStatus;
    },

    setContext() {
      throw new InteractionNotImplementedError('setContext', 'D-11 / IN-09');
    },

    connectMedia() {
      return Promise.reject(new InteractionNotImplementedError('connectMedia', 'D-13 / ME-03'));
    },

    applyAudioPolicy() {
      throw new InteractionNotImplementedError('applyAudioPolicy', 'D-16 / ME-06');
    },

    applyMediaBindings() {
      throw new InteractionNotImplementedError('applyMediaBindings', 'D-15 / ME-05');
    },

    setQualityPreset() {
      throw new InteractionNotImplementedError('setQualityPreset', 'D-14 / ME-04');
    },

    retireMediaGeneration() {
      return Promise.reject(
        new InteractionNotImplementedError('retireMediaGeneration', 'D-17 / ME-07'),
      );
    },

    /** 논리 참가 종료. D-17에서 미디어 세대 종료와 분리해 확장한다. */
    async endParticipation() {
      stopVision();
      calibrator.reset();
      await devices?.dispose();
      devices = null;
      runtimeGeneration += 1;
    },

    async dispose() {
      if (disposed) return;
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

// D의 유일한 공개 진입점. C는 이 factory만 소비하고 devices/vision/media 구현을 직접 만들지 않는다.
// EXEC-CONTRACT-3 tests/contracts/shared/types.ts의 InteractionRuntime/InteractionDeps와 같은 모양이다.
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
import { leanComponents, relativeLean } from './lean-signal';
import { describeMotionDebug, type MotionDebugState } from './motion-debug';
import {
  createFaceCompositor,
  type CompositorContext,
  type CompositorEnvironment,
  type FaceCompositor,
} from '../media/face-compositor';
import { createSafeFacePolicy, type SafeFacePolicy } from '../media/safe-face';
import {
  classifyFaceCondition,
  createFaceConditionNotifier,
  ovalMissingRatio,
  type FaceConditionNotice,
  type FaceConditionNotifier,
} from '../media/face-condition';
import {
  createLuminanceSampler,
  type LuminanceCanvas,
  type LuminanceSampler,
} from '../media/face-luminance';
import { buildFaceMask } from '../media/face-mask';
import { composeMediaEvidence, type MediaEvidence } from '../media/media-evidence';
import {
  createReadinessRecorder,
  describeClientEnvironment,
  type ReadinessRecorder,
  type ReadinessTrace,
} from '../devices/readiness-trace';
import { createMediaSession, type MediaSession } from '../media/media-session';
import { createBindingStore, type BindingStore } from '../media/media-bindings';
import {
  createAudioGraph,
  type AudioGraph,
  type AudioGraphEnvironment,
  type AudioNodeLike,
  type OutputLock,
} from '../media/audio-graph';
import { createPolicyStore, type AudioPolicy, type PolicyStore } from '../media/audio-policy';
import { createEffectBuffer } from '../media/effect-buffer';
import { createAudioDiagnostics } from '../media/audio-diagnostics';
import { createAudioCues, type CueResult } from '../media/audio-cues';
import type { CueKind } from '../media/cue-buffer';
export type { CueKind } from '../media/cue-buffer';
export type { CueResult } from '../media/audio-cues';
import {
  DEFAULT_AUDIO_PREFERENCES,
  normalizeAudioPreferences,
  type AudioPreferences,
  type LocalAudioStatus,
  type TestToneResult,
} from '../media/audio-preferences';
export type {
  AudioPreferences,
  LocalAudioStatus,
  TestToneResult,
} from '../media/audio-preferences';
import {
  createMediaLifecycle,
  type MediaLifecycle,
  type RetireReason,
} from '../media/media-lifecycle';

export type { AudioEffect, AudioPolicy, AudioVoice } from '../media/audio-policy';
export type { OutputLock } from '../media/audio-graph';
export type { GenerationState, RetireReason } from '../media/media-lifecycle';
import {
  createPendingTrackStore,
  PENDING_TRACK_TTL_MS,
  type PendingTrackStore,
} from '../media/pending-tracks';
import {
  createRemoteFaces,
  remoteFaceLimit,
  type InstancePurpose,
  type RemoteFaces,
  type RemoteTrack,
} from '../media/remote-faces';
import { IDLE_MEDIA_STATUS, type MediaRoomFactory } from '../media/media-types';
import {
  createLiveKitAdapter,
  loadLiveKit,
  type LiveKitAdapter,
  type LiveKitModule,
} from '../media/livekit-adapter';
import {
  createTrackPublisher,
  type PublisherPort,
  type PublicationRecord,
  type QualityPreset,
  type TrackPublisher,
} from '../media/track-publisher';
import { createCalibrator, isNeutralUsable, relativeToNeutral } from './calibration';
import { createMotionSampleFilter } from './motion-sample-filter';
import { createContextStore, type ContextStore } from './interaction-context';
import {
  createGestureIntentController,
  type GameKey,
  type GestureIntentController,
} from './gesture-intent';
import { createInputFallback, type InputFallback } from './input-fallback';
import { createMoveIntentController, type MoveIntentController } from './move-intent';
import { createTurnIntentController, type TurnIntentController } from './turn-intent';
import { INPUT_TUNING, headTurnedForMove, type InputTuning } from './input-tuning';
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
    subscriptionMode?: 'publisher-permissions' | 'server-forwarding';
    /** Only server-forwarding: CAMERA-only source, distinct from the MIC/receive room. */
    facePublication?: Readonly<{
      url: string;
      token: string;
      roomName: string;
      mediaIdentity: string;
    }>;
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
  /** Present when the face has a distinct, server-verified publisher in this receiver room. */
  facePublisher?: Readonly<{ mediaIdentity: string; participantSid: string }>;
  faceTrackSid?: string;
  audioTrackSid?: string;
}>;

export type MediaBindings = MediaScope &
  Readonly<{ bindingRevision: number; participants: readonly MediaBinding[] }>;

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
  /** 진단 오버레이용(features/debug). 판정과 무관하며 생략 가능. 제거 시 함께 지운다. */
  onMotionDebug?: (state: MotionDebugState) => void;
  /**
   * S15P21C204-244. 얼굴 조건 안내. 보여 줄 안내가 없으면 null로 부른다.
   * 생략 가능하며 안내를 표시하지 않아도 안전 전환 자체는 그대로 동작한다.
   */
  onFaceGuidance?: (notice: FaceConditionNotice | null) => void;
  /**
   * S15P21C204-240. 준비 단계 기록이 바뀔 때마다 부른다. 생략 가능하다.
   * 여기 담긴 시간은 전부 클라이언트 구간이며 서버 응답 대기는 들어 있지 않다.
   */
  onReadinessTrace?: (trace: ReadinessTrace) => void;
}>;

export interface InteractionRuntime {
  startDevices(input: { microphone: boolean }): Promise<DeviceStatus>;
  setMicrophone(enabled: boolean): Promise<DeviceStatus>;
  calibrate(): Promise<DeviceStatus>;
  setContext(context: InteractionContext): void;
  connectMedia(grant: MediaGrant): Promise<void>;
  applyAudioPolicy(policy: AudioPolicy): void;
  applyMediaBindings(bindings: MediaBindings): void;
  setQualityPreset(preset: 'medium' | 'low'): void;
  retireMediaGeneration(reason?: RetireReason): Promise<void>;
  /** D-17. 회수 확인 뒤 새 미디어 세대를 연다. */
  beginMediaGeneration(): void;
  getGenerationState(): 'live' | 'terminal' | 'closed';
  /**
   * S15P21C204-240. 지금까지의 준비 단계 기록. 증거 수집과 화면 표시가 같은 값을 읽는다.
   * 제품 runtime 은 항상 구현한다. 선택으로 둔 것은 C 소유 시험 fixture 가 이 facade 를
   * 부분 구현하고 있어서이며, 호출 측은 `runtime.getReadinessTrace?.()` 로 읽는다.
   */
  getReadinessTrace?(): ReadinessTrace;
  /**
   * S15P21C204-246. G1·G5·G6가 요구하는 실제 트랙·음성 증거.
   * 판정하지 않고 사실만 모은다. 관문 판정은 F runner가 한다.
   * `getReadinessTrace`와 같은 이유로 선택 메서드다.
   */
  getMediaEvidence?(): MediaEvidence;
  /** D-14. 승인된 세대에서 가공 얼굴/선택 마이크를 게시한다. */
  publishMedia(): Promise<string | null>;
  getPublications(): readonly PublicationRecord[];
  /**
   * S15P21C204-295. 게시되는 것과 같은 가공 얼굴(얼굴만 잘라 흑백) 스트림. 내 캐릭터 미리보기 등
   * 로컬 표시용이며 게시 경로는 여전히 handle 검사를 거친다. 장치를 켜기 전에는 null.
   */
  getProcessedFaceStream?(): MediaStream | null;
  /** D-15. SDK 구독 사건을 넘긴다. */
  addRemoteTrack(track: RemoteTrack): void;
  removeRemoteTrack(trackSid: string): void;
  /** D-16. COUNTDOWN 등에서 출력을 잠근다. */
  setAudioOutputLock(lock: OutputLock): void;
  setAudioPreferences(preferences: AudioPreferences): void;
  getLocalAudioStatus(): LocalAudioStatus;
  playTestTone(): Promise<TestToneResult>;
  /**
   * S15P21C204-261. 자기 상태 안내음. 출력 잠금과 무관하게 음소거·음량만 따른다. 장치 점검에서
   * 연 Context가 없으면 'unavailable'. 시험용 부분 구현 fixture 때문에 선택 메서드다.
   */
  playCue?(kind: CueKind): CueResult;
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
  /** SDK Room 주입점. 생략하면 loadLiveKit()으로 실제 livekit-client Room을 만든다. */
  createMediaRoom?: MediaRoomFactory;
  /** SDK 모듈 적재 주입점. 생략하면 livekit-client를 동적 import한다. 시험은 가짜 모듈을 준다. */
  loadLiveKit?: () => Promise<LiveKitModule>;
  /** SDK LocalParticipant 주입점. 생략하면 SDK 어댑터의 LocalParticipant를 쓴다. */
  getPublisher?: () => PublisherPort | null;
  /** 원격 video element 생성. 생략하면 document를 쓴다. */
  createRemoteElement?: () => HTMLVideoElement;
  /** SDK 구독 해제 주입점. 생략하면 SDK 어댑터가 setSubscribed(false)를 부른다. */
  unsubscribeTrack?: (track: RemoteTrack) => void;
  /** 사용자 제스처로 연 AudioContext 기반 그래프. 생략하면 오디오를 구성하지 않는다. */
  audio?: AudioGraphEnvironment;
  /** 검증된 오디오 트랙 조회 주입점. 생략하면 SDK 어댑터의 구독 트랙을 읽는다. */
  getAudioTrack?: (trackSid: string) => MediaStreamTrack | null;
  epochNowSeconds?: () => number;
  /** 키 listener를 붙일 대상. 생략하면 window다. */
  keyboardTarget?: KeyboardTarget;
  /** S15P21C204-244. 탭 이탈 감지 주입점. 생략하면 document를 쓴다. */
  visibility?: VisibilitySource;
  /** S15P21C204-244. 휘도 표본용 Canvas 주입점. 생략하면 document로 만든다. */
  createLuminanceCanvas?: (width: number, height: number) => LuminanceCanvas;
  tuning?: InputTuning;
}>;

/** 탭 이탈을 알려 주는 최소 인터페이스. document의 부분집합이다. */
export type VisibilitySource = Readonly<{
  isHidden(): boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}>;

/** 보정 수집 상한. 이 시간 안에 충분한 표본이 없으면 미보정으로 끝낸다. */
export const CALIBRATION_WINDOW_MS = 2000;
export const MODEL_LOAD_TIMEOUT_MS = 30_000;
export const FIRST_INFERENCE_TIMEOUT_MS = 5000;

function browserEnvironment(createAudioUnlock: () => AudioUnlockPort | null): DeviceEnvironment {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createPreviewElement: () => document.createElement('video'),
    createAudioUnlock,
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

/**
 * S15P21C204-244. 탭 이탈 감지의 기본 구현.
 * document 가 없거나 listener를 갖추지 않은 환경(시험 stub 포함)에서는 "항상 보이는" 것으로
 * 다룬다. 감지를 못 하는 것이 안전 전환 자체를 막지는 않는다.
 */
function browserVisibility(): VisibilitySource {
  const source: Partial<Document> | null = typeof document === 'undefined' ? null : document;
  const usable =
    source !== null &&
    typeof source.addEventListener === 'function' &&
    typeof source.removeEventListener === 'function';
  if (!usable)
    return { isHidden: () => false, addEventListener: () => {}, removeEventListener: () => {} };
  return {
    isHidden: () => source.visibilityState === 'hidden',
    addEventListener: (type, listener) => source.addEventListener!(type, listener),
    removeEventListener: (type, listener) => source.removeEventListener!(type, listener),
  };
}

/**
 * S15P21C204-244. 휘도 표본 전용 Canvas. 게시 경로와 분리한다.
 * captureStream을 부르지 않으므로 이 Canvas의 픽셀은 밖으로 나가지 않는다.
 */
function browserLuminanceCanvas(width: number, height: number): LuminanceCanvas {
  // Canvas를 만들 수 없는 환경에서는 표본을 포기한다. 휘도 없이도 회전·가림은 판정된다.
  if (typeof document === 'undefined' || typeof document.createElement !== 'function')
    return { getContext: () => null };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // 자주 읽으므로 willReadFrequently로 CPU 백업 버퍼를 쓰게 한다.
  return {
    getContext: (id) =>
      canvas.getContext(id, { willReadFrequently: true }) as unknown as ReturnType<
        LuminanceCanvas['getContext']
      >,
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

/**
 * 사용자 제스처로 연 AudioContext를 재사용하는 기본 그래프 환경.
 * 브라우저에 Web Audio가 없으면 null이며 그때는 오디오를 구성하지 않는다.
 */
function browserAudio(): (AudioGraphEnvironment & AudioUnlockPort) | null {
  if (typeof AudioContext === 'undefined') return null;
  const context = new AudioContext();
  const diagnostics = createAudioDiagnostics(context);
  const cues = createAudioCues(context);
  const effectBuffers = new Map<
    Parameters<AudioGraphEnvironment['createEffectSource']>[0],
    AudioBuffer
  >();
  const master = context.createGain();
  master.connect(context.destination);
  const wrap = <T extends AudioNode>(node: T) => ({
    node,
    connect: (target: AudioNodeLike): void => {
      const sink = (target as { node?: AudioNode }).node ?? context.destination;
      node.connect(sink);
    },
    disconnect: (): void => node.disconnect(),
  });
  return {
    get state() {
      return context.state;
    },
    diagnostics,
    cues,
    resume: () => context.resume(),
    close: async () => {
      diagnostics.dispose();
      cues.dispose();
      master.disconnect();
      effectBuffers.clear();
      await context.close();
    },
    createSourceFromTrack: (track) => {
      const stream = new MediaStream([track]);
      const source = context.createMediaStreamSource(stream);
      // Chromium needs a playing media sink to render remote WebRTC audio reliably.
      // It is silent: all audible output still goes through the policy-controlled graph.
      const sink = document.createElement('audio');
      sink.autoplay = true;
      sink.volume = 0;
      sink.srcObject = stream;
      void sink.play().catch(() => {});
      return {
        ...wrap(source),
        disconnect: () => {
          source.disconnect();
          sink.pause();
          sink.srcObject = null;
        },
      };
    },
    createEffectSource: (kind) => {
      const source = context.createBufferSource();
      let buffer = effectBuffers.get(kind);
      if (!buffer) {
        buffer = createEffectBuffer(context, kind);
        effectBuffers.set(kind, buffer);
      }
      source.buffer = buffer;
      return {
        ...wrap(source),
        start: () => source.start(),
        stop: () => source.stop(),
        onEnded: (listener) => {
          source.onended = listener;
        },
      };
    },
    createGain: () => {
      const gain = context.createGain();
      return {
        ...wrap(gain),
        get gainValue() {
          return gain.gain.value;
        },
        set gainValue(value: number) {
          gain.gain.value = value;
        },
      };
    },
    createFilter: () => {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      return {
        ...wrap(filter),
        get frequency() {
          return filter.frequency.value;
        },
        set frequency(value: number) {
          filter.frequency.value = value;
        },
      };
    },
    createPanner: () => {
      const panner = context.createStereoPanner();
      return {
        ...wrap(panner),
        get azimuthRad() {
          return Math.asin(panner.pan.value);
        },
        set azimuthRad(value: number) {
          panner.pan.value = Math.max(-1, Math.min(1, Math.sin(value)));
        },
      };
    },
    destination: {
      node: context.destination,
      connect: () => undefined,
      disconnect: () => undefined,
    },
    masterGain: {
      node: master,
      connect: () => undefined,
      disconnect: () => master.disconnect(),
      get gainValue() {
        return master.gain.value;
      },
      set gainValue(value: number) {
        master.gain.value = value;
      },
    },
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
  let modelTimer: number | null = null;
  let modelReadyAt = 0;
  let lastSnapshot: SensorSnapshot | null = null;
  let compositor: FaceCompositor | null = null;
  const safeFace: SafeFacePolicy = createSafeFacePolicy();
  // S15P21C204-240. 준비 단계 기록.
  const readiness: ReadinessRecorder = createReadinessRecorder();
  const reportReadiness = () => {
    if (disposed || !deps.onReadinessTrace) return;
    deps.onReadinessTrace(readiness.snapshot(vision.now()));
  };
  // S15P21C204-244. 조건 안내와 탭 이탈 안전 전환.
  const conditionNotifier: FaceConditionNotifier = createFaceConditionNotifier();
  let luminance: LuminanceSampler | null = null;
  let lastNotice: FaceConditionNotice | null = null;
  const visibility: VisibilitySource = options.visibility ?? browserVisibility();
  const calibrator = createCalibrator(tuning);
  const context: ContextStore = createContextStore();
  let publisher: TrackPublisher | null = null;
  /** 제품 경로의 SDK 어댑터. createMediaRoom 주입이 있으면 만들지 않는다. */
  let liveKit: LiveKitAdapter | null = null;
  let qualityPreset: QualityPreset = 'medium';
  /** 연습 상한(2명)과 본 경기 상한(5명)은 권위 phase에서 파생한다. */
  const currentPurpose = (): InstancePurpose =>
    context.get()?.phase === 'TEAM_PRACTICE' ? 'practice' : 'game';
  const bindingStore: BindingStore = createBindingStore();
  let acceptedScope: MediaScope | null = null;
  const matchesAcceptedScope = (scope: MediaScope) =>
    acceptedScope !== null &&
    scope.matchId === acceptedScope.matchId &&
    scope.mediaInstanceId === acceptedScope.mediaInstanceId &&
    scope.receiverGeneration === acceptedScope.receiverGeneration;
  const policyStore: PolicyStore = createPolicyStore(bindingStore);
  let audioGraph: AudioGraph | null = null;
  let sharedAudio: (AudioGraphEnvironment & AudioUnlockPort) | null = null;
  let audioOutputLock: OutputLock = 'locked';
  let audioPreferences = DEFAULT_AUDIO_PREFERENCES;
  const localAudio = () => (options.audio ?? sharedAudio)?.diagnostics;
  const canMonitorAudio = () => {
    const current = context.get();
    return (
      !disposed &&
      lifecycle.canOperate() &&
      current?.pageActive === true &&
      current.status === 'ACTIVE' &&
      !['RESULT', 'ABORTED'].includes(current.phase)
    );
  };
  const canTestAudio = () => {
    const current = context.get();
    return (
      canMonitorAudio() &&
      current !== null &&
      ['DEVICE_CHECK', 'TEAM_PRACTICE'].includes(current.phase)
    );
  };

  const ensureAudio = (): AudioGraph | null => {
    if (audioGraph) return audioGraph;
    // 실제 Context는 장치 점검 클릭에서 생성·재개하고 세대 사이에 재사용한다.
    const environment = options.audio ?? sharedAudio;
    if (!environment) return null;
    audioGraph = createAudioGraph({
      environment,
      // 주입이 없으면 SDK 어댑터가 들고 있는 구독 오디오 트랙을 읽는다.
      getAudioTrack: (trackSid) =>
        options.getAudioTrack?.(trackSid) ?? liveKit?.getAudioTrack(trackSid) ?? null,
    });
    audioGraph.setOutputLock(audioOutputLock);
    audioGraph.setPreferences(audioPreferences);
    return audioGraph;
  };

  /** 정책·바인딩·트랙 중 어느 입력이 바뀌어도 다시 맞춘다. */
  const reconcileAudio = () => {
    policyStore.revisit(vision.now());
    const policy = policyStore.getPolicy();
    if (policy && policy.bindingRevision === bindingStore.getRevision())
      liveKit?.applyPublisherPermissions(policy);
    else liveKit?.clearPublisherPermissions();
    const graph = ensureAudio();
    graph?.reconcileVoices(policyStore.resolveVoices());
  };
  const pendingTracks: PendingTrackStore = createPendingTrackStore();
  let sweepTimer: number | null = null;

  /** 보류가 남아 있는 동안만 만료 청소를 예약한다. 무한 polling을 만들지 않는다. */
  const scheduleSweep = () => {
    if (sweepTimer !== null || pendingTracks.size === 0) return;
    sweepTimer = vision.setTimer(() => {
      sweepTimer = null;
      if (disposed) return;
      remoteFaces.sweep();
      scheduleSweep();
    }, PENDING_TRACK_TTL_MS);
  };

  const stopSweep = () => {
    if (sweepTimer === null) return;
    vision.clearTimer(sweepTimer);
    sweepTimer = null;
  };
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
    // 검증되지 않은 트랙은 실제로 구독을 멈춘다. 주입이 없으면 SDK 어댑터가 처리한다.
    unsubscribe: (track) => {
      if (options.unsubscribeTrack) options.unsubscribeTrack(track);
      else liveKit?.unsubscribeTrack(track);
    },
    requestBindingsRefresh: (request) => deps.requestBindingsRefresh(request),
    getPurpose: currentPurpose,
    pending: pendingTracks,
  });

  /** SDK TrackSubscribed 처리. 어댑터와 C의 직접 호출이 같은 경로를 쓴다. */
  const handleRemoteTrack = (track: RemoteTrack) => {
    if (disposed || !lifecycle.canOperate()) return;
    remoteFaces.addTrack(track);
    if (track.kind === 'audio') reconcileAudio();
    scheduleSweep();
  };

  const handleRemoteTrackRemoved = (trackSid: string) => {
    if (disposed) return;
    remoteFaces.removeTrack(trackSid);
    reconcileAudio();
  };

  /**
   * 제품 경로의 SDK를 적재한다. createMediaRoom 주입이 있으면 SDK를 건드리지 않는다.
   * 동적 import라 연결을 한 번도 하지 않는 세션은 SDK를 내려받지 않는다.
   */
  const ensureLiveKit = async (): Promise<void> => {
    if (options.createMediaRoom || liveKit || disposed) return;
    const adapter = createLiveKitAdapter(await (options.loadLiveKit ?? loadLiveKit)(), {
      onRemoteTrack: handleRemoteTrack,
      onRemoteTrackRemoved: handleRemoteTrackRemoved,
    });
    // 적재를 기다리는 동안 폐기됐으면 어댑터를 남기지 않는다.
    if (disposed) return;
    liveKit = adapter;
  };

  const ensurePublisher = (): TrackPublisher | null => {
    if (publisher) return publisher;
    // 주입이 없으면 현재 세대 Room의 LocalParticipant를 쓴다. Room이 없으면 게시하지 않는다.
    const participant = options.getPublisher?.() ?? liveKit?.getPublisher() ?? null;
    if (!participant) return null;
    publisher = createTrackPublisher({ participant, now: () => vision.now() });
    return publisher;
  };
  const media: MediaSession = createMediaSession({
    createRoom: (grant) => {
      if (options.createMediaRoom) return options.createMediaRoom(grant);
      // connectMedia가 ensureLiveKit을 먼저 기다린다. 여기 도달하면 적재가 끝나 있다.
      if (!liveKit) throw new InteractionNotImplementedError('createMediaRoom', 'SDK 적재 실패');
      return liveKit.createRoom(grant);
    },
    onStatus: (status) => {
      if (!disposed) deps.onMediaStatus(status);
    },
    epochNowSeconds: options.epochNowSeconds ?? (() => Math.floor(Date.now() / 1000)),
    getPhase: () => context.get()?.phase ?? null,
  });
  let keyboardBound: (() => void) | null = null;
  let inputWatchdog: number | null = null;

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
    now: () => vision.now(),
    setTimer: (handler, delayMs) => vision.setTimer(handler, delayMs),
    clearTimer: (handle) => vision.clearTimer(handle),
    tuning,
  });
  const gestures: GestureIntentController = createGestureIntentController({
    context,
    send: (command) => deps.sendCommand(command as CommandInput),
    onInteractionState: (state) => deps.onInteractionState(state),
  });

  /** 문맥 변화·장애에서 이동 timer, 회전 latch, gesture hold를 함께 비운다. */
  const leanFilter = createMotionSampleFilter('pose', tuning);
  const yawFilter = createMotionSampleFilter('face', tuning);
  const clearHolds = () => {
    move.release();
    turn.reset();
    gestures.reset();
    leanFilter.reset(vision.now());
    yawFilter.reset(vision.now());
  };

  /** 장애는 보조 입력 전환이다. 참가·Room·미디어 세대를 끝내지 않는다. */
  const fallback: InputFallback = createInputFallback({
    clearHolds,
    onModeChange: (nextMode) => {
      move.setMode(nextMode);
      turn.setMode(nextMode);
      gestures.setMode(nextMode);
    },
    onFailure: (code) => {
      // A missing face is expected after a failed calibration. Keep its actionable cause
      // until a new calibration/device attempt; terminal camera/worker errors still replace it.
      if (
        code === 'FACE_INVALID' &&
        lastStatus.calibration === 'failed' &&
        lastStatus.errorCode?.startsWith('CALIBRATION_')
      )
        return;
      patch({ errorCode: code });
    },
  });
  let calibrationObserver: ((snapshot: SensorSnapshot) => void) | null = null;
  let calibrationStart: (() => void) | null = null;
  let cancelCalibration: (() => void) | null = null;
  let calibrationPending: Promise<DeviceStatus> | null = null;

  const vision = options.vision ?? browserVision();

  /** 세 종료 경로가 공유하는 단일 정리 수명. */
  const lifecycle: MediaLifecycle = createMediaLifecycle({
    media: {
      closeOutput: () => {
        audioOutputLock = 'locked';
        audioGraph?.setOutputLock('locked');
      },
      stopListeners: () => {
        acceptedScope = null;
        liveKit?.clearPublisherPermissions();
        policyStore.reset();
      },
      unpublishAll: async () => {
        await publisher?.unpublishAll();
        publisher = null;
      },
      releaseRemote: () => {
        stopSweep();
        remoteFaces.clear();
        bindingStore.reset();
        audioGraph?.dispose();
        audioGraph = null;
      },
      disconnect: async () => {
        await media.retire();
      },
    },
    participation: {
      stopInput: () => {
        unbindKeyboard();
        clearHolds();
        context.clear();
        fallback.reset();
      },
      stopVision: () => {
        stopVision();
        if (inputWatchdog !== null) vision.clearTimer(inputWatchdog);
        inputWatchdog = null;
        compositor?.dispose();
        compositor = null;
        visibility.removeEventListener('visibilitychange', onVisibilityChange);
        luminance = null;
        safeFace.reset();
        calibrator.reset();
      },
      stopDevices: async () => {
        await devices?.dispose();
        devices = null;
        sharedAudio = null;
      },
    },
    now: () => vision.now(),
  });

  const patch = (value: DeviceStatusPatch) => {
    if (!devices) return;
    lastStatus = devices.patchStatus(value);
  };

  const stopVision = () => {
    if (modelTimer !== null) vision.clearTimer(modelTimer);
    modelTimer = null;
    cancelCalibration?.();
    pump?.stop();
    pump = null;
    scheduler?.dispose();
    scheduler = null;
    modelsLoaded = false;
    lastSnapshot = null;
    calibrationObserver = null;
    // 안내는 비전이 멈춘 뒤에도 남아 있으면 안 된다.
    conditionNotifier.reset();
    luminance?.reset();
    emitGuidance(null);
  };

  const failVision = (code: string) => {
    fallback.report(code === 'INFERENCE_STALLED' ? 'INFERENCE_STALLED' : 'WORKER_ERROR');
    // 모델을 이미 올린 뒤의 추론 정체는 model-load 실패가 아니다. 그 단계는 건드리지 않는다.
    if (!modelsLoaded) {
      readiness.fail('model-load', vision.now(), code);
      reportReadiness();
    }
    patch({ vision: 'failed', calibration: 'failed', errorCode: code });
    stopVision();
    calibrator.reset();
  };

  const emitGuidance = (notice: FaceConditionNotice | null) => {
    // 같은 안내를 반복해서 알리지 않는다. 사라질 때 한 번 null을 보낸다.
    if (notice?.condition === lastNotice?.condition) return;
    lastNotice = notice;
    deps.onFaceGuidance?.(notice);
  };

  /**
   * S15P21C204-244. 지금 얼굴이 왜 안 잡히는지 정한다.
   * 표본이 없으면 휘도 없이 판정하며, 그때는 역광·반사를 주장하지 않는다.
   */
  const observeFaceCondition = (nowMs: number) => {
    if (!deps.onFaceGuidance) return;
    const face = lastSnapshot?.face ?? null;
    const valid = face?.status === 'valid' ? face.data : null;
    const fresh = isSampleFresh(face, 'face', nowMs);
    const mask = valid ? buildFaceMask(valid.landmarks) : null;
    const profile =
      mask && valid && luminance ? luminance.sample(mask, valid.landmarks, nowMs) : null;

    const condition = classifyFaceCondition({
      faceMissing: !fresh || valid === null,
      yawRad: valid?.yawRad ?? null,
      ovalMissingRatio: valid ? ovalMissingRatio(valid.landmarks) : 0,
      luminance: profile,
    });
    emitGuidance(conditionNotifier.observe(condition, nowMs));
  };

  const drawSafeOutput = () => {
    if (!compositor) return;
    const nowMs = vision.now();
    // 탭이 숨으면 새 프레임이 오지 않는다. hold 창을 기다리지 않고 바로 기본 얼굴로 내려
    // 직전 실사 프레임이 게시된 채 남지 않게 한다. 복귀하면 새 표본부터 다시 시작한다.
    if (visibility.isHidden()) {
      compositor.drawMode(safeFace.forceDefault().mode, null);
      luminance?.reset();
      conditionNotifier.reset();
      emitGuidance(null);
      return;
    }
    const decision = safeFace.decide(lastSnapshot, nowMs, runtimeGeneration);
    const face = lastSnapshot?.face;
    compositor.drawMode(decision.mode, face?.status === 'valid' ? face.data : null);
    observeFaceCondition(nowMs);
  };

  const onVisibilityChange = () => {
    if (disposed) return;
    // 이탈 즉시 한 번 처리한다. 타이머가 배경 탭에서 늦게 깨어나도 잔상을 남기지 않는다.
    drawSafeOutput();
  };

  const ensureProcessedOutput = () => {
    if (compositor) return;
    compositor = createFaceCompositor({
      environment: options.compositor ?? browserCompositor(),
      // Source acquisition may change; the Canvas and its publication keep their lifetime.
      getSource: () => {
        const video = devices?.getPreviewElement();
        return video && video.videoWidth > 0
          ? { source: video, width: video.videoWidth, height: video.videoHeight }
          : null;
      },
    });
    compositor.draw(null);
    luminance = createLuminanceSampler({
      createCanvas: options.createLuminanceCanvas ?? browserLuminanceCanvas,
      getSource: () => {
        const video = devices?.getPreviewElement();
        return video && video.videoWidth > 0
          ? { source: video, width: video.videoWidth, height: video.videoHeight }
          : null;
      },
    });
    visibility.addEventListener('visibilitychange', onVisibilityChange);
    const checkInputAndOutput = () => {
      if (disposed || !compositor) return;
      const now = vision.now();
      drawSafeOutput();
      if (scheduler) {
        if (lastSnapshot && context.acceptsInput) {
          const failure = fallback.observe(lastSnapshot, now, runtimeGeneration);
          if (failure === 'INFERENCE_STALLED') failVision(failure);
        }
        if (modelsLoaded && !lastSnapshot && now - modelReadyAt > FIRST_INFERENCE_TIMEOUT_MS)
          failVision('INFERENCE_STALLED');
        if (lastStatus.vision === 'ready' && !hasFreshValidFace()) patch({ vision: 'loading' });
      }
      if (!isSampleFresh(lastSnapshot?.pose ?? null, 'pose', now)) {
        leanFilter.reset();
        move.updateMotion(null, now);
      }
      if (!isSampleFresh(lastSnapshot?.face ?? null, 'face', now)) {
        yawFilter.reset();
        if (context.get()?.mode === 'motion' && !fallback.degraded) turn.reset();
      }
      inputWatchdog = vision.setTimer(checkInputAndOutput, 100);
    };
    inputWatchdog = vision.setTimer(checkInputAndOutput, 100);
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
    if (deps.onMotionDebug) {
      // 진단 오버레이(제거 가능). 판정보다 먼저, 보정 전에도 원시 신호를 보여 준다.
      const debugNeutral = calibrator.getNeutral();
      deps.onMotionDebug(
        describeMotionDebug({
          snapshot,
          nowMs,
          neutral: debugNeutral,
          neutralUsable: isNeutralUsable(debugNeutral, runtimeGeneration, tuning),
          tuning,
          move: move.current,
          motionActive: move.motionActive,
          movePhase: move.phase,
          releaseLag: move.releaseLag,
          turnLatched: turn.latched,
          mode: context.get()?.mode ?? null,
          accepting:
            context.acceptsInput &&
            !context.inChallenge &&
            context.get()?.mode === 'motion' &&
            !fallback.degraded,
        }),
      );
    }
    if (
      !context.acceptsInput ||
      context.inChallenge ||
      context.get()?.mode !== 'motion' ||
      fallback.degraded
    ) {
      move.updateMotion(null, nowMs);
      turn.updateMotion(null, nowMs);
      leanFilter.reset(nowMs);
      yawFilter.reset(nowMs);
      return;
    }
    const neutral = calibrator.getNeutral();
    if (!isNeutralUsable(neutral, runtimeGeneration, tuning)) {
      move.updateMotion(null, nowMs);
      turn.updateMotion(null, nowMs);
      leanFilter.reset(nowMs);
      yawFilter.reset(nowMs);
      return;
    }
    const face = snapshot.face;
    const usableFace =
      isSampleFresh(face, 'face', nowMs) &&
      face!.status === 'valid' &&
      isUsableQuality(face!.data.quality);
    const relativeYaw = usableFace ? relativeToNeutral(face!.data.yawRad, neutral.yawRad) : null;

    const pose = snapshot.pose;
    const usablePose =
      isSampleFresh(pose, 'pose', nowMs) &&
      pose!.status === 'valid' &&
      isUsableQuality(pose!.data.quality);
    // 어깨 x 거리와 얼굴 크기를 각각 중립 대비로 만들어 평균한다(lean-signal). 어깨는 필수다.
    const lean = usablePose
      ? relativeLean(
          leanComponents(
            (pose as Sample<PoseSensor> & { status: 'valid' }).data.landmarks,
            usableFace ? face!.data.landmarks : null,
          ),
          neutral,
        ).combined
      : null;
    // 고개가 돌아간 동안은 어깨·얼굴 거리가 줄어 보이므로 이동 판정을 만들지 않는다.
    const leanInput = lean === null || headTurnedForMove(relativeYaw, tuning) ? null : lean;
    const motion = leanFilter.observe(pose, leanInput, nowMs, snapshot.runtimeGeneration);
    if (motion.status === 'unavailable') move.updateMotion(null, nowMs);
    if (motion.status === 'new') {
      if (motion.restarted) move.updateMotion(null, motion.sampledAtMs);
      move.updateMotion(motion.value, motion.sampledAtMs);
    }

    const rotation = yawFilter.observe(face, relativeYaw, nowMs, snapshot.runtimeGeneration);
    if (rotation.status === 'unavailable') turn.reset();
    if (rotation.status === 'new') {
      if (rotation.restarted) turn.reset();
      turn.updateMotion(rotation.value, rotation.sampledAtMs);
    }
  };

  const publishSnapshot = (snapshot: SensorSnapshot) => {
    if (disposed || !scheduler) return;
    // 구 세대 결과는 발행하지 않는다.
    if (snapshot.runtimeGeneration !== runtimeGeneration) return;
    lastSnapshot = snapshot;
    // 가공 얼굴은 안전 프레임 정책이 정한 모드로만 그린다. raw 영상 fallback은 없다.
    drawSafeOutput();
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
    ensureProcessedOutput();
    const worker = vision.createWorker();
    const created = createWorkerScheduler(
      {
        worker,
        now: vision.now,
        onSnapshot: publishSnapshot,
        onError: (code) => {
          if (disposed || generation !== runtimeGeneration || !scheduler) return;
          failVision(code);
        },
        onReady: (loaded) => {
          if (disposed || generation !== runtimeGeneration || !scheduler) return;
          if (
            !['face', 'pose', 'gesture'].every((kind) =>
              loaded.includes(kind as (typeof loaded)[number]),
            )
          ) {
            failVision('MODEL_LOAD_FAILED');
            return;
          }
          modelsLoaded = true;
          modelReadyAt = vision.now();
          readiness.succeed('model-load', modelReadyAt);
          reportReadiness();
          if (modelTimer !== null) vision.clearTimer(modelTimer);
          modelTimer = null;
          pump?.start();
          calibrationStart?.();
          // 모델 로드만으로 vision ready로 올리지 않는다. 나머지 조건은 D-07/D-08이 채운다.
          refreshVisionStatus();
        },
      },
      generation,
    );
    worker.onmessage = (event) => created.handleMessage(event.data);
    worker.onerror = () => created.handleWorkerError();

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
        if (disposed || generation !== runtimeGeneration || !scheduler) return;
        failVision(code);
      },
    });
    scheduler = created;
    pump = frames;
    patch({ vision: 'loading', errorCode: null });
    readiness.begin('model-load', vision.now());
    reportReadiness();
    modelTimer = vision.setTimer(() => {
      if (generation === runtimeGeneration && scheduler && !modelsLoaded)
        failVision('MODEL_LOAD_TIMEOUT');
    }, MODEL_LOAD_TIMEOUT_MS);
    worker.postMessage({ type: 'init', runtimeGeneration: generation, paths: PINNED_MODEL_PATHS });
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
        if (event.repeat) return;
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
      environment:
        options.environment ?? browserEnvironment(() => (sharedAudio ??= browserAudio())),
      onStatus: (status) => {
        lastStatus = status;
        if (!disposed) deps.onDeviceStatus(status);
      },
      onLocalPreview: (element) => deps.onLocalPreview(element),
      readiness,
      now: () => vision.now(),
      onCameraTrack: (track) => {
        if (track !== null) {
          // 라벨은 권한을 받은 뒤에야 채워진다. 30초 초과 표본을 장치 조합으로 되찾는 데 쓴다.
          readiness.setEnvironment(
            describeClientEnvironment(typeof navigator === 'undefined' ? null : navigator, track),
          );
          reportReadiness();
          return;
        }
        // 원본이 사라지면 비전도 멈추고 보정을 버린다. 참가는 유지한다.
        stopVision();
        calibrator.reset();
        fallback.report('CAMERA_ENDED');
        patch({ vision: 'idle', calibration: 'idle' });
      },
      onMicrophoneTrack: (track) => {
        localAudio()?.microphoneLevel(canMonitorAudio() ? track : null);
        if (track) return;
        fallback.reportMicrophoneOnly();
        void publisher?.stopMicrophone().catch(() => {
          patch({ microphone: 'failed', errorCode: 'MICROPHONE_UNPUBLISH_FAILED' });
        });
      },
    });
    return devices;
  };

  const publishMicrophone = async (manager: DeviceManager) => {
    const microphone = manager.getMicrophoneTrack();
    const scope = media.getScope();
    if (microphone && publisher && scope && lifecycle.canOperate() && matchesAcceptedScope(scope)) {
      try {
        await publisher.publishMicrophone(microphone, scope);
      } catch {
        patch({ microphone: 'failed', errorCode: 'MICROPHONE_PUBLISH_FAILED' });
      }
    }
  };

  return {
    async setMicrophone(enabled) {
      if (disposed) return lastStatus;
      const manager = ensureDevices();
      await manager.setMicrophone(enabled);
      if (disposed) return lastStatus;
      reconcileAudio();
      await publishMicrophone(manager);
      return lastStatus;
    },
    async startDevices(input) {
      if (disposed) return lastStatus;
      const manager = ensureDevices();
      const status = await manager.start(input);
      if (disposed) return status;
      reconcileAudio();
      const preview = manager.getPreviewElement();
      if (status.camera === 'ready' && preview && !scheduler) {
        runtimeGeneration += 1;
        try {
          startVision(preview);
        } catch {
          failVision('VISION_START_FAILED');
        }
      }
      await publishMicrophone(manager);
      return lastStatus;
    },

    calibrate() {
      if (disposed || !devices) return Promise.resolve(lastStatus);
      if (calibrationPending) return calibrationPending;
      if (lastStatus.camera !== 'ready') {
        patch({ calibration: 'failed', errorCode: 'CALIBRATION_NO_CAMERA' });
        return Promise.resolve(lastStatus);
      }
      if (!scheduler) return Promise.resolve(lastStatus);
      const generation = runtimeGeneration;
      calibrator.reset();
      clearHolds();
      patch({
        calibration: 'running',
        errorCode: modelsLoaded ? null : 'CALIBRATION_WAITING_FOR_MODELS',
      });
      calibrationPending = new Promise<DeviceStatus>((resolve) => {
        let settled = false;
        let timer: number | null = null;
        const finish = (complete: boolean) => {
          if (settled) return;
          settled = true;
          calibrationObserver = null;
          calibrationStart = null;
          cancelCalibration = null;
          calibrationPending = null;
          if (timer !== null) vision.clearTimer(timer);
          if (complete && !disposed && generation === runtimeGeneration) {
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
          }
          resolve(lastStatus);
        };
        cancelCalibration = () => finish(false);
        calibrationStart = () => {
          calibrationStart = null;
          const startedAt = vision.now();
          calibrator.begin(generation);
          patch({ calibration: 'running', errorCode: null });
          calibrationObserver = (snapshot) => {
            if (
              (snapshot.face?.sampledAtMs ?? -1) < startedAt ||
              (snapshot.pose?.sampledAtMs ?? -1) < startedAt
            )
              return;
            calibrator.observe(snapshot, vision.now());
            if (calibrator.sampleCount >= tuning.calibrationMinSamples) finish(true);
          };
          timer = vision.setTimer(() => finish(true), CALIBRATION_WINDOW_MS);
        };
        if (modelsLoaded) calibrationStart();
      });
      return calibrationPending;
    },

    setContext(next: InteractionContext) {
      if (disposed) return;
      const previous = context.get();
      const change = context.set(next);
      if (!canTestAudio()) localAudio()?.stopTestTone();
      if (!canMonitorAudio()) localAudio()?.microphoneLevel(null);
      if (
        change.shouldClearHolds ||
        previous?.phase !== next.phase ||
        previous?.selfPlayerId !== next.selfPlayerId
      )
        clearHolds();
      // pageActive=false이면 입력과 버퍼를 비우고 새 의도를 막는다.
      if (!context.acceptsInput) clearHolds();
      // 이동 키도 키보드 모드에서만 받는다(S15P21C204-265). 모션 모드는 웹캠으로만 움직인다.
      move.setMode(next.mode);
      turn.setMode(next.mode);
      gestures.syncEquipment(next.selectedEquipment ?? 'sensor');
      gestures.setMode(next.mode);
      if (next.mode === 'motion' && lastStatus.calibration === 'ready')
        fallback.restoreMotion({ calibrated: true, requestedMode: next.mode });
      bindKeyboard();
    },

    async connectMedia(grant) {
      if (disposed) return;
      // terminal 세대에서는 새 연결을 열지 않는다.
      if (!lifecycle.canOperate()) return;
      // SDK 적재를 먼저 끝낸다. 적재 실패는 연결 실패로 드러난다.
      await ensureLiveKit();
      if (disposed || !lifecycle.canOperate()) return;
      acceptedScope = {
        matchId: grant.matchId,
        mediaInstanceId: grant.mediaInstanceId,
        receiverGeneration: grant.receiverGeneration,
      };
      bindingStore.beginScope(acceptedScope);
      await media.connect(grant);
    },

    /** 별도 채널의 정책. 참조 bindingRevision과 검증 SID가 맞아야 소리가 난다. */
    applyAudioPolicy(policy: AudioPolicy) {
      if (disposed || !lifecycle.canOperate() || !matchesAcceptedScope(policy)) return;
      const result = policyStore.apply(policy);
      if (result.status === 'ignored') return;
      reconcileAudio();
      const graph = ensureAudio();
      // 승인된 서버 효과음만 eventId 중복 없이 재생한다.
      if (graph && result.status === 'applied') graph.playEffects(policyStore.getEffects());
    },

    /** COUNTDOWN·개인 종료·권위 상실에서 출력을 잠근다. */
    setAudioOutputLock(lock: OutputLock) {
      if (disposed) return;
      audioOutputLock = lock;
      audioGraph?.setOutputLock(lock);
    },
    setAudioPreferences(next) {
      if (disposed) return;
      audioPreferences = normalizeAudioPreferences(next);
      audioGraph?.setPreferences(audioPreferences);
      localAudio()?.setTestToneVolume(audioPreferences.muted ? 0 : audioPreferences.volume);
    },
    getLocalAudioStatus() {
      return {
        preferences: audioPreferences,
        microphoneLevel:
          localAudio()?.microphoneLevel(
            canMonitorAudio() ? (devices?.getMicrophoneTrack() ?? null) : null,
          ) ?? null,
        testTonePlaying: !disposed && (localAudio()?.testTonePlaying ?? false),
      };
    },
    async playTestTone() {
      if (!canTestAudio()) return 'unavailable';
      if (audioPreferences.muted || audioPreferences.volume === 0) return 'muted';
      await ensureDevices().unlockAudio();
      if (!canTestAudio() || lastStatus.audioPlayback !== 'ready') return 'unavailable';
      if (audioPreferences.muted || audioPreferences.volume === 0) return 'muted';
      return localAudio()?.playTestTone(audioPreferences.volume) ? 'played' : 'unavailable';
    },
    playCue(kind) {
      if (disposed) return 'unavailable';
      if (audioPreferences.muted || audioPreferences.volume === 0) return 'muted';
      const cues = (options.audio ?? sharedAudio)?.cues;
      return cues?.play(kind, audioPreferences.volume) ? 'played' : 'unavailable';
    },

    /** B의 검증 목록만 신원 매핑 근거로 쓴다. 이름·metadata로 추측하지 않는다. */
    applyMediaBindings(bindings) {
      if (disposed || !lifecycle.canOperate() || !matchesAcceptedScope(bindings)) return;
      const selfPlayerId = context.get()?.selfPlayerId ?? '';
      const result = bindingStore.apply(bindings, selfPlayerId);
      if (result.status !== 'applied') return;
      // 자기 항목은 게시 검증용으로만 읽는다.
      const self = bindingStore.getSelf();
      const scope = bindingStore.getScope();
      if (publisher && scope)
        publisher.confirmFromBindings(
          scope,
          [self?.faceTrackSid, self?.audioTrackSid].filter((sid): sid is string => !!sid),
        );
      // 바인딩이 뒤늦게 와도 이미 받은 publication을 다시 대조한다.
      remoteFaces.reconcile();
      reconcileAudio();
    },

    /** SDK TrackSubscribed. 검증 전에는 attach하지 않는다. 어댑터도 같은 경로를 쓴다. */
    addRemoteTrack(track) {
      handleRemoteTrack(track);
    },

    removeRemoteTrack(trackSid) {
      handleRemoteTrackRemoved(trackSid);
    },

    /** C VI-05의 저사양 전환. 이후 게시부터 낮은 인코딩을 쓴다. */
    setQualityPreset(preset) {
      qualityPreset = preset;
    },

    /** 가공 얼굴과 선택 마이크만 게시한다. 원본은 handle 검사에서 거절된다. */
    async publishMedia() {
      if (!lifecycle.canOperate()) return null;
      const scope = media.getScope();
      const target = ensurePublisher();
      if (!scope || !target) return null;
      const handle = compositor?.getHandle() ?? null;
      if (!handle) return null;
      // S15P21C204-240. 여기부터 SID 확보까지가 클라이언트 게시 구간이다. 서버가 바인딩을
      // 확인해 주기를 기다리는 시간은 여기 들어오지 않는다.
      readiness.begin('first-publish', vision.now());
      reportReadiness();
      let faceSid: string | null;
      try {
        faceSid = await target.publishFace(handle, scope, qualityPreset);
      } catch (error) {
        readiness.fail('first-publish', vision.now(), 'PUBLISH_FAILED');
        reportReadiness();
        throw error;
      }
      if (!lifecycle.canOperate() || !matchesAcceptedScope(scope)) return null;
      readiness.succeed('first-publish', vision.now());
      reportReadiness();
      const microphone = devices?.getMicrophoneTrack() ?? null;
      if (microphone) await target.publishMicrophone(microphone, scope);
      if (!lifecycle.canOperate() || !matchesAcceptedScope(scope)) return null;
      return faceSid;
    },

    getReadinessTrace() {
      return readiness.snapshot(vision.now());
    },

    /**
     * S15P21C204-246. 구독 상태는 **SDK가 말하는 값**을 싣는다. D가 unsubscribe를
     * 불렀다는 사실이 아니다. 사용자 mute는 voices 쪽에만 반영해 정책 위반을 가리지 않는다.
     */
    getMediaEvidence() {
      const authorized = bindingStore.getRemote().flatMap((binding) => {
        const entries: { trackSid: string; playerId: string }[] = [];
        if (binding.faceTrackSid)
          entries.push({ trackSid: binding.faceTrackSid, playerId: binding.playerId });
        if (binding.audioTrackSid)
          entries.push({ trackSid: binding.audioTrackSid, playerId: binding.playerId });
        return entries;
      });
      return composeMediaEvidence({
        scope: media.getScope(),
        generationState: lifecycle.state,
        published: (publisher?.getPublications() ?? []).map((record) => ({
          source: record.source === 'microphone' ? 'microphone' : 'face',
          trackSid: record.trackSid,
          serverConfirmed: record.serverConfirmed,
        })),
        subscriptions: liveKit?.getSubscriptions() ?? [],
        authorized,
        attachedFaces: remoteFaces.getAttached(),
        pendingSids: pendingTracks.list().map((entry) => entry.trackSid),
        policyVoices: policyStore.resolveVoices(),
        routedSids: (audioGraph?.getVoices() ?? []).map((voice) => voice.trackSid),
        preferences: audioPreferences,
        remoteFaceLimit: remoteFaceLimit(currentPurpose()),
      });
    },

    getPublications() {
      return publisher?.getPublications() ?? [];
    },
    getProcessedFaceStream() {
      return compositor?.getHandle()?.stream ?? null;
    },

    /**
     * 미디어 세대만 끝낸다. playerId·게임 Room·원본 카메라와 센서는 유지한다.
     * 로컬 closed일 뿐 서버 회수 확인이 아니다.
     */
    async retireMediaGeneration(reason: RetireReason = 'phase-change') {
      await lifecycle.retireGeneration(reason);
    },

    /** 논리 참가 종료. 입력·Worker·원본 장치까지 닫는다. 게임 Room 수명은 C가 정한다. */
    async endParticipation() {
      await lifecycle.endParticipation();
      audioPreferences = DEFAULT_AUDIO_PREFERENCES;
      runtimeGeneration += 1;
    },

    /** 새 미디어 세대 시작. B/E 회수 확인 뒤에만 부른다. */
    beginMediaGeneration() {
      lifecycle.beginGeneration();
    },

    getGenerationState() {
      return lifecycle.state;
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      audioPreferences = DEFAULT_AUDIO_PREFERENCES;
      await lifecycle.dispose();
      deps.onMediaStatus(IDLE_MEDIA_STATUS);
      await media.dispose();
      // 어댑터는 Room과 함께 버린다. 폐기한 runtime을 다시 쓰지 않는다.
      liveKit = null;
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

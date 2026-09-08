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
import { INITIAL_DEVICE_STATUS, type DeviceStatus } from '../devices/device-status';
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

export type InteractionRuntimeOptions = Readonly<{
  /** 브라우저 자원 주입점. 생략하면 실제 DOM/navigator를 사용한다. */
  environment?: DeviceEnvironment;
}>;

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

export const createInteractionRuntime = (
  deps: InteractionDeps,
  options: InteractionRuntimeOptions = {},
): InteractionRuntime => {
  let disposed = false;
  let devices: DeviceManager | null = null;
  let lastStatus: DeviceStatus = INITIAL_DEVICE_STATUS;

  const ensureDevices = (): DeviceManager => {
    if (devices) return devices;
    devices = createDeviceManager({
      environment: options.environment ?? browserEnvironment(),
      onStatus: (status) => {
        lastStatus = status;
        if (!disposed) deps.onDeviceStatus(status);
      },
      onLocalPreview: (element) => deps.onLocalPreview(element),
    });
    return devices;
  };

  return {
    async startDevices(input) {
      if (disposed) return lastStatus;
      return ensureDevices().start(input);
    },

    calibrate() {
      // D-06에서 중립 보정을 구현한다. 그 전에는 calibration ready를 만들지 않는다.
      return Promise.reject(new InteractionNotImplementedError('calibrate', 'D-06 / IN-06'));
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
      await devices?.dispose();
      devices = null;
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      await devices?.dispose();
      devices = null;
    },
  };
};

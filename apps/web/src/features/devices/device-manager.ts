// D-01 / IN-01. 원본 카메라·마이크의 단일 취득과 장치 수명.
// D가 video element·srcObject·track·AudioContext 잠금 해제를 소유한다.
// 장치 취득만으로 Cloud grant/게시를 시작하지 않는다.
import {
  deviceErrorCode,
  INITIAL_DEVICE_STATUS,
  microphoneStateForError,
  patchDeviceStatus,
  type DeviceStatus,
  type DeviceStatusPatch,
} from './device-status';

/** 카메라 요청 제약. 640×480 ideal, 최대 30fps, audio는 별도 요청이다. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = Object.freeze({
  video: Object.freeze({
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { max: 30 },
  }) as MediaTrackConstraints,
  audio: false,
});

export const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = Object.freeze({
  video: false,
  audio: true,
});

/** 재생 잠금 해제만 확인하는 최소 인터페이스. */
export interface AudioUnlockPort {
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export type DeviceEnvironment = Readonly<{
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  /** D가 소유하는 로컬 원본 미리보기 element를 만든다. */
  createPreviewElement(): HTMLVideoElement;
  /** 사용자 제스처 구간의 재생 잠금 해제. 없으면 null을 반환한다. */
  createAudioUnlock?(): AudioUnlockPort | null;
  /** devicechange 구독. 해제 함수를 돌려준다. */
  onDeviceChange?(listener: () => void): () => void;
}>;

export type DeviceManagerDeps = Readonly<{
  environment: DeviceEnvironment;
  onStatus(status: DeviceStatus): void;
  onLocalPreview(element: HTMLVideoElement | null): void;
  /** 카메라 트랙이 실제로 바뀌었을 때만 알린다. null은 원본 소실이다. */
  onCameraTrack?(track: MediaStreamTrack | null): void;
}>;

export interface DeviceManager {
  start(input: { microphone: boolean }): Promise<DeviceStatus>;
  getStatus(): DeviceStatus;
  getCameraStream(): MediaStream | null;
  getMicrophoneTrack(): MediaStreamTrack | null;
  getPreviewElement(): HTMLVideoElement | null;
  patchStatus(patch: DeviceStatusPatch): DeviceStatus;
  dispose(): Promise<void>;
  readonly disposed: boolean;
}

type CameraHolding = {
  stream: MediaStream;
  track: MediaStreamTrack | null;
  onEnded: () => void;
};

export function createDeviceManager(deps: DeviceManagerDeps): DeviceManager {
  const environment = deps.environment;
  let status = INITIAL_DEVICE_STATUS;
  let generation = 0;
  let disposed = false;

  let camera: CameraHolding | null = null;
  let cameraRequest: Promise<MediaStream> | null = null;
  let microphone: MediaStreamTrack | null = null;
  let microphoneRequest: Promise<MediaStream> | null = null;
  let preview: HTMLVideoElement | null = null;
  let audioUnlock: AudioUnlockPort | null = null;
  let unsubscribeDeviceChange: (() => void) | null = null;

  const publish = (patch: DeviceStatusPatch) => {
    const next = patchDeviceStatus(status, patch);
    if (next === status) return status;
    status = next;
    if (!disposed) deps.onStatus(status);
    return status;
  };

  const stopStream = (stream: MediaStream) => {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // 이미 종료된 트랙의 stop 실패는 무시한다.
      }
    }
  };

  const releaseCamera = () => {
    const holding = camera;
    camera = null;
    if (!holding) return;
    holding.track?.removeEventListener('ended', holding.onEnded);
    stopStream(holding.stream);
  };

  const detachPreview = () => {
    const element = preview;
    preview = null;
    if (!element) return;
    // C가 host 연결을 끊을 수 있도록 null을 먼저 알린 뒤 D가 element를 정리한다.
    deps.onLocalPreview(null);
    element.srcObject = null;
    try {
      element.pause();
    } catch {
      // 재생 중이 아니면 무시한다.
    }
  };

  const attachPreview = (stream: MediaStream) => {
    detachPreview();
    const element = environment.createPreviewElement();
    element.muted = true;
    element.playsInline = true;
    element.autoplay = true;
    element.srcObject = stream;
    preview = element;
    void Promise.resolve(element.play?.()).catch(() => undefined);
    deps.onLocalPreview(element);
  };

  const releaseMicrophone = () => {
    const track = microphone;
    microphone = null;
    if (!track) return;
    try {
      track.stop();
    } catch {
      // 무시한다.
    }
  };

  const unlockAudio = () => {
    if (audioUnlock || !environment.createAudioUnlock) return;
    try {
      audioUnlock = environment.createAudioUnlock() ?? null;
    } catch {
      publish({ audioPlayback: 'failed' });
      return;
    }
    if (!audioUnlock) return;
    const context = audioUnlock;
    void context
      .resume()
      .then(() => {
        if (disposed || audioUnlock !== context) return;
        publish({ audioPlayback: context.state === 'running' ? 'ready' : 'locked' });
      })
      .catch(() => {
        if (disposed || audioUnlock !== context) return;
        publish({ audioPlayback: 'failed' });
      });
  };

  const watchDeviceChange = () => {
    if (unsubscribeDeviceChange || !environment.onDeviceChange) return;
    unsubscribeDeviceChange = environment.onDeviceChange(() => {
      if (disposed || !camera) return;
      const track = camera.track;
      if (track && track.readyState === 'ended') handleCameraEnded();
    });
  };

  const handleCameraEnded = () => {
    if (disposed) return;
    detachPreview();
    releaseCamera();
    deps.onCameraTrack?.(null);
    publish({ camera: 'failed', errorCode: 'DEVICE_LOST' });
  };

  const acquireCamera = async (request: number): Promise<void> => {
    if (camera) return;
    publish({ camera: 'requesting' });
    if (!cameraRequest) cameraRequest = environment.getUserMedia(CAMERA_CONSTRAINTS);
    const pending = cameraRequest;
    let stream: MediaStream;
    try {
      stream = await pending;
    } catch (error) {
      if (cameraRequest === pending) cameraRequest = null;
      if (request !== generation || disposed) return;
      publish({ camera: 'failed', errorCode: deviceErrorCode(error) });
      return;
    }
    if (cameraRequest === pending) cameraRequest = null;
    // 폐기된 요청의 늦은 성공은 트랙을 바로 정리하고 상태를 바꾸지 않는다.
    if (request !== generation || disposed) {
      stopStream(stream);
      return;
    }
    if (camera) {
      stopStream(stream);
      return;
    }
    const track = stream.getVideoTracks()[0] ?? null;
    const onEnded = () => handleCameraEnded();
    track?.addEventListener('ended', onEnded);
    camera = { stream, track, onEnded };
    attachPreview(stream);
    watchDeviceChange();
    deps.onCameraTrack?.(track);
    publish({ camera: 'ready', errorCode: null });
  };

  const acquireMicrophone = async (request: number): Promise<void> => {
    if (microphone) return;
    publish({ microphone: 'requesting' });
    if (!microphoneRequest) microphoneRequest = environment.getUserMedia(MICROPHONE_CONSTRAINTS);
    const pending = microphoneRequest;
    let stream: MediaStream;
    try {
      stream = await pending;
    } catch (error) {
      if (microphoneRequest === pending) microphoneRequest = null;
      if (request !== generation || disposed) return;
      // 마이크 거부는 선택 기능의 실패이며 카메라 상태를 바꾸지 않는다.
      publish({ microphone: microphoneStateForError(deviceErrorCode(error)) });
      return;
    }
    if (microphoneRequest === pending) microphoneRequest = null;
    if (request !== generation || disposed) {
      stopStream(stream);
      return;
    }
    if (microphone) {
      stopStream(stream);
      return;
    }
    const track = stream.getAudioTracks()[0] ?? null;
    if (!track) {
      stopStream(stream);
      publish({ microphone: 'failed' });
      return;
    }
    microphone = track;
    publish({ microphone: 'ready' });
  };

  return {
    async start(input) {
      if (disposed) return status;
      const request = generation;
      unlockAudio();
      if (!input.microphone) {
        // 마이크를 끄면 기존 송신 트랙만 닫고 카메라/보정 상태는 유지한다.
        releaseMicrophone();
        microphoneRequest = null;
        publish({ microphone: 'off' });
      }
      const cameraStep = acquireCamera(request);
      const microphoneStep = input.microphone ? acquireMicrophone(request) : Promise.resolve();
      await Promise.all([cameraStep, microphoneStep]);
      return status;
    },

    getStatus: () => status,
    getCameraStream: () => camera?.stream ?? null,
    getMicrophoneTrack: () => microphone,
    getPreviewElement: () => preview,
    patchStatus: (patch) => publish(patch),

    async dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      unsubscribeDeviceChange?.();
      unsubscribeDeviceChange = null;
      detachPreview();
      releaseCamera();
      releaseMicrophone();
      cameraRequest = null;
      microphoneRequest = null;
      const context = audioUnlock;
      audioUnlock = null;
      if (context) await context.close().catch(() => undefined);
    },

    get disposed() {
      return disposed;
    },
  };
}

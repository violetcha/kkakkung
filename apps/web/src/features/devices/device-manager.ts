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
import type { ReadinessRecorder } from './readiness-trace';

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
export const AUDIO_UNLOCK_TIMEOUT_MS = 3000;

/** 실제 출력 그래프와 같은 Context의 상태·수명 포트. */
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
  /** 선택 마이크 소스 변경. null이면 해당 송출만 정리한다. */
  onMicrophoneTrack?(track: MediaStreamTrack | null): void;
  /** S15P21C204-240. 권한·장치 열기 단계 기록. 생략하면 계측하지 않는다. */
  readiness?: ReadinessRecorder;
  /** 단계 기록용 시계. 생략하면 performance.now를 쓴다. */
  now?(): number;
}>;

export interface DeviceManager {
  start(input: { microphone: boolean }): Promise<DeviceStatus>;
  setMicrophone(enabled: boolean): Promise<DeviceStatus>;
  unlockAudio(): Promise<DeviceStatus>;
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
  const now = deps.now ?? (() => performance.now());
  let status = INITIAL_DEVICE_STATUS;
  let generation = 0;
  let disposed = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  let camera: CameraHolding | null = null;
  let cameraRequest: Promise<void> | null = null;
  let microphone: MediaStreamTrack | null = null;
  let microphoneRequest: Promise<void> | null = null;
  let microphoneGeneration = 0;
  let microphoneWanted = false;
  let microphoneEnded: (() => void) | null = null;
  let preview: HTMLVideoElement | null = null;
  let audioUnlock: AudioUnlockPort | null = null;
  let audioRequest: Promise<void> | null = null;
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
    if (microphoneEnded) track.removeEventListener('ended', microphoneEnded);
    microphoneEnded = null;
    deps.onMicrophoneTrack?.(null);
    try {
      track.stop();
    } catch {
      // 무시한다.
    }
  };

  const unlockAudio = () => {
    if (audioRequest) return audioRequest;
    if (!environment.createAudioUnlock) return Promise.resolve();
    try {
      audioUnlock ??= environment.createAudioUnlock() ?? null;
    } catch {
      publish({ audioPlayback: 'failed' });
      return Promise.resolve();
    }
    if (!audioUnlock) {
      publish({ audioPlayback: 'failed' });
      return Promise.resolve();
    }
    const context = audioUnlock;
    let resume: Promise<void>;
    try {
      resume = context.resume();
    } catch {
      resume = Promise.reject(new Error('AUDIO_RESUME_FAILED'));
    }
    let timeout: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<void>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('AUDIO_UNLOCK_TIMEOUT')),
        AUDIO_UNLOCK_TIMEOUT_MS,
      );
    });
    audioRequest = Promise.race([resume, timedOut, closed])
      .then(() => {
        if (disposed || audioUnlock !== context) return;
        publish({ audioPlayback: context.state === 'running' ? 'ready' : 'locked' });
      })
      .catch(() => {
        if (disposed || audioUnlock !== context) return;
        publish({ audioPlayback: 'failed' });
      })
      .finally(() => {
        clearTimeout(timeout);
        audioRequest = null;
      });
    return audioRequest;
  };

  const watchDeviceChange = () => {
    if (unsubscribeDeviceChange || !environment.onDeviceChange) return;
    unsubscribeDeviceChange = environment.onDeviceChange(() => {
      if (disposed) return;
      if (camera?.track?.readyState === 'ended') handleCameraEnded();
      if (microphone?.readyState === 'ended') handleMicrophoneEnded();
    });
  };

  const handleCameraEnded = () => {
    if (disposed) return;
    detachPreview();
    releaseCamera();
    deps.onCameraTrack?.(null);
    publish({ camera: 'failed', errorCode: 'DEVICE_LOST' });
  };

  const handleMicrophoneEnded = () => {
    if (disposed || !microphone) return;
    releaseMicrophone();
    publish({ microphone: 'failed' });
  };

  const acquireCamera = (request: number): Promise<void> => {
    if (camera) return Promise.resolve();
    if (cameraRequest) return cameraRequest;
    const pending = acquireCameraOnce(request).finally(() => {
      if (cameraRequest === pending) cameraRequest = null;
    });
    cameraRequest = pending;
    return pending;
  };

  const acquireCameraOnce = async (request: number): Promise<void> => {
    publish({ camera: 'requesting' });
    // S15P21C204-240. 권한 프롬프트 대기가 이 구간에 들어간다. 사용자가 늦게 누른 경우와
    // 장치가 안 열리는 경우는 둘 다 길게 나오므로 종료 code 로만 구분한다.
    deps.readiness?.begin('permission', now());
    let stream: MediaStream;
    try {
      stream = await environment.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (error) {
      if (request !== generation || disposed) return;
      const code = deviceErrorCode(error);
      deps.readiness?.fail('permission', now(), code);
      publish({ camera: 'failed', errorCode: code });
      return;
    }
    // 폐기된 요청의 늦은 성공은 트랙을 바로 정리하고 상태를 바꾸지 않는다.
    if (request !== generation || disposed) {
      stopStream(stream);
      return;
    }
    deps.readiness?.succeed('permission', now());
    deps.readiness?.begin('device-open', now());
    const track = stream.getVideoTracks()[0] ?? null;
    if (!track || track.readyState !== 'live') {
      stopStream(stream);
      deps.readiness?.fail('device-open', now(), 'DEVICE_LOST');
      publish({ camera: 'failed', errorCode: 'DEVICE_LOST' });
      return;
    }
    const onEnded = () => handleCameraEnded();
    track?.addEventListener('ended', onEnded);
    camera = { stream, track, onEnded };
    attachPreview(stream);
    watchDeviceChange();
    // 미리보기까지 붙어야 장치 열기가 끝난 것이다. 트랙 획득만으로 끝내지 않는다.
    deps.readiness?.succeed('device-open', now());
    deps.onCameraTrack?.(track);
    publish({ camera: 'ready', errorCode: null });
  };

  const acquireMicrophone = (request: number): Promise<void> => {
    if (microphone?.readyState === 'live') return Promise.resolve();
    if (microphoneRequest) return microphoneRequest;
    releaseMicrophone();
    const pending = acquireMicrophoneOnce(request, microphoneGeneration).finally(() => {
      if (microphoneRequest === pending) microphoneRequest = null;
    });
    microphoneRequest = pending;
    return pending;
  };

  const acquireMicrophoneOnce = async (request: number, microphoneRun: number): Promise<void> => {
    publish({ microphone: 'requesting' });
    let stream: MediaStream;
    try {
      stream = await environment.getUserMedia(MICROPHONE_CONSTRAINTS);
    } catch (error) {
      if (
        request !== generation ||
        disposed ||
        microphoneRun !== microphoneGeneration ||
        !microphoneWanted
      )
        return;
      // 마이크 거부는 선택 기능의 실패이며 카메라 상태를 바꾸지 않는다.
      publish({ microphone: microphoneStateForError(deviceErrorCode(error)) });
      return;
    }
    if (
      request !== generation ||
      disposed ||
      microphoneRun !== microphoneGeneration ||
      !microphoneWanted
    ) {
      stopStream(stream);
      return;
    }
    const track = stream.getAudioTracks()[0] ?? null;
    if (!track || track.readyState !== 'live') {
      stopStream(stream);
      publish({ microphone: 'failed' });
      return;
    }
    microphone = track;
    microphoneEnded = () => handleMicrophoneEnded();
    track.addEventListener('ended', microphoneEnded);
    deps.onMicrophoneTrack?.(track);
    watchDeviceChange();
    publish({ microphone: 'ready' });
  };

  const updateMicrophoneSource = (enabled: boolean, request: number) => {
    if (microphoneWanted !== enabled) {
      microphoneWanted = enabled;
      microphoneGeneration++;
      microphoneRequest = null;
    }
    if (!enabled) {
      releaseMicrophone();
      microphoneRequest = null;
      publish({ microphone: 'off' });
      return Promise.resolve();
    }
    return acquireMicrophone(request);
  };

  return {
    async setMicrophone(enabled) {
      if (disposed) return status;
      const audioStep = unlockAudio();
      const microphoneStep = updateMicrophoneSource(enabled, generation);
      await Promise.race([Promise.all([microphoneStep, audioStep]), closed]);
      return status;
    },
    async start(input) {
      if (disposed) return status;
      const request = generation;
      const audioStep = unlockAudio();
      const cameraStep = acquireCamera(request);
      const microphoneStep = updateMicrophoneSource(input.microphone, request);
      await Promise.race([Promise.all([cameraStep, microphoneStep, audioStep]), closed]);
      return status;
    },

    async unlockAudio() {
      if (!disposed) await unlockAudio();
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
      resolveClosed();
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

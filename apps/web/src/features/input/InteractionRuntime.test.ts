import { describe, expect, it, vi } from 'vitest';

import type { DeviceEnvironment } from '../devices/device-manager';
import type { SensorSnapshot } from '../vision/sensor-types';
import type { WorkerPort } from '../vision/worker-scheduler';
import type { FrameSource } from '../vision/frame-pump';
import {
  createInteractionRuntime,
  InteractionNotImplementedError,
  isVisionReady,
  type InteractionDeps,
  type VisionEnvironment,
} from './InteractionRuntime';
import { INPUT_TUNING } from './input-tuning';
import { POSE_KEY_POINTS } from '../vision/pose-sensor';

function videoTrack() {
  const listeners = new Map<string, () => void>();
  return {
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    end: () => listeners.get('ended')?.(),
  };
}

function stream(track: ReturnType<typeof videoTrack>) {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

function poseLandmarks() {
  const points = Array.from({ length: Math.max(...Object.values(POSE_KEY_POINTS)) + 1 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));
  points[POSE_KEY_POINTS.leftShoulder] = { x: 0.4, y: 0.3, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.rightShoulder] = { x: 0.6, y: 0.3, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.leftHip] = { x: 0.4, y: 0.7, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.rightHip] = { x: 0.6, y: 0.7, z: 0, visibility: 0.9 };
  return points;
}

function snapshot(frameId: number, atMs: number, generation: number): SensorSnapshot {
  return {
    runtimeGeneration: generation,
    emittedAtMs: atMs,
    face: {
      frameId,
      sampledAtMs: atMs,
      receivedAtMs: atMs,
      status: 'valid',
      data: { landmarks: [], yawRad: 0.01, quality: 'valid' },
    },
    pose: {
      frameId,
      sampledAtMs: atMs,
      receivedAtMs: atMs,
      status: 'valid',
      data: { landmarks: poseLandmarks(), quality: 'valid' },
    },
    gesture: null,
  };
}

function harness() {
  const track = videoTrack();
  const sensors: SensorSnapshot[] = [];
  const statuses: {
    camera: string;
    vision: string;
    calibration: string;
    errorCode: string | null;
  }[] = [];
  const previews: (HTMLVideoElement | null)[] = [];
  let clock = 1000;
  let workerHandler: ((event: { data: unknown }) => void) | null = null;
  const posted: unknown[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const worker: WorkerPort = {
    postMessage: (message) => posted.push(message),
    terminate: vi.fn(),
    set onmessage(handler: ((event: { data: unknown }) => void) | null) {
      workerHandler = handler;
    },
    set onerror(_handler: ((event: unknown) => void) | null) {},
  };
  const source: FrameSource = {
    schedule: () => () => undefined,
    grab: async () => null,
    now: () => clock,
  };
  const environment: DeviceEnvironment = {
    getUserMedia: async () => stream(track),
    createPreviewElement: () =>
      ({
        srcObject: null,
        muted: false,
        playsInline: false,
        autoplay: false,
        play: () => Promise.resolve(),
        pause: () => undefined,
      }) as unknown as HTMLVideoElement,
  };
  const vision: VisionEnvironment = {
    createWorker: () => worker,
    createFrameSource: () => source,
    now: () => clock,
    setTimer: (handler) => {
      const handle = nextTimer++;
      timers.set(handle, handler);
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
  };
  const deps: InteractionDeps = {
    sendCommand: vi.fn(() => 'request-1'),
    requestMediaGrant: vi.fn(),
    reportMediaStatus: vi.fn(),
    requestBindingsRefresh: vi.fn(),
    onDeviceStatus: (status) =>
      statuses.push({
        camera: status.camera,
        vision: status.vision,
        calibration: status.calibration,
        errorCode: status.errorCode,
      }),
    onFaceTrack: vi.fn(),
    onMediaStatus: vi.fn(),
    onSensors: (snapshotValue) => sensors.push(snapshotValue),
    onInteractionState: vi.fn(),
    onLocalPreview: (element) => previews.push(element),
  } as unknown as InteractionDeps;

  const runtime = createInteractionRuntime(deps, { environment, vision });
  return {
    runtime,
    track,
    sensors,
    statuses,
    previews,
    posted,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    emit: (frameId: number, generation = 1) =>
      workerHandler?.({
        data: {
          type: 'result',
          runtimeGeneration: generation,
          frameId,
          sampledAtMs: clock,
          outcomes: {
            face: snapshot(frameId, clock, generation).face
              ? { status: 'valid', data: { landmarks: [], yawRad: 0.01, quality: 'valid' } }
              : undefined,
            pose: { status: 'valid', data: { landmarks: poseLandmarks(), quality: 'valid' } },
          },
        },
      }),
    ready: (generation = 1) =>
      workerHandler?.({
        data: { type: 'ready', runtimeGeneration: generation, loaded: ['face', 'pose', 'gesture'] },
      }),
    fireTimers: () => {
      for (const handler of [...timers.values()]) handler();
    },
  };
}

describe('createInteractionRuntime', () => {
  it('starts the vision pipeline only after the camera is ready', async () => {
    const base = harness();

    await base.runtime.startDevices({ microphone: false });

    expect(base.posted[0]).toMatchObject({ type: 'init', runtimeGeneration: 1 });
    expect(base.statuses.at(-1)).toMatchObject({ camera: 'ready', vision: 'loading' });
    expect(base.previews[0]).not.toBeNull();
  });

  it('never reports vision ready from the model load alone', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });

    base.ready();
    base.emit(1);

    // 모델이 로드되고 유효 얼굴이 있어도 가공 프레임/트랙이 없으면 loading이다.
    expect(base.statuses.map((status) => status.vision)).not.toContain('ready');
    expect(base.sensors).toHaveLength(1);
  });

  it('requires all four inputs for vision ready', () => {
    const all = {
      modelsLoaded: true,
      hasFreshValidFace: true,
      hasFirstSafeFrame: true,
      hasLiveProcessedTrack: true,
    };
    expect(isVisionReady(all)).toBe(true);
    expect(isVisionReady({ ...all, modelsLoaded: false })).toBe(false);
    expect(isVisionReady({ ...all, hasFreshValidFace: false })).toBe(false);
    expect(isVisionReady({ ...all, hasFirstSafeFrame: false })).toBe(false);
    expect(isVisionReady({ ...all, hasLiveProcessedTrack: false })).toBe(false);
  });

  it('calibrates from enough fresh samples and reports ready', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();

    const calibrating = base.runtime.calibrate();
    for (let index = 0; index < INPUT_TUNING.calibrationMinSamples; index += 1) {
      base.advance(40);
      base.emit(index + 1);
    }
    const status = await calibrating;

    expect(status.calibration).toBe('ready');
    expect(status.errorCode).toBeNull();
  });

  it('leaves the calibration failed when the window closes without enough samples', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();

    const calibrating = base.runtime.calibrate();
    base.advance(40);
    base.emit(1);
    base.fireTimers();
    const status = await calibrating;

    expect(status.calibration).toBe('failed');
    expect(status.errorCode).toBe('CALIBRATION_NOT_ENOUGH_SAMPLES');
  });

  it('refuses to calibrate without a ready camera', async () => {
    const base = harness();

    const status = await base.runtime.calibrate();

    // 장치를 만들지 않았으면 상태를 바꾸지 않는다.
    expect(status.calibration).toBe('idle');
  });

  it('drops the vision pipeline and the calibration when the camera track ends', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();

    base.track.end();

    expect(base.statuses.at(-1)).toMatchObject({
      camera: 'failed',
      vision: 'idle',
      calibration: 'idle',
    });
    expect(base.previews.at(-1)).toBeNull();
  });

  it('emits no sensor callback after dispose', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();
    base.emit(1);
    const seen = base.sensors.length;

    await base.runtime.dispose();
    base.emit(2);

    expect(base.sensors).toHaveLength(seen);
  });

  it('rejects the media and context methods that later tasks own', async () => {
    const base = harness();

    await expect(base.runtime.connectMedia({} as never)).rejects.toBeInstanceOf(
      InteractionNotImplementedError,
    );
    await expect(base.runtime.retireMediaGeneration()).rejects.toBeInstanceOf(
      InteractionNotImplementedError,
    );
    expect(() => base.runtime.setContext({} as never)).toThrow(InteractionNotImplementedError);
    expect(() => base.runtime.applyMediaBindings({} as never)).toThrow(
      InteractionNotImplementedError,
    );
    expect(() => base.runtime.applyAudioPolicy({} as never)).toThrow(
      InteractionNotImplementedError,
    );
  });
});

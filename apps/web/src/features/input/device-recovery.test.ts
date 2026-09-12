import { expect, it, vi } from 'vitest';
import {
  createInteractionRuntime,
  MODEL_LOAD_TIMEOUT_MS,
  type InteractionContext,
  type InteractionDeps,
} from './InteractionRuntime';
import type { WorkerPort } from '../vision/worker-scheduler';
import type { WorkerRequest } from '../vision/worker-protocol';
import type { DeviceStatus } from '../devices/device-status';
import { FACE_OVAL_INDICES } from '../media/face-mask';
import { POSE_KEY_POINTS } from '../vision/pose-sensor';

function makeTrack(kind: 'audio' | 'video') {
  const listeners = new Map<string, () => void>();
  const track = {
    kind,
    readyState: 'live',
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
    addEventListener: (name: string, handler: () => void) => {
      listeners.set(name, handler);
    },
    removeEventListener: (name: string) => {
      listeners.delete(name);
    },
    end: () => {
      track.readyState = 'ended';
      listeners.get('ended')?.();
    },
  };
  return track;
}

function fixture() {
  let now = 1000;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; work(): void }>();
  const cameras: ReturnType<typeof makeTrack>[] = [];
  const microphones: ReturnType<typeof makeTrack>[] = [];
  const previews: HTMLVideoElement[] = [];
  const statuses: DeviceStatus[] = [];
  const workers: {
    port: WorkerPort;
    emit(data: unknown): void;
    generation: number;
    terminate: ReturnType<typeof vi.fn>;
  }[] = [];
  const processed = makeTrack('video');
  const canvas = {
    fillStyle: '',
    filter: '',
    fillRect: vi.fn(),
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() {},
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
  };
  const captures = vi.fn(
    () =>
      ({
        getTracks: () => [processed],
        getVideoTracks: () => [processed],
      }) as unknown as MediaStream,
  );
  const disconnect = vi.fn(async () => {});
  let sid = 0;
  const participant = {
    publishTrack: vi.fn(async () => ({ trackSid: `TR_${++sid}` })),
    unpublishTrack: vi.fn(async () => {}),
  };
  const deps: InteractionDeps = {
    sendCommand: vi.fn(() => 'request'),
    requestMediaGrant: vi.fn(),
    reportMediaStatus: vi.fn(),
    requestBindingsRefresh: vi.fn(),
    onDeviceStatus: (status) => {
      statuses.push(status);
    },
    onFaceTrack: vi.fn(),
    onMediaStatus: vi.fn(),
    onSensors: vi.fn(),
    onInteractionState: vi.fn(),
    onLocalPreview: vi.fn(),
  };
  const runtime = createInteractionRuntime(deps, {
    environment: {
      getUserMedia: async (constraints) => {
        const track = makeTrack(constraints.audio ? 'audio' : 'video');
        (constraints.audio ? microphones : cameras).push(track);
        return {
          getTracks: () => [track],
          getVideoTracks: () => (constraints.audio ? [] : [track]),
          getAudioTracks: () => (constraints.audio ? [track] : []),
        } as unknown as MediaStream;
      },
      createPreviewElement: () => {
        const video = {
          srcObject: null,
          videoWidth: 640,
          videoHeight: 480,
          play: async () => {},
          pause() {},
        } as unknown as HTMLVideoElement;
        previews.push(video);
        return video;
      },
    },
    vision: {
      now: () => now,
      setTimer: (work, delay) => {
        const id = ++nextTimer;
        timers.set(id, { at: now + delay, work });
        return id;
      },
      clearTimer: (id) => {
        timers.delete(id);
      },
      createFrameSource: () => ({
        now: () => now,
        schedule: () => () => {},
        grab: async () => null,
      }),
      createWorker: () => {
        let listener: ((event: { data: unknown }) => void) | null = null;
        const entry = {
          generation: 0,
          terminate: vi.fn(),
          emit: (data: unknown) => listener?.({ data }),
          port: null as unknown as WorkerPort,
        };
        entry.port = {
          postMessage: (message: WorkerRequest) => {
            if (message.type === 'init') entry.generation = message.runtimeGeneration;
          },
          terminate: entry.terminate,
          set onmessage(value) {
            listener = value;
          },
          set onerror(_value) {},
        };
        workers.push(entry);
        return entry.port;
      },
    },
    compositor: {
      now: () => now,
      createCanvas: (width, height) => ({
        width,
        height,
        getContext: () => canvas,
        captureStream: captures,
      }),
    },
    createMediaRoom: () => ({
      connect: async () => {},
      disconnect,
      on() {},
      removeAllListeners() {},
    }),
    getPublisher: () => participant,
    epochNowSeconds: () => 1000,
  });
  const context: InteractionContext = {
    matchId: 'm',
    selfPlayerId: 'self',
    role: 'runner',
    phase: 'PLAYING',
    status: 'ACTIVE',
    mode: 'motion',
    pageActive: true,
  };
  runtime.setContext(context);
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].work();
    }
    now = target;
  };
  const ready = () => {
    const worker = workers.at(-1)!;
    worker.emit({
      type: 'ready',
      runtimeGeneration: worker.generation,
      loaded: ['face', 'pose', 'gesture'],
    });
  };
  const emit = (frameId: number) => {
    const worker = workers.at(-1)!;
    const landmarks = Array.from({ length: Math.max(...FACE_OVAL_INDICES) + 1 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
    }));
    FACE_OVAL_INDICES.forEach((index, order) => {
      const angle = (order * 2 * Math.PI) / FACE_OVAL_INDICES.length;
      landmarks[index] = { x: 0.5 + Math.cos(angle) * 0.12, y: 0.5 + Math.sin(angle) * 0.12, z: 0 };
    });
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    pose[POSE_KEY_POINTS.nose] = { x: 0.5, y: 0.1, z: 0, visibility: 1 };
    pose[POSE_KEY_POINTS.leftShoulder] = { x: 0.4, y: 0.3, z: 0, visibility: 1 };
    pose[POSE_KEY_POINTS.rightShoulder] = { x: 0.6, y: 0.3, z: 0, visibility: 1 };
    worker.emit({
      type: 'result',
      runtimeGeneration: worker.generation,
      frameId,
      sampledAtMs: now,
      outcomes: {
        face: { status: 'valid', data: { landmarks, yawRad: 0, quality: 'valid' } },
        pose: { status: 'valid', data: { landmarks: pose, quality: 'valid' } },
      },
    });
  };
  const samples = () => {
    for (let i = 1; i <= 8; i++) {
      advance(70);
      emit(i);
    }
  };
  const publish = async () => {
    await runtime.connectMedia({
      matchId: 'm',
      mediaInstanceId: 'media',
      receiverGeneration: 1,
      url: 'wss://synthetic.invalid',
      token: 'synthetic',
      roomName: 'room',
      mediaIdentity: 'self',
      expiresAt: 2000,
    });
    return runtime.publishMedia();
  };
  return {
    runtime,
    context,
    cameras,
    microphones,
    previews,
    workers,
    statuses,
    canvas,
    captures,
    processed,
    timers,
    participant,
    disconnect,
    deps,
    advance,
    ready,
    emit,
    samples,
    publish,
  };
}

it('waits for slow model readiness before collecting eight fresh calibration samples', async () => {
  const f = fixture();
  try {
    await f.runtime.startDevices({ microphone: false });
    const waiting = f.runtime.calibrate();
    expect(f.runtime.calibrate()).toBe(waiting);
    f.advance(2100);
    expect(f.statuses.at(-1)).toMatchObject({
      calibration: 'running',
      errorCode: 'CALIBRATION_WAITING_FOR_MODELS',
    });
    f.ready();
    f.samples();
    expect((await waiting).calibration).toBe('ready');
  } finally {
    await f.runtime.dispose();
  }
  expect(f.timers.size).toBe(0);
});

it('retries a failed Worker once on explicit start and rejects late old responses', async () => {
  const f = fixture();
  try {
    await f.runtime.startDevices({ microphone: false });
    const old = f.workers[0]!;
    const waiting = f.runtime.calibrate();
    old.emit({
      type: 'error',
      runtimeGeneration: old.generation,
      frameId: null,
      code: 'MODEL_LOAD_FAILED',
    });
    expect((await waiting).vision).toBe('failed');
    await Promise.all([
      f.runtime.startDevices({ microphone: false }),
      f.runtime.startDevices({ microphone: false }),
    ]);
    expect(f.workers).toHaveLength(2);
    expect(old.terminate).toHaveBeenCalledOnce();
    const calibration = f.runtime.calibrate();
    old.emit({
      type: 'ready',
      runtimeGeneration: old.generation,
      loaded: ['face', 'pose', 'gesture'],
    });
    expect(f.statuses.at(-1)?.errorCode).toBe('CALIBRATION_WAITING_FOR_MODELS');
    f.ready();
    f.samples();
    expect((await calibration).calibration).toBe('ready');
  } finally {
    await f.runtime.dispose();
  }
});

it('ends an unresponsive model load and pending calibration without an automatic retry loop', async () => {
  const f = fixture();
  try {
    await f.runtime.startDevices({ microphone: false });
    const waiting = f.runtime.calibrate();
    f.advance(MODEL_LOAD_TIMEOUT_MS + 100);
    expect(await waiting).toMatchObject({
      vision: 'failed',
      calibration: 'failed',
      errorCode: 'MODEL_LOAD_TIMEOUT',
    });
    f.advance(MODEL_LOAD_TIMEOUT_MS);
    expect(f.workers).toHaveLength(1);
    expect(f.processed.stop).not.toHaveBeenCalled();
    expect(f.canvas.arc).toHaveBeenCalled();
  } finally {
    await f.runtime.dispose();
  }
  expect(f.timers.size).toBe(0);
});

it('preserves the face publication through camera loss and reads the recovered preview after new calibration', async () => {
  const f = fixture();
  try {
    await f.runtime.startDevices({ microphone: false });
    f.ready();
    f.emit(1);
    const faceSid = await f.publish();
    f.cameras[0]!.end();
    f.runtime.setContext({ ...f.context, mode: 'keyboard' });
    const drawn = f.canvas.drawImage.mock.calls.length;
    f.advance(1400);
    expect(f.processed.stop).not.toHaveBeenCalled();
    expect(f.canvas.arc).toHaveBeenCalled();
    expect(f.canvas.drawImage).toHaveBeenCalledTimes(drawn);
    expect(f.runtime.getGenerationState()).toBe('live');
    expect(f.disconnect).not.toHaveBeenCalled();
    await f.runtime.startDevices({ microphone: false });
    expect(f.captures).toHaveBeenCalledOnce();
    expect(f.workers).toHaveLength(2);
    expect(f.runtime.getPublications()[0]?.trackSid).toBe(faceSid);
    const calibration = f.runtime.calibrate();
    f.ready();
    f.samples();
    expect((await calibration).calibration).toBe('ready');
    expect(f.canvas.drawImage.mock.lastCall?.[0]).toBe(f.previews[1]);
    expect(f.deps.onInteractionState).not.toHaveBeenCalledWith({
      mode: 'motion',
      selectedEquipment: 'sensor',
    });
    f.runtime.setContext(f.context);
    expect(f.deps.onInteractionState).toHaveBeenLastCalledWith({
      mode: 'motion',
      selectedEquipment: 'sensor',
    });
  } finally {
    await f.runtime.dispose();
  }
  expect(f.processed.stop).toHaveBeenCalledOnce();
  expect(f.timers.size).toBe(0);
});

it.each(['silence', 'error'] as const)(
  'draws a default face independently after Worker %s',
  async (failure) => {
    const f = fixture();
    try {
      await f.runtime.startDevices({ microphone: false });
      f.ready();
      f.emit(1);
      const faceSid = await f.publish();
      const drawn = f.canvas.drawImage.mock.calls.length;
      if (failure === 'error') {
        const worker = f.workers[0]!;
        worker.emit({
          type: 'error',
          runtimeGeneration: worker.generation,
          frameId: null,
          code: 'INFERENCE_FAILED',
        });
      }
      f.advance(2200);
      expect(f.canvas.arc).toHaveBeenCalled();
      expect(f.canvas.drawImage).toHaveBeenCalledTimes(drawn);
      expect(f.cameras[0]!.stop).not.toHaveBeenCalled();
      expect(f.processed.stop).not.toHaveBeenCalled();
      expect(f.runtime.getPublications()[0]?.trackSid).toBe(faceSid);
      expect(f.statuses.at(-1)?.vision).toBe('failed');
    } finally {
      await f.runtime.dispose();
    }
  },
);

it('replaces only an ended microphone publication and keeps the face and media scope', async () => {
  const f = fixture();
  try {
    await f.runtime.startDevices({ microphone: true });
    f.ready();
    f.emit(1);
    const faceSid = await f.publish();
    f.microphones[0]!.end();
    await vi.waitFor(() => expect(f.runtime.getPublications()).toHaveLength(1));
    expect(f.statuses.at(-1)?.microphone).toBe('failed');
    await f.runtime.startDevices({ microphone: true });
    const records = f.runtime.getPublications();
    expect(records.find((r) => r.source === 'processed-face')?.trackSid).toBe(faceSid);
    expect(records.find((r) => r.source === 'microphone')).toMatchObject({
      trackSid: 'TR_3',
      serverConfirmed: false,
      scope: { receiverGeneration: 1 },
    });
    expect(f.microphones).toHaveLength(2);
    expect(f.workers).toHaveLength(1);
    expect(f.disconnect).not.toHaveBeenCalled();
    await f.runtime.startDevices({ microphone: false });
    await vi.waitFor(() => expect(f.runtime.getPublications()).toHaveLength(1));
  } finally {
    await f.runtime.dispose();
  }
});

it('settles calibration immediately when the camera disappears or the participant disposes', async () => {
  const f = fixture();
  await f.runtime.startDevices({ microphone: false });
  const waiting = f.runtime.calibrate();
  f.cameras[0]!.end();
  expect((await waiting).calibration).not.toBe('ready');
  await f.runtime.startDevices({ microphone: false });
  const retry = f.runtime.calibrate();
  await f.runtime.dispose();
  expect((await retry).calibration).not.toBe('ready');
  expect(f.timers.size).toBe(0);
});

import { describe, expect, it, vi } from 'vitest';

import type { DeviceEnvironment } from '../devices/device-manager';
import type { SensorSnapshot } from '../vision/sensor-types';
import type { WorkerPort } from '../vision/worker-scheduler';
import type { FrameSource } from '../vision/frame-pump';
import type { CompositorContext, CompositorEnvironment } from '../media/face-compositor';
import {
  createInteractionRuntime,
  FIRST_INFERENCE_TIMEOUT_MS,
  isVisionReady,
  MODEL_LOAD_TIMEOUT_MS,
  type InteractionDeps,
  type InteractionRuntimeOptions,
  type VisionEnvironment,
} from './InteractionRuntime';
import type { ReadinessStage, ReadinessTrace } from '../devices/readiness-trace';
import { INPUT_TUNING } from './input-tuning';
import { MOVE_REFRESH_MS } from './move-intent';
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
  points[POSE_KEY_POINTS.nose] = { x: 0.5, y: 0.1, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.leftShoulder] = { x: 0.4, y: 0.3, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.rightShoulder] = { x: 0.6, y: 0.3, z: 0, visibility: 0.9 };
  points[POSE_KEY_POINTS.leftHip] = { x: 0.4, y: 1.7, z: 0, visibility: 0 };
  points[POSE_KEY_POINTS.rightHip] = { x: 0.6, y: 1.7, z: 0, visibility: 0 };
  return points;
}

function harness(
  overrides: Partial<InteractionRuntimeOptions> = {},
  depOverrides: Partial<InteractionDeps> = {},
) {
  const track = videoTrack();
  const sensors: SensorSnapshot[] = [];
  const statuses: {
    camera: string;
    vision: string;
    calibration: string;
    errorCode: string | null;
  }[] = [];
  const previews: (HTMLVideoElement | null)[] = [];
  const faceTracks: { playerId: string; element: HTMLVideoElement | null }[] = [];
  const refreshRequests: unknown[] = [];
  const unsubscribed: { trackSid: string }[] = [];
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
  const processedTrack = { kind: 'video', readyState: 'live', stop: vi.fn() };
  const context2d: CompositorContext = {
    fillStyle: '',
    filter: '',
    fillRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: () => undefined,
  };
  const compositor: CompositorEnvironment = {
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => context2d,
      captureStream: () =>
        ({
          getVideoTracks: () => [processedTrack],
          getTracks: () => [processedTrack],
        }) as unknown as MediaStream,
    }),
    now: () => clock,
  };
  const deps: InteractionDeps = {
    sendCommand: vi.fn(() => 'request-1'),
    requestMediaGrant: vi.fn(),
    reportMediaStatus: vi.fn(),
    requestBindingsRefresh: (request: unknown) => refreshRequests.push(request),
    onDeviceStatus: (status) =>
      statuses.push({
        camera: status.camera,
        vision: status.vision,
        calibration: status.calibration,
        errorCode: status.errorCode,
      }),
    onFaceTrack: (event: { playerId: string; element: HTMLVideoElement | null }) =>
      faceTracks.push(event),
    onMediaStatus: vi.fn(),
    onSensors: (snapshotValue) => sensors.push(snapshotValue),
    onInteractionState: vi.fn(),
    onLocalPreview: (element) => previews.push(element),
  } as unknown as InteractionDeps;
  Object.assign(deps as object, depOverrides);

  const runtime = createInteractionRuntime(deps, {
    environment,
    vision,
    compositor,
    createRemoteElement: () => ({ srcObject: null }) as unknown as HTMLVideoElement,
    unsubscribeTrack: (track) => unsubscribed.push({ trackSid: track.trackSid }),
    ...overrides,
  });
  return {
    runtime,
    deps,
    track,
    compositorContext: context2d,
    processedTrack,
    faceTracks,
    refreshRequests,
    unsubscribed,
    sensors,
    statuses,
    previews,
    posted,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    emit: (
      frameId: number,
      generation = 1,
      yawRad = 0.01,
      leanDepth = 0,
      model: 'both' | 'face' | 'pose' | 'gesture' = 'both',
    ) =>
      workerHandler?.({
        data: {
          type: 'result',
          runtimeGeneration: generation,
          frameId,
          sampledAtMs: clock,
          outcomes: {
            face:
              model === 'both' || model === 'face'
                ? { status: 'valid', data: { landmarks: [], yawRad, quality: 'valid' } }
                : undefined,
            pose:
              model === 'both' || model === 'pose'
                ? {
                    status: 'valid',
                    data: {
                      // leanDepth is the shoulder-span signal ln(span/neutral): widen both shoulders.
                      landmarks: poseLandmarks().map((point, index) =>
                        index === POSE_KEY_POINTS.leftShoulder
                          ? { ...point, x: 0.5 - 0.1 * Math.exp(leanDepth) }
                          : index === POSE_KEY_POINTS.rightShoulder
                            ? { ...point, x: 0.5 + 0.1 * Math.exp(leanDepth) }
                            : point,
                      ),
                      quality: 'valid',
                    },
                  }
                : undefined,
            gesture:
              model === 'gesture'
                ? { status: 'valid', data: { kind: 'none', score: 0 } }
                : undefined,
          },
        },
      }),
    ready: (generation = 1) =>
      workerHandler?.({
        data: { type: 'ready', runtimeGeneration: generation, loaded: ['face', 'pose', 'gesture'] },
      }),
    emitMissing: (frameId: number) =>
      workerHandler?.({
        data: {
          type: 'result',
          runtimeGeneration: 1,
          frameId,
          sampledAtMs: clock,
          outcomes: {
            face: { status: 'missing', data: null },
            pose: { status: 'missing', data: null },
          },
        },
      }),
    fireTimers: () => {
      const due = [...timers.values()];
      timers.clear();
      for (const handler of due) handler();
    },
  };
}

/** S15P21C204-244. 탭 이탈을 시험에서 직접 몰기 위한 source. */
function visibilitySource() {
  const listeners = new Set<() => void>();
  let hidden = false;
  return {
    source: {
      isHidden: () => hidden,
      addEventListener: (_type: 'visibilitychange', listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: 'visibilitychange', listener: () => void) =>
        listeners.delete(listener),
    },
    set: (value: boolean) => {
      hidden = value;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('S15P21C204-240 준비 단계 기록', () => {
  const stage = (trace: ReadinessTrace | undefined, name: ReadinessStage) =>
    trace?.stages.find((record) => record.stage === name);

  it('times permission and device opening separately on a successful start', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });
      const trace = base.runtime.getReadinessTrace?.();

      expect(stage(trace, 'permission')?.state).toBe('done');
      expect(stage(trace, 'device-open')?.state).toBe('done');
      expect(stage(trace, 'permission')?.durationMs).not.toBeNull();
      expect(trace?.blockedStage).toBe('model-load');
      expect(trace?.cause).toBeNull();
    } finally {
      await base.runtime.dispose();
    }
  });

  it('separates a denied permission from a camera held by another app', async () => {
    const denied = harness({
      environment: {
        getUserMedia: () =>
          Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
        createPreviewElement: () => ({}) as unknown as HTMLVideoElement,
      },
    });
    const busy = harness({
      environment: {
        getUserMedia: () =>
          Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' })),
        createPreviewElement: () => ({}) as unknown as HTMLVideoElement,
      },
    });
    try {
      await denied.runtime.startDevices({ microphone: false });
      await busy.runtime.startDevices({ microphone: false });

      expect(denied.runtime.getReadinessTrace?.().cause).toBe('permission-denied');
      expect(busy.runtime.getReadinessTrace?.().cause).toBe('device-in-use');
      // 권한에서 막혔으면 뒤 단계는 시작하지도 않았다는 것이 기록에 남아야 한다.
      expect(stage(denied.runtime.getReadinessTrace?.(), 'device-open')?.state).toBe('pending');
    } finally {
      await denied.runtime.dispose();
      await busy.runtime.dispose();
    }
  });

  it('closes the model-load stage when the three models report ready', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });
      expect(stage(base.runtime.getReadinessTrace?.(), 'model-load')?.state).toBe('running');

      base.advance(700);
      base.ready();

      const record = stage(base.runtime.getReadinessTrace?.(), 'model-load');
      expect(record?.state).toBe('done');
      expect(record?.durationMs).toBe(700);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('blames the model load when the worker never becomes ready', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });
      base.advance(MODEL_LOAD_TIMEOUT_MS + 100);
      base.fireTimers();

      const trace = base.runtime.getReadinessTrace?.();
      expect(stage(trace, 'model-load')?.errorCode).toBe('MODEL_LOAD_TIMEOUT');
      expect(trace?.cause).toBe('model-load');
      expect(trace?.overBudget).toBe(true);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('does not reopen the model stage for a stall that happens after loading', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      const loadedAt = stage(base.runtime.getReadinessTrace?.(), 'model-load')?.endedAtMs;

      base.advance(FIRST_INFERENCE_TIMEOUT_MS + 100);
      base.fireTimers();

      const record = stage(base.runtime.getReadinessTrace?.(), 'model-load');
      // 추론 정체는 모델 적재 실패가 아니다. 단계 기록을 덮어쓰지 않는다.
      expect(record?.state).toBe('done');
      expect(record?.endedAtMs).toBe(loadedAt);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('reports the trace through the callback as stages move', async () => {
    const traces: ReadinessTrace[] = [];
    const base = harness({}, { onReadinessTrace: (trace) => traces.push(trace) });
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();

      expect(traces.length).toBeGreaterThan(0);
      expect(traces.at(-1)?.stages.filter((record) => record.state === 'done')).toHaveLength(3);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('records the camera combination once the track arrives', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });

      // 실제 브라우저에서만 라벨이 채워진다. 여기서는 자리만 확인한다.
      expect(base.runtime.getReadinessTrace?.().environment).not.toBeNull();
    } finally {
      await base.runtime.dispose();
    }
  });
});

describe('S15P21C204-244 얼굴 조건 안내와 탭 이탈 안전 전환', () => {
  /** 기본 얼굴은 arc로만 그린다. 실사 프레임 경로는 arc를 부르지 않는다. */
  const drewDefaultFace = (base: ReturnType<typeof harness>) =>
    (base.compositorContext.arc as ReturnType<typeof vi.fn>).mock.calls.length;

  it('drops to the default face on tab exit without waiting for the hold window', async () => {
    const visibility = visibilitySource();
    const base = harness({ visibility: visibility.source });
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      base.advance(40);
      base.emit(1);
      base.fireTimers();
      const beforeExit = drewDefaultFace(base);

      // hold 창(1200ms)이 한참 남은 시점에 이탈한다.
      base.advance(100);
      visibility.set(true);

      expect(drewDefaultFace(base)).toBeGreaterThan(beforeExit);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('keeps drawing the default face while the tab stays hidden', async () => {
    const visibility = visibilitySource();
    const base = harness({ visibility: visibility.source });
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      base.advance(40);
      base.emit(1);
      base.fireTimers();
      visibility.set(true);
      const afterExit = drewDefaultFace(base);

      // 숨은 동안 도착한 늦은 결과도 실사 프레임을 되살리지 못한다.
      base.advance(40);
      base.emit(2);
      base.fireTimers();

      expect(drewDefaultFace(base)).toBeGreaterThan(afterExit);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('resumes live frames from new samples after returning to the tab', async () => {
    const visibility = visibilitySource();
    const base = harness({ visibility: visibility.source });
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      visibility.set(true);
      base.fireTimers();
      visibility.set(false);
      const afterReturn = drewDefaultFace(base);

      base.advance(40);
      base.emit(1);
      base.fireTimers();

      // 복귀 뒤 새 표본이 들어오면 더 이상 기본 얼굴을 그리지 않는다.
      expect(drewDefaultFace(base)).toBe(afterReturn);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('reports a turned-away face once the condition persists and clears it on tab exit', async () => {
    const visibility = visibilitySource();
    const notices: (string | null)[] = [];
    const base = harness(
      { visibility: visibility.source },
      { onFaceGuidance: (notice) => notices.push(notice?.condition ?? null) },
    );
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      // 신선한 표본을 유지한 채 안내 지연(800ms)을 넘긴다.
      for (let i = 1; i <= 10; i += 1) {
        base.advance(100);
        base.emit(i, 1, 1.2);
        base.fireTimers();
      }

      expect(notices).toContain('turned-away');

      visibility.set(true);
      expect(notices.at(-1)).toBeNull();
    } finally {
      await base.runtime.dispose();
    }
  });

  it('does not repeat the same guidance while the condition holds', async () => {
    const notices: (string | null)[] = [];
    const base = harness(
      {},
      { onFaceGuidance: (notice) => notices.push(notice?.condition ?? null) },
    );
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      for (let i = 1; i <= 20; i += 1) {
        base.advance(100);
        base.emit(i, 1, 1.2);
        base.fireTimers();
      }

      expect(notices.filter((value) => value === 'turned-away')).toHaveLength(1);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('removes the visibility listener when vision stops', async () => {
    const visibility = visibilitySource();
    const base = harness({ visibility: visibility.source });
    await base.runtime.startDevices({ microphone: false });
    expect(visibility.listenerCount).toBe(1);

    await base.runtime.endParticipation();

    expect(visibility.listenerCount).toBe(0);
  });
});

describe('createInteractionRuntime', () => {
  it('preserves the calibration failure while subsequent missing faces switch input to keyboard', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      const calibrating = base.runtime.calibrate();
      base.emitMissing(1);
      base.fireTimers();
      expect((await calibrating).errorCode).toBe('CALIBRATION_NO_FACE');
      base.advance(1600);
      base.emitMissing(2);
      expect(base.statuses.at(-1)?.errorCode).toBe('CALIBRATION_NO_FACE');
      const retry = base.runtime.calibrate();
      for (let i = 0; i < INPUT_TUNING.calibrationMinSamples; i++) {
        base.advance(40);
        base.emit(3 + i);
      }
      expect((await retry).calibration).toBe('ready');
      expect(base.statuses.at(-1)?.errorCode).toBeNull();
    } finally {
      await base.runtime.dispose();
    }
  });

  it('enables microphone without starting camera, preview or vision and closes a late permission result', async () => {
    let finish!: (stream: MediaStream) => void;
    const audio = { ...videoTrack(), kind: 'audio' };
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          finish = resolve;
        }),
    );
    const preview = vi.fn(() => {
      throw new Error('UNEXPECTED_CAMERA');
    });
    const base = harness({ environment: { getUserMedia, createPreviewElement: preview } });
    const pending = base.runtime.setMicrophone(true);
    await base.runtime.dispose();
    finish({
      getTracks: () => [audio],
      getAudioTracks: () => [audio],
      getVideoTracks: () => [],
    } as unknown as MediaStream);
    await pending;
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: false, audio: true });
    expect(preview).not.toHaveBeenCalled();
    expect(base.posted).toHaveLength(0);
    expect(audio.stop).toHaveBeenCalledOnce();
  });
  it.each(['phase', 'muted', 'disposed'] as const)(
    'rechecks %s after a delayed audio unlock without acquiring a camera or Cloud connection',
    async (boundary) => {
      let release!: () => void;
      let playing = false;
      const diagnostics = {
        playTestTone: vi.fn(() => {
          playing = true;
          return true;
        }),
        setTestToneVolume: vi.fn(),
        stopTestTone: vi.fn(() => {
          playing = false;
        }),
        microphoneLevel: vi.fn(() => null),
        get testTonePlaying() {
          return playing;
        },
        dispose: vi.fn(),
      };
      const unlock = {
        state: 'running',
        resume: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        ),
        close: vi.fn(async () => {}),
      };
      const createAudioUnlock = vi.fn(() => unlock);
      const getUserMedia = vi.fn(async () => stream(videoTrack()));
      const audioNode = () => ({ connect() {}, disconnect() {} });
      const base = harness({
        environment: {
          getUserMedia,
          createAudioUnlock,
          createPreviewElement: () => {
            throw new Error('UNEXPECTED_CAMERA_PREVIEW');
          },
        },
        audio: {
          diagnostics,
          masterGain: { ...audioNode(), gainValue: 0 },
          destination: audioNode(),
          createSourceFromTrack: audioNode,
          createEffectSource: audioNode,
          createGain: () => ({ ...audioNode(), gainValue: 0 }),
          createFilter: () => ({ ...audioNode(), frequency: 0 }),
          createPanner: () => ({ ...audioNode(), azimuthRad: 0 }),
        },
      });
      const current = {
        matchId: 'solo-audio',
        selfPlayerId: 'self',
        phase: 'DEVICE_CHECK',
        role: 'runner',
        status: 'ACTIVE',
        mode: 'keyboard',
        pageActive: true,
      } as const;
      try {
        base.runtime.setContext(current);
        const pending = base.runtime.playTestTone();
        if (boundary === 'phase') base.runtime.setContext({ ...current, phase: 'COUNTDOWN' });
        if (boundary === 'muted')
          base.runtime.setAudioPreferences({ volume: 0.7, muted: true, mutedPlayerIds: [] });
        if (boundary === 'disposed') await base.runtime.dispose();
        release();
        expect(await pending).toBe(boundary === 'muted' ? 'muted' : 'unavailable');
        expect(diagnostics.playTestTone).not.toHaveBeenCalled();
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(base.deps.requestMediaGrant).not.toHaveBeenCalled();
        if (boundary !== 'disposed') {
          base.runtime.setContext(current);
          base.runtime.setAudioPreferences({ volume: 0.4, muted: false, mutedPlayerIds: [] });
          unlock.resume.mockResolvedValue(undefined);
          expect(await base.runtime.playTestTone()).toBe('played');
          expect(createAudioUnlock).toHaveBeenCalledOnce();
          expect(diagnostics.playTestTone).toHaveBeenCalledWith(0.4);
          base.runtime.setContext({ ...current, pageActive: false });
          expect(diagnostics.testTonePlaying).toBe(false);
          expect(base.runtime.getLocalAudioStatus().microphoneLevel).toBe(null);
          expect(diagnostics.microphoneLevel).toHaveBeenLastCalledWith(null);
          expect(await base.runtime.playTestTone()).toBe('unavailable');
        }
      } finally {
        await base.runtime.dispose();
      }
      expect(unlock.close).toHaveBeenCalledOnce();
    },
  );

  it('plays state cues through the injected cue player regardless of the output lock, honoring mute and volume', async () => {
    const audioNode = () => ({ connect() {}, disconnect() {} });
    const cues = { play: vi.fn(() => true), activeCount: 0, dispose: vi.fn() };
    const base = harness({
      audio: {
        cues,
        masterGain: { ...audioNode(), gainValue: 0 },
        destination: audioNode(),
        createSourceFromTrack: audioNode,
        createEffectSource: audioNode,
        createGain: () => ({ ...audioNode(), gainValue: 0 }),
        createFilter: () => ({ ...audioNode(), frequency: 0 }),
        createPanner: () => ({ ...audioNode(), azimuthRad: 0 }),
      },
    });
    try {
      base.runtime.setAudioOutputLock('locked');
      base.runtime.setAudioPreferences({ volume: 0.5, muted: false, mutedPlayerIds: [] });
      expect(base.runtime.playCue?.('captured')).toBe('played');
      expect(cues.play).toHaveBeenCalledWith('captured', 0.5);
      base.runtime.setAudioPreferences({ volume: 0.5, muted: true, mutedPlayerIds: [] });
      expect(base.runtime.playCue?.('victory')).toBe('muted');
      base.runtime.setAudioPreferences({ volume: 0, muted: false, mutedPlayerIds: [] });
      expect(base.runtime.playCue?.('victory')).toBe('muted');
      expect(cues.play).toHaveBeenCalledOnce();
      cues.play.mockReturnValueOnce(false);
      base.runtime.setAudioPreferences({ volume: 1, muted: false, mutedPlayerIds: [] });
      expect(base.runtime.playCue?.('start')).toBe('unavailable');
    } finally {
      await base.runtime.dispose();
    }
    expect(base.runtime.playCue?.('start')).toBe('unavailable');
    // 안내음 없는 환경에서는 조용히 unavailable 이다.
    const bare = harness();
    expect(bare.runtime.playCue?.('start')).toBe('unavailable');
    await bare.runtime.dispose();
  });

  it('turns both ways from fresh calibrated face samples and suppresses motion in keyboard mode', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      const calibrating = base.runtime.calibrate();
      for (let i = 1; i <= 8; i++) {
        base.advance(40);
        base.emit(i);
      }
      expect((await calibrating).calibration).toBe('ready');
      const context = {
        matchId: 'm',
        selfPlayerId: 'self',
        phase: 'PLAYING',
        role: 'runner',
        status: 'ACTIVE',
        mode: 'motion',
        pageActive: true,
      } as const;
      base.runtime.setContext(context);
      let frame = 9;
      const observe = (yaw: number, lean = 0) => {
        for (let i = 0; i < 18; i++) {
          base.advance(50);
          base.emit(frame++, 1, yaw, lean);
        }
      };
      observe(0.7);
      observe(0.01);
      observe(-0.7);
      expect(
        vi
          .mocked(base.deps.sendCommand)
          .mock.calls.filter(([command]) => command.type === 'TURN')
          .map(([command]) => command.payload),
      ).toEqual([{ direction: 'right' }, { direction: 'left' }]);
      observe(0.01, 0.2);
      expect(base.deps.sendCommand).toHaveBeenCalledWith({
        type: 'MOVE_INTENT',
        payload: { direction: 'forward' },
      });
      base.runtime.setContext({ ...context, mode: 'keyboard' });
      vi.mocked(base.deps.sendCommand).mockClear();
      observe(0.7, 0.2);
      expect(base.deps.sendCommand).not.toHaveBeenCalled();
    } finally {
      await base.runtime.dispose();
    }
  });

  it('does not finish face or torso holds when only gesture snapshots arrive', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      const calibration = base.runtime.calibrate();
      for (let frame = 1; frame <= 8; frame++) {
        base.advance(40);
        base.emit(frame);
      }
      expect((await calibration).calibration).toBe('ready');
      base.runtime.setContext({
        matchId: 'm',
        selfPlayerId: 'self',
        role: 'runner',
        phase: 'PLAYING',
        status: 'ACTIVE',
        mode: 'motion',
        pageActive: true,
      });
      base.advance(40);
      base.emit(9, 1, 0.7, 0.2);
      for (let frame = 10; frame <= 16; frame++) {
        base.advance(50);
        base.emit(frame, 1, 0, 0, 'gesture');
      }
      expect(
        vi
          .mocked(base.deps.sendCommand)
          .mock.calls.filter(
            ([command]) =>
              command.type === 'TURN' ||
              (command.type === 'MOVE_INTENT' && command.payload.direction !== null),
          ),
      ).toEqual([]);
      // Fresh independent face samples can start a new hold after the gap.
      for (let frame = 17; frame <= 24; frame++) {
        base.advance(50);
        base.emit(frame, 1, 0.7, 0, 'face');
      }
      expect(
        vi.mocked(base.deps.sendCommand).mock.calls.filter(([command]) => command.type === 'TURN'),
      ).toHaveLength(1);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('starts a fresh hold after leaving and returning to an active tab', async () => {
    const base = harness();
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      const calibration = base.runtime.calibrate();
      for (let frame = 1; frame <= 8; frame++) {
        base.advance(40);
        base.emit(frame);
      }
      await calibration;
      const context = {
        matchId: 'm',
        selfPlayerId: 'self',
        role: 'runner',
        phase: 'PLAYING',
        status: 'ACTIVE',
        mode: 'motion',
        pageActive: true,
      } as const;
      base.runtime.setContext(context);
      base.advance(40);
      base.emit(9, 1, 0.7);
      base.advance(100);
      base.emit(10, 1, 0.7);
      base.runtime.setContext({ ...context, pageActive: false });
      base.advance(50);
      base.runtime.setContext(context);
      base.emit(11, 1, 0.7, 0, 'gesture');
      base.advance(40);
      base.emit(12, 1, 0.7);
      expect(
        vi.mocked(base.deps.sendCommand).mock.calls.filter(([command]) => command.type === 'TURN'),
      ).toEqual([]);
      for (let frame = 13; frame <= 16; frame++) {
        base.advance(50);
        base.emit(frame, 1, 0.7);
      }
      expect(
        vi.mocked(base.deps.sendCommand).mock.calls.filter(([command]) => command.type === 'TURN'),
      ).toHaveLength(1);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('releases stale motion and falls back even when the Worker stops emitting entirely', async () => {
    const keys = new Map<string, (event: KeyboardEvent) => void>();
    const base = harness({
      keyboardTarget: {
        addEventListener: (type, listener) => {
          keys.set(type, listener);
        },
        removeEventListener: (type) => {
          keys.delete(type);
        },
      },
    });
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      base.runtime.setContext({
        matchId: 'm',
        selfPlayerId: 'self',
        phase: 'PLAYING',
        role: 'runner',
        status: 'ACTIVE',
        mode: 'motion',
        pageActive: true,
      });
      base.emit(1);
      base.advance(1600);
      base.fireTimers();
      expect(base.deps.onInteractionState).toHaveBeenCalledWith({
        mode: 'keyboard',
        selectedEquipment: 'sensor',
      });
      expect(base.statuses.at(-1)?.errorCode).toBe('INFERENCE_STALLED');
      expect(base.statuses.at(-1)?.vision).toBe('failed');
      const event = {
        code: 'KeyW',
        repeat: false,
        isComposing: false,
        target: null,
        preventDefault() {},
      } as KeyboardEvent;
      keys.get('keydown')!(event);
      const moves = () =>
        vi
          .mocked(base.deps.sendCommand)
          .mock.calls.filter(([command]) => command.type === 'MOVE_INTENT')
          .map(([command]) => command.payload);
      // 폴백 뒤의 키도 모션과 같은 유지 시간을 채워야 의도가 된다(S15P21C204-265).
      base.advance(INPUT_TUNING.forwardHoldMs - 20);
      base.fireTimers();
      expect(moves()).toEqual([]);
      base.advance(20);
      base.fireTimers();
      expect(moves()).toEqual([{ direction: 'forward' }]);
      // S15P21C204-281. 첫 의도는 한 칸이라 곧 해제되고, 계속 누르고 있으면 연속으로 올라간다.
      base.advance(MOVE_REFRESH_MS);
      base.fireTimers();
      expect(moves().at(-1)).toEqual({ direction: null });
      base.advance(INPUT_TUNING.holdToContinuousMs);
      base.fireTimers();
      expect(moves().at(-1)).toEqual({ direction: 'forward' });
    } finally {
      await base.runtime.dispose();
    }
  });

  it('does not move on a keyboard press while the motion mode is active', async () => {
    const keys = new Map<string, (event: KeyboardEvent) => void>();
    const base = harness({
      keyboardTarget: {
        addEventListener: (type, listener) => {
          keys.set(type, listener);
        },
        removeEventListener: (type) => {
          keys.delete(type);
        },
      },
    });
    try {
      await base.runtime.startDevices({ microphone: false });
      base.ready();
      base.runtime.setContext({
        matchId: 'm',
        selfPlayerId: 'self',
        phase: 'PLAYING',
        role: 'runner',
        status: 'ACTIVE',
        mode: 'motion',
        pageActive: true,
      });
      const press = (code: string, type = 'keydown') =>
        keys.get(type)!({
          code,
          repeat: false,
          isComposing: false,
          target: null,
          preventDefault() {},
        } as KeyboardEvent);
      // 모션 모드는 웹캠으로만 움직인다: 이동 키도 회전 키도 명령을 만들지 않는다.
      press('KeyW');
      press('KeyA');
      base.advance(INPUT_TUNING.backHoldMs + INPUT_TUNING.turnHoldMs);
      base.fireTimers();
      base.advance(100);
      base.fireTimers();
      press('KeyW', 'keyup');
      press('KeyA', 'keyup');
      const game = vi
        .mocked(base.deps.sendCommand)
        .mock.calls.filter(
          ([command]) => command.type === 'MOVE_INTENT' || command.type === 'TURN',
        );
      expect(game).toEqual([]);
    } finally {
      await base.runtime.dispose();
    }
  });

  it('ignores repeated action keys and installs the equipment selected by the screen', async () => {
    const listeners = new Map<string, (event: KeyboardEvent) => void>();
    const base = harness({
      keyboardTarget: {
        addEventListener: (name, listener) => {
          listeners.set(name, listener);
        },
        removeEventListener: (name) => {
          listeners.delete(name);
        },
      },
    });
    const context = {
      matchId: 'm',
      selfPlayerId: 'self',
      role: 'tagger',
      phase: 'PLAYING',
      status: 'ACTIVE',
      mode: 'keyboard',
      pageActive: true,
      selectedEquipment: 'trap',
    } as const;
    const key = (code: string, repeat = false, type = 'keydown') =>
      listeners.get(type)?.({
        code,
        repeat,
        isComposing: false,
        target: null,
        preventDefault() {},
      } as KeyboardEvent);
    try {
      base.runtime.setContext(context);
      key('KeyF');
      base.runtime.setContext({ ...context, installationId: 'installed' });
      base.advance(250);
      key('KeyF', true);
      expect(base.deps.sendCommand).toHaveBeenCalledExactlyOnceWith({
        type: 'INSTALL',
        payload: { kind: 'trap' },
      });
      key('KeyF', false, 'keyup');
      key('KeyF');
      expect(base.deps.sendCommand).toHaveBeenLastCalledWith({
        type: 'INSTALL_CANCEL',
        payload: { installationId: 'installed' },
      });
      key('KeyG');
      expect(base.deps.sendCommand).toHaveBeenLastCalledWith({ type: 'GRAB_INTENT', payload: {} });
      key('KeyG', true);
      expect(
        vi
          .mocked(base.deps.sendCommand)
          .mock.calls.filter(([command]) => command.type === 'GRAB_INTENT'),
      ).toHaveLength(1);
      key('Digit1', true);
      expect(base.deps.onInteractionState).not.toHaveBeenCalledWith({
        mode: 'keyboard',
        selectedEquipment: 'sensor',
      });
      key('Digit1');
      expect(base.deps.onInteractionState).toHaveBeenLastCalledWith({
        mode: 'keyboard',
        selectedEquipment: 'sensor',
      });
    } finally {
      await base.runtime.dispose();
    }
  });

  it('assigns real effect buffers in the browser adapter and reuses PCM without reusing sources', async () => {
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const source = () => ({
      ...node(),
      buffer: null as AudioBuffer | null,
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    });
    const sources: ReturnType<typeof source>[] = [];
    const buffers: AudioBuffer[] = [];
    const contexts: AudioContextProbe[] = [];
    class AudioContextProbe {
      state = 'suspended';
      constructor() {
        contexts.push(this);
      }
      resume = vi.fn(async () => {
        if (this.resume.mock.calls.length === 1) throw Error('first unlock failed');
        this.state = 'running';
      });
      close = vi.fn(async () => {
        this.state = 'closed';
      });
      sampleRate = 48000;
      destination = node();
      createGain() {
        return { ...node(), gain: { value: 1 } };
      }
      createBiquadFilter() {
        return { ...node(), frequency: { value: 20000 }, type: '' };
      }
      createStereoPanner() {
        return { ...node(), pan: { value: 0 } };
      }
      createBufferSource() {
        const value = source();
        sources.push(value);
        return value;
      }
      createBuffer(_channels: number, length: number, sampleRate: number) {
        const data = new Float32Array(length);
        const buffer = { sampleRate, length, getChannelData: () => data } as unknown as AudioBuffer;
        buffers.push(buffer);
        return buffer;
      }
    }
    vi.stubGlobal('AudioContext', AudioContextProbe);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => stream(videoTrack()),
        addEventListener() {},
        removeEventListener() {},
      },
    });
    vi.stubGlobal('document', {
      createElement: () => ({
        srcObject: null,
        play: async () => {},
        pause() {},
      }),
    });
    const { runtime } = harness({
      environment: undefined,
      epochNowSeconds: () => 1000,
      createMediaRoom: () => ({
        connect: async () => {},
        disconnect: async () => {},
        on: () => {},
        removeAllListeners: () => {},
      }),
    });
    const scope = { matchId: 'm', mediaInstanceId: 'media', receiverGeneration: 1 };
    try {
      runtime.setAudioOutputLock('open');
      expect(contexts).toHaveLength(0);
      expect((await runtime.startDevices({ microphone: false })).audioPlayback).toBe('failed');
      expect((await runtime.startDevices({ microphone: false })).audioPlayback).toBe('ready');
      expect(contexts).toHaveLength(1);
      runtime.setContext({
        matchId: 'm',
        selfPlayerId: 'self',
        phase: 'PLAYING',
        role: 'runner',
        status: 'ACTIVE',
        mode: 'keyboard',
        pageActive: true,
      });
      await runtime.connectMedia({
        ...scope,
        url: 'wss://synthetic.invalid',
        token: 'synthetic',
        roomName: 'synthetic',
        mediaIdentity: 'self',
        expiresAt: 2000,
      });
      runtime.applyMediaBindings({
        ...scope,
        bindingRevision: 1,
        participants: [
          {
            playerId: 'self',
            publisherGeneration: 1,
            mediaIdentity: 'self',
            participantSid: 'PA_self',
            faceTrackSid: 'TR_face',
          },
        ],
      });
      const policy = {
        ...scope,
        policyRevision: 1,
        bindingRevision: 1,
        stateVersion: 1,
        voices: [],
        effects: (['footstep', 'sensor', 'trap'] as const).map((kind) => ({
          eventId: kind,
          kind,
          gain: 1,
          azimuthRad: 0,
          lowpassHz: 10000,
          tick: 1,
        })),
      };
      runtime.applyAudioPolicy(policy);
      runtime.applyAudioPolicy({ ...policy, policyRevision: 2 });
      expect(sources).toHaveLength(3);
      expect(buffers).toHaveLength(3);
      for (const item of sources) {
        expect(item.start).toHaveBeenCalledOnce();
        expect(item.buffer!.getChannelData(0).some((sample) => Math.abs(sample) > 0.05)).toBe(true);
        item.onended!();
        expect(item.disconnect).toHaveBeenCalledOnce();
      }
      runtime.applyAudioPolicy({
        ...policy,
        policyRevision: 3,
        effects: [{ ...policy.effects[0]!, eventId: 'footstep-2' }],
      });
      expect(sources).toHaveLength(4);
      expect(buffers).toHaveLength(3);
      expect(sources[3]!.buffer).toBe(sources[0]!.buffer);
      await runtime.retireMediaGeneration('phase-change');
      expect(contexts[0]!.close).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
      vi.unstubAllGlobals();
    }
    expect(sources[0]!.stop).not.toHaveBeenCalled();
    expect(sources[3]!.stop).toHaveBeenCalledOnce();
    expect(sources[3]!.disconnect).toHaveBeenCalledOnce();
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(2);
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
  });

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

    // 아직 유효 얼굴 표본도 가공 프레임도 없으므로 loading에 머문다.
    expect(base.statuses.map((status) => status.vision)).not.toContain('ready');
  });

  it('reports vision ready once the face, the safe frame and the track all exist', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();

    base.emit(1);

    expect(base.statuses.at(-1)!.vision).toBe('ready');
    expect(base.sensors).toHaveLength(1);
  });

  it('drops back from ready when the processed track is no longer live', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();
    base.emit(1);
    expect(base.statuses.at(-1)!.vision).toBe('ready');

    base.processedTrack.readyState = 'ended';
    base.advance(40);
    base.emit(2);

    expect(base.statuses.at(-1)!.vision).toBe('loading');
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

  it('validates the grant and ignores a malformed bindings or policy message', async () => {
    const base = harness();

    // D-13 이후 connectMedia는 grant 검사로 거절한다.
    await expect(base.runtime.connectMedia({} as never)).rejects.toMatchObject({
      code: 'GRANT_INCOMPLETE',
    });
    // D-15 이후 applyMediaBindings는 모양 검사로 조용히 무시한다.
    expect(() => base.runtime.applyMediaBindings({} as never)).not.toThrow();
    // D-16 이후 applyAudioPolicy도 모양 검사로 조용히 무시한다.
    expect(() => base.runtime.applyAudioPolicy({} as never)).not.toThrow();
  });
});

describe('remote media limits and pending sweep', () => {
  const playing = {
    matchId: 'match-1',
    selfPlayerId: 'p1',
    role: 'runner' as const,
    phase: 'PLAYING' as const,
    status: 'ACTIVE' as const,
    mode: 'motion' as const,
    pageActive: true,
  };

  it('uses the practice limit while the authoritative phase is TEAM_PRACTICE', async () => {
    const base = harness({
      createMediaRoom: () => ({
        connect: async () => {},
        disconnect: async () => {},
        on: () => {},
        removeAllListeners: () => {},
      }),
      epochNowSeconds: () => 1000,
    });
    await base.runtime.startDevices({ microphone: false });

    base.runtime.setContext({ ...playing, phase: 'TEAM_PRACTICE' });
    await base.runtime.connectMedia({
      matchId: 'match-1',
      mediaInstanceId: 'instance-1',
      receiverGeneration: 1,
      url: 'wss://local.invalid',
      token: 'fixture',
      roomName: 'room',
      mediaIdentity: 'self',
      expiresAt: 1300,
    });
    const practiceBindings = {
      matchId: 'match-1',
      mediaInstanceId: 'instance-1',
      receiverGeneration: 1,
      bindingRevision: 1,
      participants: [2, 3, 4].map((index) => ({
        playerId: `p${index}`,
        publisherGeneration: 1,
        mediaIdentity: `id-${index}`,
        participantSid: `PA_${index}`,
        faceTrackSid: `TR_face_${index}`,
      })),
    };
    for (const index of [2, 3, 4])
      base.runtime.addRemoteTrack({
        trackSid: `TR_face_${index}`,
        kind: 'video',
        participantSid: `PA_${index}`,
        attach: () => undefined,
        detach: () => undefined,
      });
    base.runtime.applyMediaBindings(practiceBindings);

    // 연습은 같은 인스턴스 2명까지만 받는다.
    expect(base.faceTracks.filter((event) => event.element !== null)).toHaveLength(2);
  });

  it('sweeps the pending hold on a timer even when no binding ever arrives', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.runtime.setContext(playing);

    base.runtime.addRemoteTrack({
      trackSid: 'TR_unknown',
      kind: 'video',
      participantSid: 'PA_9',
      attach: () => undefined,
      detach: () => undefined,
    });
    expect(base.refreshRequests).toHaveLength(0);

    base.advance(2001);
    base.fireTimers();

    // 바인딩이 한 번도 오지 않아도 만료 청소와 refresh가 일어난다.
    expect(base.unsubscribed.map((track) => track.trackSid)).toContain('TR_unknown');
  });
});

describe('media generation and participation lifecycle', () => {
  it('keeps the original camera and the vision pipeline on a plain generation retire', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();
    base.emit(1);
    expect(base.statuses.at(-1)!.camera).toBe('ready');

    await base.runtime.retireMediaGeneration();

    // playerId·게임 Room·원본 카메라는 이 경로에서 닫히지 않는다.
    expect(base.track.stop).not.toHaveBeenCalled();
    expect(base.previews.at(-1)).not.toBeNull();
    expect(base.runtime.getGenerationState()).toBe('closed');
  });

  it('closes the devices and the worker only on endParticipation', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();

    await base.runtime.endParticipation();

    expect(base.track.stop).toHaveBeenCalledTimes(1);
    expect(base.previews.at(-1)).toBeNull();
  });

  it('cleans up once for a concurrent retire, personal end and dispose', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();

    await Promise.all([
      base.runtime.retireMediaGeneration('connection-lost'),
      base.runtime.endParticipation(),
      base.runtime.dispose(),
    ]);

    expect(base.track.stop).toHaveBeenCalledTimes(1);
    expect(base.processedTrack.stop).toHaveBeenCalledTimes(1);
  });

  it('lets a late binding or policy no longer reopen the retired generation', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();
    await base.runtime.retireMediaGeneration('round-ended');

    // 늦은 사건은 현재 세대를 다시 열지 못한다.
    expect(() => base.runtime.applyMediaBindings({} as never)).not.toThrow();
    expect(() => base.runtime.applyAudioPolicy({} as never)).not.toThrow();
    expect(await base.runtime.publishMedia()).toBeNull();
    expect(base.runtime.getGenerationState()).toBe('closed');
  });

  it('opens a new generation only through beginMediaGeneration', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    await base.runtime.retireMediaGeneration();
    expect(base.runtime.getGenerationState()).toBe('closed');

    base.runtime.beginMediaGeneration();

    expect(base.runtime.getGenerationState()).toBe('live');
  });

  it('keeps the game and the media generation when only the camera fails', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();

    base.track.end();

    // 카메라 장애는 참가 종료가 아니다.
    expect(base.runtime.getGenerationState()).toBe('live');
    expect(base.statuses.at(-1)).toMatchObject({ camera: 'failed', vision: 'idle' });
  });

  it('refuses every operation after dispose', async () => {
    const base = harness();
    await base.runtime.startDevices({ microphone: false });
    await base.runtime.dispose();
    await base.runtime.dispose();

    base.runtime.beginMediaGeneration();
    expect(base.runtime.getGenerationState()).not.toBe('live');
    expect(base.track.stop).toHaveBeenCalledTimes(1);
  });
});

describe('제품 경로의 livekit SDK 어댑터', () => {
  const NOW_SECONDS = 1_800_000_000;
  const playing = {
    matchId: 'match-1',
    selfPlayerId: 'p1',
    role: 'runner' as const,
    phase: 'PLAYING' as const,
    status: 'ACTIVE' as const,
    mode: 'motion' as const,
    pageActive: true,
  };
  const grant = {
    matchId: 'match-1',
    mediaInstanceId: 'instance-1',
    receiverGeneration: 1,
    url: 'wss://media.example',
    token: 'grant-token',
    roomName: 'room-1',
    mediaIdentity: 'identity-p1-g1',
    expiresAt: NOW_SECONDS + 600,
  };

  /** 실제 SDK 대신 같은 모양의 모듈을 준다. Node 시험은 livekit-client를 적재하지 않는다. */
  function fakeSdk() {
    const rooms: {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      emit: (event: string, ...args: unknown[]) => void;
      publishTrack: ReturnType<typeof vi.fn>;
    }[] = [];
    const Room = function Room() {
      const listeners = new Map<string, ((...args: never[]) => void)[]>();
      const publishTrack = vi.fn(async () => ({ trackSid: 'local-face' }));
      const room = {
        localParticipant: { publishTrack, unpublishTrack: vi.fn(async () => undefined) },
        connect: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => undefined),
        on: (event: string, listener: (...args: never[]) => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        },
        removeAllListeners: () => listeners.clear(),
        emit: (event: string, ...args: unknown[]) => {
          for (const listener of [...(listeners.get(event) ?? [])])
            (listener as (...rest: unknown[]) => void)(...args);
        },
        publishTrack,
      };
      rooms.push(room);
      return room;
    };
    const load = vi.fn(async () => ({
      Room: Room as never,
      Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
    }));
    return { rooms, load };
  }

  function sdkHarness(extra: Partial<InteractionRuntimeOptions> = {}) {
    const sdk = fakeSdk();
    const base = harness({
      loadLiveKit: sdk.load,
      unsubscribeTrack: undefined,
      epochNowSeconds: () => NOW_SECONDS,
      ...extra,
    });
    return { ...base, sdk };
  }

  it('createMediaRoom 주입이 없으면 SDK를 적재해 실제 Room으로 연결한다', async () => {
    const base = sdkHarness();
    await base.runtime.startDevices({ microphone: false });
    base.runtime.setContext(playing);

    await base.runtime.connectMedia(grant);

    expect(base.sdk.load).toHaveBeenCalledTimes(1);
    expect(base.sdk.rooms).toHaveLength(1);
    expect(base.sdk.rooms[0]?.connect).toHaveBeenCalledWith(grant.url, grant.token, {
      autoSubscribe: false,
    });
  });

  it('does not finish runtime retirement until a pending SDK publish is compensated', async () => {
    const base = sdkHarness();
    await base.runtime.startDevices({ microphone: false });
    base.runtime.setContext(playing);
    await base.runtime.connectMedia(grant);
    let finish!: (value: { trackSid: string }) => void;
    base.sdk.rooms[0]!.publishTrack.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const publishing = base.runtime.publishMedia();
    const rejected = expect(publishing).rejects.toMatchObject({ code: 'RETIRED' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const retiring = base.runtime.retireMediaGeneration();
    expect(base.runtime.getGenerationState()).toBe('terminal');
    expect(base.sdk.rooms[0]!.disconnect).not.toHaveBeenCalled();
    finish({ trackSid: 'late-face' });
    await rejected;
    await retiring;
    expect(base.runtime.getGenerationState()).toBe('closed');
    expect(base.runtime.getPublications()).toEqual([]);
    expect(base.sdk.rooms[0]!.disconnect).toHaveBeenCalledOnce();
    expect(base.track.stop).not.toHaveBeenCalled();
    await base.runtime.dispose();
  });

  it('createMediaRoom 주입이 있으면 SDK를 적재하지 않는다', async () => {
    const injected = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    const base = sdkHarness({ createMediaRoom: () => injected });
    await base.runtime.startDevices({ microphone: false });
    base.runtime.setContext(playing);

    await base.runtime.connectMedia(grant);

    expect(base.sdk.load).not.toHaveBeenCalled();
    expect(injected.connect).toHaveBeenCalledTimes(1);
  });

  it('세대마다 SDK를 다시 적재하지 않는다', async () => {
    const base = sdkHarness();
    await base.runtime.startDevices({ microphone: false });
    base.runtime.setContext(playing);
    await base.runtime.connectMedia(grant);

    await base.runtime.retireMediaGeneration();
    base.runtime.beginMediaGeneration();
    await base.runtime.connectMedia({ ...grant, receiverGeneration: 2 });

    expect(base.sdk.load).toHaveBeenCalledTimes(1);
    expect(base.sdk.rooms).toHaveLength(2);
  });

  it('SDK TrackSubscribed는 검증 전이라 attach하지 않고 보류로만 들어간다', async () => {
    const base = sdkHarness();
    await base.runtime.startDevices({ microphone: false });
    base.runtime.setContext(playing);
    await base.runtime.connectMedia(grant);

    base.sdk.rooms[0]?.emit(
      'trackSubscribed',
      { kind: 'video', mediaStreamTrack: {}, attach: vi.fn(), detach: vi.fn() },
      { trackSid: 'face-2', setSubscribed: vi.fn() },
      { sid: 'sid-p2' },
    );

    // 검증 바인딩이 없으므로 얼굴을 넘기지 않는다. 보류만 잡는다.
    expect(base.faceTracks).toHaveLength(0);

    base.advance(2_001);
    base.fireTimers();

    // 승인 grant의 scope로 초기 검증 목록을 요청한다. 미확인 트랙은 표시하지 않는다.
    expect(base.faceTracks).toHaveLength(0);
    expect(base.refreshRequests).toEqual([
      {
        matchId: 'match-1',
        mediaInstanceId: 'instance-1',
        receiverGeneration: 1,
        lastBindingRevision: 0,
      },
    ]);
  });

  it('구독 해제 주입이 없으면 SDK publication의 구독을 실제로 멈춘다', async () => {
    const base = sdkHarness();
    await base.runtime.startDevices({ microphone: false });
    base.runtime.setContext(playing);
    await base.runtime.connectMedia(grant);
    const setSubscribed = vi.fn();
    base.sdk.rooms[0]?.emit(
      'trackSubscribed',
      { kind: 'video', mediaStreamTrack: {}, attach: vi.fn(), detach: vi.fn() },
      { trackSid: 'face-intruder', setSubscribed },
      { sid: 'sid-intruder' },
    );

    // 검증 목록에 없는 참가자다. 보류가 만료되면 구독을 멈추고 목록 재전송을 요청한다.
    base.runtime.applyMediaBindings({
      matchId: 'match-1',
      mediaInstanceId: 'instance-1',
      receiverGeneration: 1,
      bindingRevision: 7,
      participants: [],
    });
    base.advance(2_001);
    base.fireTimers();

    expect(setSubscribed).toHaveBeenCalledWith(false);
    expect(base.refreshRequests).toContainEqual(
      expect.objectContaining({ lastBindingRevision: 7 }),
    );
  });

  it('getPublisher 주입이 없으면 현재 Room의 LocalParticipant로 게시한다', async () => {
    const base = sdkHarness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();
    base.emit(1);
    base.runtime.setContext(playing);
    await base.runtime.connectMedia(grant);

    const faceSid = await base.runtime.publishMedia();

    expect(faceSid).toBe('local-face');
    expect(base.sdk.rooms[0]?.publishTrack).toHaveBeenCalledWith(base.processedTrack, {
      source: 'camera',
      simulcast: false,
      videoEncoding: { maxBitrate: 100_000, maxFramerate: 10 },
    });
  });

  it('세대 회수는 Room을 stopTracks=false로 끊어 원본 카메라를 살려 둔다', async () => {
    const base = sdkHarness();
    await base.runtime.startDevices({ microphone: false });
    base.ready();
    base.runtime.setContext(playing);
    await base.runtime.connectMedia(grant);

    await base.runtime.retireMediaGeneration();

    expect(base.sdk.rooms[0]?.disconnect).toHaveBeenCalledWith(false);
    expect(base.track.stop).not.toHaveBeenCalled();
  });
});

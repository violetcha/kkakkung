// D-02 / IN-02. 진행 중 프레임 한 개만 유지하는 Worker 스케줄러와 Sample 누적.
// 대기 배열을 만들지 않고, 구 generation 결과와 종료 후 응답을 폐기한다.
import type { Sample, SensorSnapshot } from './sensor-types';
import type {
  FrameOutcomes,
  ModelOutcome,
  VisionModelKind,
  WorkerRequest,
  WorkerResponse,
} from './worker-protocol';
import { isWorkerResponse } from './worker-protocol';

export interface WorkerPort {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  set onmessage(handler: ((event: { data: unknown }) => void) | null);
  set onerror(handler: ((event: unknown) => void) | null);
}

export type SchedulerDeps = Readonly<{
  worker: WorkerPort;
  /** 메인 스레드 performance 시계. */
  now(): number;
  onSnapshot(snapshot: SensorSnapshot): void;
  onError(code: string): void;
  onReady?(loaded: readonly VisionModelKind[]): void;
}>;

export type FrameSubmission = Readonly<{
  frameId: number;
  sampledAtMs: number;
  bitmap: ImageBitmap;
  models: readonly VisionModelKind[];
}>;

export interface WorkerScheduler {
  /** 실제로 Worker에 보냈으면 true. inFlight면 프레임을 버리고 false를 돌려준다. */
  submit(frame: FrameSubmission): boolean;
  handleMessage(data: unknown): void;
  handleWorkerError(): void;
  getSnapshot(): SensorSnapshot;
  readonly inFlight: boolean;
  readonly droppedFrames: number;
  dispose(): void;
}

type MutableSnapshot = {
  face: SensorSnapshot['face'];
  pose: SensorSnapshot['pose'];
  gesture: SensorSnapshot['gesture'];
};

function closeBitmap(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
    // 이미 닫힌 bitmap은 무시한다.
  }
}

export function createWorkerScheduler(
  deps: SchedulerDeps,
  runtimeGeneration: number,
): WorkerScheduler {
  const samples: MutableSnapshot = { face: null, pose: null, gesture: null };
  let inFlight = false;
  let droppedFrames = 0;
  let disposed = false;
  let errorReported = false;

  const snapshot = (emittedAtMs: number): SensorSnapshot => ({
    runtimeGeneration,
    emittedAtMs,
    face: samples.face,
    pose: samples.pose,
    gesture: samples.gesture,
  });

  const toSample = <T>(
    base: Readonly<{ frameId: number; sampledAtMs: number; receivedAtMs: number }>,
    outcome: ModelOutcome<T>,
  ): Sample<T> =>
    outcome.status === 'valid'
      ? { ...base, status: 'valid', data: outcome.data }
      : { ...base, status: 'missing', data: null };

  const applyOutcomes = (frameId: number, sampledAtMs: number, outcomes: FrameOutcomes) => {
    const receivedAtMs = deps.now();
    const base = { frameId, sampledAtMs, receivedAtMs };
    // 실행하지 않은 모델의 Sample은 건드리지 않는다. 캐시를 새 관측으로 포장하지 않는다.
    if (outcomes.face) samples.face = toSample(base, outcomes.face);
    if (outcomes.pose) samples.pose = toSample(base, outcomes.pose);
    if (outcomes.gesture) samples.gesture = toSample(base, outcomes.gesture);
    deps.onSnapshot(snapshot(receivedAtMs));
  };

  return {
    submit(frame) {
      if (disposed) {
        closeBitmap(frame.bitmap);
        return false;
      }
      if (inFlight) {
        // 대기 배열을 만들지 않고 최신 프레임 이전 것을 즉시 버린다.
        droppedFrames += 1;
        closeBitmap(frame.bitmap);
        return false;
      }
      inFlight = true;
      try {
        deps.worker.postMessage(
          {
            type: 'frame',
            runtimeGeneration,
            frameId: frame.frameId,
            sampledAtMs: frame.sampledAtMs,
            models: frame.models,
            bitmap: frame.bitmap,
          },
          [frame.bitmap],
        );
      } catch {
        inFlight = false;
        closeBitmap(frame.bitmap);
        deps.onError('FRAME_POST_FAILED');
        return false;
      }
      return true;
    },

    handleMessage(data) {
      if (disposed) return;
      if (!isWorkerResponse(data)) {
        deps.onError('PROTOCOL_ERROR');
        return;
      }
      const message: WorkerResponse = data;
      // 구 세대 결과는 센서에 적용하지 않는다.
      if (message.runtimeGeneration !== runtimeGeneration) return;
      switch (message.type) {
        case 'ready':
          deps.onReady?.(message.loaded);
          return;
        case 'result':
          inFlight = false;
          applyOutcomes(message.frameId, message.sampledAtMs, message.outcomes);
          return;
        case 'error':
          inFlight = false;
          if (!errorReported) {
            errorReported = true;
            deps.onError(message.code);
          }
          return;
        default:
          return;
      }
    },

    handleWorkerError() {
      if (disposed) return;
      inFlight = false;
      if (errorReported) return;
      errorReported = true;
      deps.onError('WORKER_ERROR');
    },

    getSnapshot: () => snapshot(deps.now()),

    get inFlight() {
      return inFlight;
    },
    get droppedFrames() {
      return droppedFrames;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      inFlight = false;
      try {
        deps.worker.postMessage({ type: 'close' });
      } catch {
        // 이미 종료된 Worker는 무시한다.
      }
      deps.worker.terminate();
    },
  };
}

/**
 * 제품 Worker 생성. Vite가 이 URL 패턴으로 vision.worker.ts를 별도 번들로 만든다.
 * Node 시험에서는 호출하지 않고 WorkerPort를 주입한다.
 */
export function createVisionWorker(): Worker {
  return new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
}

/** 실제 Worker를 WorkerPort로 감싸고 scheduler의 handler를 연결한다. */
export function attachWorker(worker: Worker, scheduler: WorkerScheduler): WorkerPort {
  worker.onmessage = (event: MessageEvent<unknown>) => scheduler.handleMessage(event.data);
  worker.onerror = () => scheduler.handleWorkerError();
  return worker as unknown as WorkerPort;
}

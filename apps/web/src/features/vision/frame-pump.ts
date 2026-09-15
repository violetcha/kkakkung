// D-02 / IN-02. 원본 video에서 최신 프레임 한 개만 뽑아 스케줄러에 넘긴다.
// requestVideoFrameCallback을 우선 쓰고 없으면 확인된 대체 스케줄러를 쓴다.
import type { VisionModelKind } from './worker-protocol';

export type FrameSource = Readonly<{
  /** requestVideoFrameCallback 상당. 취소 함수를 돌려준다. */
  schedule(callback: () => void): () => void;
  /** 현재 표시 프레임의 ImageBitmap. 없으면 null이다. */
  grab(): Promise<ImageBitmap | null>;
  now(): number;
}>;

export type FramePumpDeps = Readonly<{
  source: FrameSource;
  /** true를 돌려주면 실제 전송된 것으로 보고 frameId를 증가시킨다. */
  submit(frame: {
    frameId: number;
    sampledAtMs: number;
    bitmap: ImageBitmap;
    models: readonly VisionModelKind[];
  }): boolean;
  /** 이 프레임에서 실행할 모델을 고른다. 빈 목록이면 전송하지 않는다. */
  selectModels(nowMs: number): readonly VisionModelKind[];
  onError?(code: string): void;
}>;

export interface FramePump {
  start(): void;
  stop(): void;
  readonly running: boolean;
  readonly frameId: number;
}

function closeBitmap(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
    // 무시한다.
  }
}

export function createFramePump(deps: FramePumpDeps): FramePump {
  let running = false;
  let cancel: (() => void) | null = null;
  let frameId = 0;
  let grabbing = false;

  const tick = () => {
    if (!running) return;
    cancel = deps.source.schedule(tick);
    if (grabbing) return;
    // sampledAtMs는 프레임을 관측한 메인 스레드 monotonic 시각이다.
    const sampledAtMs = deps.source.now();
    const models = deps.selectModels(sampledAtMs);
    if (models.length === 0) return;
    grabbing = true;
    void deps.source
      .grab()
      .then((bitmap) => {
        grabbing = false;
        if (!bitmap) return;
        if (!running) {
          closeBitmap(bitmap);
          return;
        }
        const nextId = frameId + 1;
        const sent = deps.submit({ frameId: nextId, sampledAtMs, bitmap, models });
        // submit이 false여도 bitmap 정리는 스케줄러가 끝냈다.
        if (sent) frameId = nextId;
      })
      .catch(() => {
        grabbing = false;
        deps.onError?.('FRAME_GRAB_FAILED');
      });
  };

  return {
    start() {
      if (running) return;
      running = true;
      cancel = deps.source.schedule(tick);
    },
    stop() {
      if (!running) return;
      running = false;
      cancel?.();
      cancel = null;
    },
    get running() {
      return running;
    },
    get frameId() {
      return frameId;
    },
  };
}

/**
 * 모델별 목표 주기 스케줄. 실측 fps는 별도 계측이며 이 값은 목표 상한이다.
 *
 * **이 값은 아직 실측으로 확정되지 않았다.** 초기 계획은 pose 10fps · gesture 8fps였고,
 * 여기 코드와 `docs/spec/current.md`는 pose 15fps · gesture 10fps다. 어느 쪽이 맞는지는
 * 대표 장치에서 세 모델을 동시에 돌려 봐야 정해진다(S15P21C204-243).
 *
 * 그때까지는 현재 코드 값을 유지한다. 실측 없이 계획값으로 되돌리는 것도 근거가 없기
 * 때문이다. 값을 바꿀 때는 반드시 아래 tuningVersion을 함께 올린다.
 */
export const MODEL_TARGET_FPS: Readonly<Record<VisionModelKind, number>> = Object.freeze({
  face: 15,
  pose: 15,
  gesture: 10,
});

/**
 * 목표 주기의 튜닝 버전. `input-tuning.SENSOR_TUNING_VERSION`과 같은 방식으로
 * 검사에 걸리게 한다. 이 상수는 원래 버전이 없어 어떤 검사도 값 변경을 잡지 못했다.
 *
 * 접미사 `-unmeasured`는 실측 근거가 아직 없다는 표시다. 대표 장치 측정으로 값을 확정하면
 * `D-model-interval-2` 처럼 접미사 없는 버전으로 올리고 측정 근거를 함께 기록한다.
 */
export const MODEL_TARGET_TUNING_VERSION = 'D-model-interval-1-unmeasured';

export const MODEL_TARGET_INTERVAL_MS: Readonly<Record<VisionModelKind, number>> = Object.freeze({
  face: 1000 / MODEL_TARGET_FPS.face,
  pose: 1000 / MODEL_TARGET_FPS.pose,
  gesture: 1000 / MODEL_TARGET_FPS.gesture,
});

export type ModelSelector = Readonly<{
  select(nowMs: number): readonly VisionModelKind[];
  markSent(nowMs: number, models: readonly VisionModelKind[]): void;
  setEnabled(kind: VisionModelKind, enabled: boolean): void;
}>;

export function createModelSelector(
  enabled: readonly VisionModelKind[] = ['face', 'pose', 'gesture'],
): ModelSelector {
  const active = new Set<VisionModelKind>(enabled);
  const lastSentAt = new Map<VisionModelKind, number>();
  return {
    select(nowMs) {
      const due: VisionModelKind[] = [];
      for (const kind of ['face', 'pose', 'gesture'] as const) {
        if (!active.has(kind)) continue;
        const last = lastSentAt.get(kind);
        if (last === undefined || nowMs - last >= MODEL_TARGET_INTERVAL_MS[kind]) due.push(kind);
      }
      return due;
    },
    markSent(nowMs, models) {
      for (const kind of models) lastSentAt.set(kind, nowMs);
    },
    setEnabled(kind, value) {
      if (value) active.add(kind);
      else {
        active.delete(kind);
        lastSentAt.delete(kind);
      }
    },
  };
}

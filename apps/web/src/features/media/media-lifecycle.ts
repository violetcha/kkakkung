// D-17 / ME-07. 미디어 세대 종료와 논리 참가 종료를 분리한다.
// 로컬 closed와 서버 회수 성공은 다른 사실이다. 로컬 SDK disconnect로 원격 완료를 보증하지 않는다.
// retireMediaGeneration 자체는 게임 지식 삭제 신호가 아니다.

/** 게임 생존 중에만 허용하는 SDK 순간 복구 창. 서버 10초 창을 따른다. */
export const RECOVERY_WINDOW_MS = 10_000;

export type GenerationState =
  /** 이 세대로 게시·구독·복구를 할 수 있다. */
  | 'live'
  /** 회수 중. 새 게시·구독·복구를 모두 막는다. */
  | 'terminal'
  /** 로컬 정리가 끝났다. 서버 회수 확인과는 별개다. */
  | 'closed';

export type RetireReason =
  | 'phase-change'
  | 'personal-ended'
  | 'connection-lost'
  | 'policy-unknown'
  | 'round-ended'
  | 'reconnect'
  | 'shutdown';

/** 서버가 정책을 확신하지 못하면 10초 복구 창을 기다리지 않는다. */
export function allowsRecoveryWindow(reason: RetireReason): boolean {
  return reason !== 'policy-unknown' && reason !== 'personal-ended' && reason !== 'shutdown';
}

export type LifecycleSteps = Readonly<{
  /** 출력을 즉시 닫는다. */
  closeOutput(): void;
  /** listener·재연결 타이머를 끊는다. */
  stopListeners(): void;
  /** 게시 트랙을 회수한다. 원본 장치 track은 닫지 않는다. */
  unpublishAll(): Promise<void>;
  /** 수신 video/track/graph를 정리한다. */
  releaseRemote(): void;
  /** SDK disconnect. 로컬 closed일 뿐이다. */
  disconnect(): Promise<void>;
}>;

export type ParticipationSteps = Readonly<{
  /** 입력 timer/listener를 끊는다. */
  stopInput(): void;
  /** Worker와 모델을 닫는다. */
  stopVision(): void;
  /** 원본 카메라·마이크를 닫는다. */
  stopDevices(): Promise<void>;
}>;

export type MediaLifecycleDeps = Readonly<{
  media: LifecycleSteps;
  participation: ParticipationSteps;
  now(): number;
  onStateChange?(state: GenerationState): void;
}>;

export interface MediaLifecycle {
  /**
   * 미디어 세대만 종료한다. playerId·게임 Room·원본 카메라와 센서는 유지한다.
   * 동시 호출은 공유 Promise 하나로 합쳐 한 번만 정리한다.
   */
  retireGeneration(reason: RetireReason): Promise<void>;
  /** 논리 참가 종료. 입력·Worker·원본 장치까지 닫는다. 게임 Room 수명은 C가 정한다. */
  endParticipation(): Promise<void>;
  /** 객체 재사용 금지. endParticipation과 달리 새 라운드 startDevices를 허용하지 않는다. */
  dispose(): Promise<void>;
  /** 새 세대 시작. 회수 확인 뒤에만 부른다. */
  beginGeneration(): void;
  /** 지금 이 세대로 게시·구독·복구를 해도 되는가. */
  canOperate(): boolean;
  /** 늦은 Reconnected가 현재 세대를 다시 열 수 있는가. */
  allowsRecovery(nowMs: number): boolean;
  readonly state: GenerationState;
  readonly disposed: boolean;
  /** 로컬 정리 완료. 서버 회수 확인이 아니다. */
  readonly locallyClosed: boolean;
}

export function createMediaLifecycle(deps: MediaLifecycleDeps): MediaLifecycle {
  let state: GenerationState = 'live';
  let disposed = false;
  let retiring: Promise<void> | null = null;
  let ending: Promise<void> | null = null;
  let terminalAtMs: number | null = null;
  let lastReason: RetireReason | null = null;

  const setState = (next: GenerationState) => {
    if (state === next) return;
    state = next;
    deps.onStateChange?.(next);
  };

  const runRetire = async (reason: RetireReason): Promise<void> => {
    // 1) 세대를 먼저 terminal로 바꿔 새 게시·구독·복구를 막는다.
    lastReason = reason;
    terminalAtMs = deps.now();
    setState('terminal');
    // 2) 출력을 즉시 닫고 로컬 자원을 정리한다.
    deps.media.closeOutput();
    deps.media.stopListeners();
    deps.media.releaseRemote();
    await deps.media.unpublishAll().catch(() => undefined);
    // 3) SDK disconnect를 기다린다. 이것은 로컬 closed일 뿐이다.
    await deps.media.disconnect().catch(() => undefined);
    setState('closed');
  };

  const retireGeneration = (reason: RetireReason): Promise<void> => {
    if (disposed) return Promise.resolve();
    // 동시 socket close·개인 종료·unmount는 공유 Promise로 한 번만 정리한다.
    // 완료 뒤에도 같은 Promise를 유지해 반복 호출이 다시 정리하지 않게 한다.
    // 새 세대는 beginGeneration이 연다.
    retiring ??= runRetire(reason);
    return retiring;
  };

  const runEnd = async (): Promise<void> => {
    await retireGeneration('personal-ended');
    deps.participation.stopInput();
    deps.participation.stopVision();
    await deps.participation.stopDevices().catch(() => undefined);
  };

  return {
    retireGeneration,

    endParticipation() {
      if (disposed) return Promise.resolve();
      // 같은 세대에서 반복 호출하면 첫 정리 Promise를 공유한다.
      ending ??= runEnd();
      return ending;
    },

    async dispose() {
      if (disposed) return;
      const running = ending ?? runEnd();
      ending = running;
      await running;
      disposed = true;
    },

    beginGeneration() {
      if (disposed) return;
      // 새 라운드는 여기서만 시작한다. 이전 정리 Promise를 비워 재사용을 허용한다.
      retiring = null;
      ending = null;
      terminalAtMs = null;
      lastReason = null;
      setState('live');
    },

    canOperate: () => !disposed && state === 'live',

    allowsRecovery(nowMs) {
      if (disposed) return false;
      // 게임 생존 중, 즉 세대가 살아 있을 때만 순간 복구를 허용한다.
      if (state !== 'live') return false;
      if (terminalAtMs === null || lastReason === null) return true;
      // 회수를 시작한 세대는 창이 남아 있어도 다시 열지 않는다.
      if (!allowsRecoveryWindow(lastReason)) return false;
      return nowMs - terminalAtMs <= RECOVERY_WINDOW_MS;
    },

    get state() {
      return state;
    },
    get disposed() {
      return disposed;
    },
    get locallyClosed() {
      return state === 'closed';
    },
  };
}

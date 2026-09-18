// D-09 / IN-07. 전후진 모션·키보드 의도 통합.
// 웹에서 셀을 직접 움직이지 않는다. MOVE_INTENT만 보내고 도착은 서버 권위 상태로 확인한다.
// S15P21C204-265. 키보드는 키보드 모드에서만 받고, 모션과 같은 유지 시간이 지나야 의도가 된다.
// 키가 즉시 반응하면 카메라를 가리고 키로 조작하는 쪽이 유리해지기 때문이다.
import { applyHysteresis } from './one-euro-filter';
import { INPUT_TUNING, type InputTuning } from './input-tuning';
import type { InputMode } from './interaction-context';

export type MoveDirection = 'forward' | 'back';
export type MoveIntent = MoveDirection | null;

/**
 * S15P21C204-281. 이동 의도의 단계.
 * `tap`은 한 칸만 가는 구간이고 `hold`는 유지 이동이다. 서버는 한 칸이 끝나는 Tick에만 유지
 * 의도를 보므로(A `startQueuedActions`), 탭은 의도를 보낸 뒤 곧바로 해제해 그 한 칸만 남긴다.
 * 이미 시작한 칸은 해제해도 끝까지 간다(기획서 5.2).
 */
export type MovePhase = 'idle' | 'tap' | 'hold';

/**
 * S15P21C204-280. 해제 지연. 기울임이 해제 임계 아래로 내려온 **표본 시각**과 그 표본을 받아
 * 의도를 실제로 끊은 시각의 차이다. 추론·필터·전달에 걸린 시간이며, 몸이 돌아오는 시간은 이
 * 값에 들어 있지 않다(그 앞이다). 판정에는 쓰지 않고 진단 표시만 한다.
 */
export type ReleaseLagStats = Readonly<{
  lastMs: number | null;
  medianMs: number | null;
  maxMs: number | null;
  samples: number;
}>;

/** 최근 몇 번을 중앙값·최댓값으로 볼지. 한 번의 값으로 판단하지 않기 위한 창이다. */
export const RELEASE_LAG_WINDOW = 10;

const NO_RELEASE_LAG: ReleaseLagStats = Object.freeze({
  lastMs: null,
  medianMs: null,
  maxMs: null,
  samples: 0,
});

/** 짝수 개면 가운데 두 값의 평균. 창이 작아 정렬 비용은 무시할 수 있다. */
export function releaseLagStats(window: readonly number[]): ReleaseLagStats {
  if (window.length === 0) return NO_RELEASE_LAG;
  const sorted = [...window].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return {
    lastMs: window[window.length - 1]!,
    medianMs: median,
    maxMs: sorted[sorted.length - 1]!,
    samples: window.length,
  };
}

/** 유지 중 의도를 다시 알리는 주기. 서버 행동 시간과 다른 값이다. */
export const MOVE_REFRESH_MS = 100;

export type MoveIntentDeps = Readonly<{
  /** C가 주입한 sendCommand를 감싼 전송기. D는 sequence/requestId를 만들지 않는다. */
  send(direction: MoveIntent): void;
  now(): number;
  setTimer(handler: () => void, delayMs: number): number;
  clearTimer(handle: number): void;
  tuning?: InputTuning;
}>;

export interface MoveIntentController {
  /** 보정된 상대 lean. 보정 전에는 null을 넣어 어떤 의도도 만들지 않는다. 키보드 모드에서는 무시한다. */
  updateMotion(relativeLeanRad: number | null, nowMs: number): void;
  /**
   * 키보드 모드에서만 받는다. 누른 키는 모션과 같은 유지 시간(전진 forwardHoldMs·후진
   * backHoldMs)이 지나야 의도가 되고, 놓으면 즉시 멈춘다. 모션 모드의 키는 무시한다.
   */
  setKey(direction: MoveDirection, pressed: boolean): void;
  /** 모드가 바뀌면 누르고 있던 키와 모션 후보를 모두 버린다. 구 입력을 새 모드로 이어 가지 않는다. */
  setMode(mode: InputMode): void;
  /** 장애·문맥 종료·잠금. held와 시작 시각을 비우고 direction null을 한 번 보낸다. */
  release(): void;
  /** 새 match·모드 변경 등 완전 초기화. 구 모션을 재발동하지 않는다. */
  reset(): void;
  readonly current: MoveIntent;
  readonly motionActive: boolean;
  readonly mode: InputMode;
  /** S15P21C204-281. 지금 한 칸(tap)인지 유지 이동(hold)인지. 시험과 디버그 표시가 읽는다. */
  readonly phase: MovePhase;
  /** S15P21C204-280. 최근 해제 지연. 모션 모드에서만 쌓이며 판정에는 쓰지 않는다. */
  readonly releaseLag: ReleaseLagStats;
}

export function createMoveIntentController(deps: MoveIntentDeps): MoveIntentController {
  const tuning = deps.tuning ?? INPUT_TUNING;
  let mode: InputMode = 'motion';
  let current: MoveIntent = null;
  let forwardActive = false;
  let backActive = false;
  let forwardSince: number | null = null;
  let backSince: number | null = null;
  let keyForward = false;
  let keyBack = false;
  /** 키를 누른 시각. 유지 시간을 채우기 전에는 의도를 만들지 않는다. */
  let keyForwardSince: number | null = null;
  let keyBackSince: number | null = null;
  let timer: number | null = null;
  /** 누른 키의 유지 시간이 차는 순간 다시 판정하기 위한 일회성 타이머. */
  let keyTimer: number | null = null;
  /** S15P21C204-281. 탭·홀드 상태와 발동 시각·방향. */
  let phase: MovePhase = 'idle';
  let armedAt: number | null = null;
  let armedDirection: MoveDirection | null = null;
  /** 탭이 보낸 의도를 끊는 일회성 타이머. */
  let tapTimer: number | null = null;
  /** 계속 기울이고 있을 때 연속 이동으로 올리는 일회성 타이머(키보드는 표본이 오지 않아 필요). */
  let upgradeTimer: number | null = null;
  /** S15P21C204-280. 해제를 보인 표본의 시각. 의도를 끊는 순간 지연으로 바꾸고 비운다. */
  let releaseSampleAtMs: number | null = null;
  const releaseLagWindow: number[] = [];

  const stopTimer = () => {
    if (timer === null) return;
    deps.clearTimer(timer);
    timer = null;
  };

  const stopKeyTimer = () => {
    if (keyTimer === null) return;
    deps.clearTimer(keyTimer);
    keyTimer = null;
  };

  const stopTapTimer = () => {
    if (tapTimer === null) return;
    deps.clearTimer(tapTimer);
    tapTimer = null;
  };

  const stopUpgradeTimer = () => {
    if (upgradeTimer === null) return;
    deps.clearTimer(upgradeTimer);
    upgradeTimer = null;
  };

  const clearKeys = () => {
    keyForward = false;
    keyBack = false;
    keyForwardSince = null;
    keyBackSince = null;
    stopKeyTimer();
  };

  const clearMotion = () => {
    forwardActive = false;
    backActive = false;
    forwardSince = null;
    backSince = null;
  };

  const startTimer = () => {
    stopTimer();
    const tick = () => {
      if (current === null) {
        timer = null;
        return;
      }
      deps.send(current);
      timer = deps.setTimer(tick, MOVE_REFRESH_MS);
    };
    timer = deps.setTimer(tick, MOVE_REFRESH_MS);
  };

  /** 값이 실제로 바뀔 때만 보낸다. 타이머는 부르는 쪽이 정한다. */
  const emit = (next: MoveIntent) => {
    if (next === current) return;
    current = next;
    deps.send(next);
  };

  /**
   * 한 칸. 의도를 한 번 보내고 `MOVE_REFRESH_MS` 뒤 해제해, 시작한 칸만 남기고 유지를 끊는다.
   * 계속 기울이고 있으면 `holdToContinuousMs` 뒤 연속 이동으로 올라간다.
   */
  const beginTap = (direction: MoveDirection, nowMs: number) => {
    phase = 'tap';
    armedAt = nowMs;
    armedDirection = direction;
    stopTimer();
    emit(direction);
    stopTapTimer();
    tapTimer = deps.setTimer(() => {
      tapTimer = null;
      if (phase === 'tap') emit(null);
    }, MOVE_REFRESH_MS);
    armUpgradeTimer(nowMs);
  };

  /**
   * 남은 시간만큼만 기다렸다 다시 판정한다. 키보드는 키를 누르고 있는 동안 표본이 오지 않으므로
   * 이 타이머가 연속 전환의 유일한 계기다. 타이머가 일찍 깨어도 시계로 다시 재 남은 만큼 잔다.
   */
  function armUpgradeTimer(nowMs: number): void {
    stopUpgradeTimer();
    if (armedAt === null) return;
    const remaining = tuning.holdToContinuousMs - (nowMs - armedAt);
    upgradeTimer = deps.setTimer(
      () => {
        upgradeTimer = null;
        resolve();
      },
      Math.max(1, remaining),
    );
  }

  /** 연속 이동. 유지 의도를 갱신 주기로 계속 알린다. */
  const beginHold = (direction: MoveDirection) => {
    phase = 'hold';
    armedDirection = direction;
    stopTapTimer();
    stopUpgradeTimer();
    emit(direction);
    startTimer();
  };

  /** 해제를 보인 표본과 지금 사이의 시간을 창에 넣는다. 음수(시계 역행)는 버린다. */
  const recordReleaseLag = (nowMs: number) => {
    if (releaseSampleAtMs === null) return;
    const lag = nowMs - releaseSampleAtMs;
    releaseSampleAtMs = null;
    if (!Number.isFinite(lag) || lag < 0) return;
    releaseLagWindow.push(lag);
    if (releaseLagWindow.length > RELEASE_LAG_WINDOW) releaseLagWindow.shift();
  };

  const toIdle = () => {
    recordReleaseLag(deps.now());
    phase = 'idle';
    armedAt = null;
    armedDirection = null;
    stopTapTimer();
    stopUpgradeTimer();
    stopTimer();
    emit(null);
  };

  /** 지금 이 순간 기울임·키가 가리키는 방향. 단계 판정과 분리한다. */
  const desiredDirection = (nowMs: number): MoveIntent => {
    if (mode === 'keyboard') {
      // 양방향 동시입력은 중립이다. 한 방향은 모션과 같은 유지 시간을 채운 뒤에만 의도가 된다.
      if (keyForward && keyBack) return null;
      const forwardHeld =
        keyForward && keyForwardSince !== null && nowMs - keyForwardSince >= tuning.forwardHoldMs;
      const backHeld =
        keyBack && keyBackSince !== null && nowMs - keyBackSince >= tuning.backHoldMs;
      return forwardHeld ? 'forward' : backHeld ? 'back' : null;
    }
    if (forwardActive && backActive) return null;
    return forwardActive ? 'forward' : backActive ? 'back' : null;
  };

  /** 누른 키 중 아직 유지 시간을 채우지 못한 것이 있으면 그 시각에 다시 판정한다. */
  const armKeyTimer = (nowMs: number) => {
    stopKeyTimer();
    const remaining = [
      keyForward && keyForwardSince !== null
        ? tuning.forwardHoldMs - (nowMs - keyForwardSince)
        : null,
      keyBack && keyBackSince !== null ? tuning.backHoldMs - (nowMs - keyBackSince) : null,
    ].filter((value): value is number => value !== null && value > 0);
    if (remaining.length === 0) return;
    keyTimer = deps.setTimer(
      () => {
        keyTimer = null;
        resolve();
      },
      Math.max(1, Math.min(...remaining)),
    );
  };

  function resolve(): void {
    const nowMs = deps.now();
    if (mode === 'keyboard') armKeyTimer(nowMs);
    const desired = desiredDirection(nowMs);
    if (desired === null) {
      toIdle();
      return;
    }
    if (phase === 'hold') {
      // 유지 중 방향이 바뀌면 그대로 이어 간다. 다시 탭으로 내려가지 않는다.
      if (desired !== current) beginHold(desired);
      return;
    }
    if (phase === 'tap') {
      if (desired !== armedDirection) {
        beginTap(desired, nowMs);
        return;
      }
      // 같은 방향을 충분히 오래 유지했다. 다음 칸이 시작되기 전에 연속으로 올린다.
      if (armedAt !== null && nowMs - armedAt >= tuning.holdToContinuousMs) beginHold(desired);
      else if (upgradeTimer === null) armUpgradeTimer(nowMs);
      return;
    }
    beginTap(desired, nowMs);
  }

  return {
    updateMotion(relativeLeanRad, nowMs) {
      // S15P21C204-280. 이 표본이 해제를 처음 보이는 표본인지 알려면 직전 방향이 필요하다.
      const before = mode === 'motion' ? desiredDirection(nowMs) : null;
      const markRelease = () => {
        if (before !== null && desiredDirection(nowMs) === null) releaseSampleAtMs = nowMs;
      };
      // 키보드 모드에서는 모션 후보를 채택하지 않는다. 회전 컨트롤러와 같은 규칙이다.
      if (mode !== 'motion' || relativeLeanRad === null || !Number.isFinite(relativeLeanRad)) {
        // 보정 전이거나 표본이 없으면 모션 의도를 만들지 않는다.
        clearMotion();
        markRelease();
        resolve();
        return;
      }
      const forwardMagnitude = relativeLeanRad > 0 ? relativeLeanRad : 0;
      const backMagnitude = relativeLeanRad < 0 ? -relativeLeanRad : 0;

      const forwardOver = applyHysteresis(forwardActive, forwardMagnitude, {
        enterRad: tuning.forwardEnterRad,
        exitRad: tuning.forwardExitRad,
      });
      const backOver = applyHysteresis(backActive, backMagnitude, {
        enterRad: tuning.backEnterRad,
        exitRad: tuning.backExitRad,
      });

      if (!forwardOver) {
        forwardSince = null;
        forwardActive = false;
      } else {
        forwardSince ??= nowMs;
        forwardActive = nowMs - forwardSince >= tuning.forwardHoldMs;
      }
      if (!backOver) {
        backSince = null;
        backActive = false;
      } else {
        backSince ??= nowMs;
        backActive = nowMs - backSince >= tuning.backHoldMs;
      }
      markRelease();
      resolve();
    },

    setKey(direction, pressed) {
      // 모션 모드에서는 키가 이동을 만들지 않는다. 웹캠으로만 움직인다.
      if (mode !== 'keyboard') return;
      const nowMs = deps.now();
      if (direction === 'forward') {
        if (pressed === keyForward) return;
      } else if (pressed === keyBack) return;
      // 놓는 시점에 먼저 시계로 판정한다. 메인 스레드가 막혀 유지 타이머가 keyup보다 늦게
      // 처리되면 타이머는 취소되고 채운 유지 시간이 사라진다. 모션은 표본 시각으로 재므로
      // 같은 지연에 견디는데, 키만 입력을 잃으면 동등하지 않다. 유지 시간을 채웠다면 여기서
      // 의도를 내보내고 바로 아래에서 놓기를 처리해 모션의 "임계 진입 뒤 즉시 이탈"과 같아진다.
      if (!pressed) resolve();
      if (direction === 'forward') {
        keyForward = pressed;
        keyForwardSince = pressed ? nowMs : null;
      } else {
        keyBack = pressed;
        keyBackSince = pressed ? nowMs : null;
      }
      resolve();
    },

    setMode(next) {
      if (next === mode) return;
      mode = next;
      clearKeys();
      clearMotion();
      resolve();
    },

    release() {
      clearMotion();
      clearKeys();
      phase = 'idle';
      armedAt = null;
      armedDirection = null;
      stopTapTimer();
      stopUpgradeTimer();
      if (current !== null) {
        current = null;
        deps.send(null);
      }
      stopTimer();
    },

    reset() {
      clearMotion();
      clearKeys();
      phase = 'idle';
      armedAt = null;
      armedDirection = null;
      stopTapTimer();
      stopUpgradeTimer();
      current = null;
      stopTimer();
    },

    get current() {
      return current;
    },
    get motionActive() {
      return forwardActive || backActive;
    },
    get mode() {
      return mode;
    },
    get phase() {
      return phase;
    },
    get releaseLag() {
      return releaseLagStats(releaseLagWindow);
    },
  };
}

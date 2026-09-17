// D-09 / IN-07. 전후진 모션·키보드 의도 통합.
// 웹에서 셀을 직접 움직이지 않는다. MOVE_INTENT만 보내고 도착은 서버 권위 상태로 확인한다.
// S15P21C204-265. 키보드는 키보드 모드에서만 받고, 모션과 같은 유지 시간이 지나야 의도가 된다.
// 키가 즉시 반응하면 카메라를 가리고 키로 조작하는 쪽이 유리해지기 때문이다.
import { applyHysteresis } from './one-euro-filter';
import { INPUT_TUNING, type InputTuning } from './input-tuning';
import type { InputMode } from './interaction-context';

export type MoveDirection = 'forward' | 'back';
export type MoveIntent = MoveDirection | null;

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

  const apply = (next: MoveIntent) => {
    if (next === current) return;
    current = next;
    deps.send(next);
    if (next === null) stopTimer();
    else startTimer();
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

  const resolve = () => {
    if (mode === 'keyboard') {
      // 양방향 동시입력은 중립이다. 한 방향은 모션과 같은 유지 시간을 채운 뒤에만 의도가 된다.
      if (keyForward && keyBack) {
        stopKeyTimer();
        apply(null);
        return;
      }
      const nowMs = deps.now();
      const forwardHeld =
        keyForward && keyForwardSince !== null && nowMs - keyForwardSince >= tuning.forwardHoldMs;
      const backHeld =
        keyBack && keyBackSince !== null && nowMs - keyBackSince >= tuning.backHoldMs;
      apply(forwardHeld ? 'forward' : backHeld ? 'back' : null);
      armKeyTimer(nowMs);
      return;
    }
    if (forwardActive && backActive) {
      apply(null);
      return;
    }
    apply(forwardActive ? 'forward' : backActive ? 'back' : null);
  };

  return {
    updateMotion(relativeLeanRad, nowMs) {
      // 키보드 모드에서는 모션 후보를 채택하지 않는다. 회전 컨트롤러와 같은 규칙이다.
      if (mode !== 'motion' || relativeLeanRad === null || !Number.isFinite(relativeLeanRad)) {
        // 보정 전이거나 표본이 없으면 모션 의도를 만들지 않는다.
        clearMotion();
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
      if (current !== null) {
        current = null;
        deps.send(null);
      }
      stopTimer();
    },

    reset() {
      clearMotion();
      clearKeys();
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
  };
}

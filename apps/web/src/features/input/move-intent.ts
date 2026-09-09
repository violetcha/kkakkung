// D-09 / IN-07. 전후진 모션·키보드 의도 통합.
// 웹에서 셀을 직접 움직이지 않는다. MOVE_INTENT만 보내고 도착은 서버 권위 상태로 확인한다.
import { applyHysteresis } from './one-euro-filter';
import { INPUT_TUNING, type InputTuning } from './input-tuning';

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
  /** 보정된 상대 lean. 보정 전에는 null을 넣어 어떤 의도도 만들지 않는다. */
  updateMotion(relativeLeanRad: number | null, nowMs: number): void;
  setKey(direction: MoveDirection, pressed: boolean): void;
  /** 장애·문맥 종료·잠금. held와 시작 시각을 비우고 direction null을 한 번 보낸다. */
  release(): void;
  /** 새 match·모드 변경 등 완전 초기화. 구 모션을 재발동하지 않는다. */
  reset(): void;
  readonly current: MoveIntent;
  readonly motionActive: boolean;
}

export function createMoveIntentController(deps: MoveIntentDeps): MoveIntentController {
  const tuning = deps.tuning ?? INPUT_TUNING;
  let current: MoveIntent = null;
  let forwardActive = false;
  let backActive = false;
  let forwardSince: number | null = null;
  let backSince: number | null = null;
  let keyForward = false;
  let keyBack = false;
  let timer: number | null = null;

  const stopTimer = () => {
    if (timer === null) return;
    deps.clearTimer(timer);
    timer = null;
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

  const resolve = () => {
    // 키 입력이 있으면 키가 우선한다. 양방향 동시입력은 중립이다.
    if (keyForward || keyBack) {
      apply(keyForward && keyBack ? null : keyForward ? 'forward' : 'back');
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
      if (relativeLeanRad === null || !Number.isFinite(relativeLeanRad)) {
        // 보정 전이거나 표본이 없으면 모션 의도를 만들지 않는다.
        forwardActive = false;
        backActive = false;
        forwardSince = null;
        backSince = null;
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
      if (direction === 'forward') keyForward = pressed;
      else keyBack = pressed;
      resolve();
    },

    release() {
      forwardActive = false;
      backActive = false;
      forwardSince = null;
      backSince = null;
      keyForward = false;
      keyBack = false;
      if (current !== null) {
        current = null;
        deps.send(null);
      }
      stopTimer();
    },

    reset() {
      forwardActive = false;
      backActive = false;
      forwardSince = null;
      backSince = null;
      keyForward = false;
      keyBack = false;
      current = null;
      stopTimer();
    },

    get current() {
      return current;
    },
    get motionActive() {
      return forwardActive || backActive;
    },
  };
}

// D-10 / IN-08. 회전 모션·키 발동.
// 한 번 발동하면 latch를 잠그고 중립 안정 구간을 지나야 다음 회전을 만든다.
// 서버 6 Tick 행동과 1개 버퍼를 따르며 웹에 무한 행동 큐를 만들지 않는다.
import { applyHysteresis } from './one-euro-filter';
import { INPUT_TUNING, type InputTuning } from './input-tuning';

export type TurnDirection = 'left' | 'right';
export type InputMode = 'motion' | 'keyboard';

export type TurnIntentDeps = Readonly<{
  send(direction: TurnDirection): void;
  tuning?: InputTuning;
}>;

export interface TurnIntentController {
  /** 보정된 상대 yaw. 보정 전에는 null이며 회전을 만들지 않는다. */
  updateMotion(relativeYawRad: number | null, nowMs: number): void;
  /** 첫 keydown만 받는다. event.repeat는 무시한다. */
  keyDown(direction: TurnDirection, repeat: boolean): void;
  /** keyup은 재발동을 허용하는 조건이다. 놓을 때 회전하지 않는다. */
  keyUp(direction: TurnDirection): void;
  setMode(mode: InputMode): void;
  reset(): void;
  readonly latched: boolean;
  readonly mode: InputMode;
}

export function createTurnIntentController(deps: TurnIntentDeps): TurnIntentController {
  const tuning = deps.tuning ?? INPUT_TUNING;
  let mode: InputMode = 'motion';
  let latched = false;
  let active = false;
  let heldSince: number | null = null;
  let neutralSince: number | null = null;
  let heldDirection: TurnDirection | null = null;
  const pressed = new Set<TurnDirection>();

  const clearMotion = () => {
    active = false;
    heldSince = null;
    neutralSince = null;
    heldDirection = null;
  };

  return {
    updateMotion(relativeYawRad, nowMs) {
      // 모드가 키보드면 모션 후보를 채택하지 않는다.
      if (mode !== 'motion' || relativeYawRad === null || !Number.isFinite(relativeYawRad)) {
        clearMotion();
        return;
      }
      const magnitude = Math.abs(relativeYawRad);
      const direction: TurnDirection = relativeYawRad > 0 ? 'right' : 'left';
      const over = applyHysteresis(active, magnitude, {
        enterRad: tuning.turnEnterRad,
        exitRad: tuning.turnExitRad,
      });
      active = over;

      if (!over) {
        heldSince = null;
        heldDirection = null;
        // 해제 임계값 안에서 중립을 유지해야 latch가 풀린다.
        neutralSince ??= nowMs;
        if (latched && nowMs - neutralSince >= tuning.neutralHoldMs) latched = false;
        return;
      }

      neutralSince = null;
      if (heldDirection !== direction) {
        heldDirection = direction;
        heldSince = nowMs;
      }
      heldSince ??= nowMs;
      if (latched) return;
      if (nowMs - heldSince < tuning.turnHoldMs) return;
      latched = true;
      deps.send(direction);
    },

    keyDown(direction, repeat) {
      if (mode !== 'keyboard') return;
      if (repeat) return;
      if (pressed.has(direction)) return;
      pressed.add(direction);
      deps.send(direction);
    },

    keyUp(direction) {
      pressed.delete(direction);
    },

    setMode(next) {
      if (next === mode) return;
      mode = next;
      latched = false;
      pressed.clear();
      clearMotion();
    },

    reset() {
      latched = false;
      pressed.clear();
      clearMotion();
    },

    get latched() {
      return latched;
    },
    get mode() {
      return mode;
    },
  };
}

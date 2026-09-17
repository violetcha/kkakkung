// D-10 / IN-08. 회전 모션·키 발동.
// 한 번 발동하면 latch를 잠그고 중립 안정 구간을 지나야 다음 회전을 만든다.
// 서버 6 Tick 행동과 1개 버퍼를 따르며 웹에 무한 행동 큐를 만들지 않는다.
// S15P21C204-265. 키보드 회전도 같은 규칙이다: 키를 turnHoldMs 유지해야 한 번 발동하고,
// 놓은 뒤 neutralHoldMs가 지나야 다음 회전을 받는다. 즉시 반응하는 키는 모션보다 유리하다.
import { applyHysteresis } from './one-euro-filter';
import { INPUT_TUNING, type InputTuning } from './input-tuning';

export type TurnDirection = 'left' | 'right';
export type InputMode = 'motion' | 'keyboard';

export type TurnIntentDeps = Readonly<{
  send(direction: TurnDirection): void;
  /** 키 유지·중립 대기 판정에 쓴다. 모션은 표본 시각을 쓰므로 이 시계와 섞지 않는다. */
  now(): number;
  setTimer(handler: () => void, delayMs: number): number;
  clearTimer(handle: number): void;
  tuning?: InputTuning;
}>;

export interface TurnIntentController {
  /** 보정된 상대 yaw. 보정 전에는 null이며 회전을 만들지 않는다. */
  updateMotion(relativeYawRad: number | null, nowMs: number): void;
  /** 첫 keydown만 받는다. event.repeat는 무시한다. turnHoldMs 뒤에도 눌려 있어야 발동한다. */
  keyDown(direction: TurnDirection, repeat: boolean): void;
  /** keyup은 재발동을 허용하는 조건이다. 놓을 때 회전하지 않고, neutralHoldMs 뒤에 latch가 풀린다. */
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
  /** 유지 시간을 채우는 중인 키와 그 시작 시각·타이머. 없으면 어떤 키도 발동을 기다리지 않는다. */
  let keyHeld: TurnDirection | null = null;
  let keyHeldSince: number | null = null;
  let keyHoldTimer: number | null = null;
  /** 키를 모두 놓은 시각과 latch를 푸는 타이머. 그 사이 새 키가 눌리면 취소한다. */
  let keyNeutralSince: number | null = null;
  let keyNeutralTimer: number | null = null;

  const clearMotion = () => {
    active = false;
    heldSince = null;
    neutralSince = null;
    heldDirection = null;
  };

  const stopKeyHold = () => {
    keyHeld = null;
    keyHeldSince = null;
    if (keyHoldTimer === null) return;
    deps.clearTimer(keyHoldTimer);
    keyHoldTimer = null;
  };

  const stopKeyNeutral = () => {
    keyNeutralSince = null;
    if (keyNeutralTimer === null) return;
    deps.clearTimer(keyNeutralTimer);
    keyNeutralTimer = null;
  };

  /** 유지 중인 키가 유지 시간을 채웠는지 시계로 판정한다. 타이머 발화 여부와 무관하다. */
  const keyHoldElapsed = (direction: TurnDirection) =>
    keyHeld === direction &&
    keyHeldSince !== null &&
    !latched &&
    pressed.has(direction) &&
    deps.now() - keyHeldSince >= tuning.turnHoldMs;

  const fireKeyHold = (direction: TurnDirection) => {
    stopKeyHold();
    latched = true;
    deps.send(direction);
  };

  /** 타이머가 이르게 깨어나도 시계로 유지 시간을 다시 재고, 모자라면 남은 만큼 다시 잔다. */
  const armKeyHold = (direction: TurnDirection) => {
    const since = keyHeldSince;
    if (since === null) return;
    const remaining = tuning.turnHoldMs - (deps.now() - since);
    if (remaining > 0) {
      keyHoldTimer = deps.setTimer(
        () => {
          keyHoldTimer = null;
          if (keyHeld !== direction || !pressed.has(direction) || latched) return stopKeyHold();
          armKeyHold(direction);
        },
        Math.max(1, remaining),
      );
      return;
    }
    fireKeyHold(direction);
  };

  const armKeyNeutral = () => {
    const since = keyNeutralSince;
    if (since === null || pressed.size > 0) return;
    const remaining = tuning.neutralHoldMs - (deps.now() - since);
    if (remaining > 0) {
      keyNeutralTimer = deps.setTimer(
        () => {
          keyNeutralTimer = null;
          armKeyNeutral();
        },
        Math.max(1, remaining),
      );
      return;
    }
    stopKeyNeutral();
    latched = false;
  };

  const clearKeys = () => {
    pressed.clear();
    stopKeyHold();
    stopKeyNeutral();
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
      // 키가 눌려 있는 동안은 중립이 아니다. 놓았다가 다시 누른 경우 대기를 처음부터 센다.
      stopKeyNeutral();
      // 두 방향을 함께 누르면 모션의 방향 전환처럼 유지를 버린다. 하나를 놓아도 새로 눌러야 한다.
      if (pressed.size > 1) {
        stopKeyHold();
        return;
      }
      if (latched) return;
      stopKeyHold();
      keyHeld = direction;
      keyHeldSince = deps.now();
      armKeyHold(direction);
    },

    keyUp(direction) {
      // 메인 스레드가 막혀 유지 타이머가 keyup보다 늦게 처리돼도, 실제로 유지 시간을 채운
      // 키는 놓는 시점에 발동한다. 모션이 표본 시각으로 재는 것과 같은 판정이다.
      if (keyHoldElapsed(direction)) fireKeyHold(direction);
      pressed.delete(direction);
      if (keyHeld === direction) stopKeyHold();
      // 모든 키를 놓은 채 중립 시간을 채워야 다음 회전을 받는다.
      if (latched && pressed.size === 0 && keyNeutralSince === null) {
        keyNeutralSince = deps.now();
        armKeyNeutral();
      }
    },

    setMode(next) {
      if (next === mode) return;
      mode = next;
      latched = false;
      clearKeys();
      clearMotion();
    },

    reset() {
      latched = false;
      clearKeys();
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

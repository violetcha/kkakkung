// D-11 / IN-09. 손동작·단축키의 행동 문맥 중재.
// C가 주입한 sendCommand만 호출하고 반환된 requestId는 식별자로만 보관한다.
// 반환값을 envelope나 접수/실행 성공으로 해석하지 않는다.
import { GESTURE_MAX_AGE_MS, isSampleFresh, type SensorSnapshot } from '../vision/sensor-types';
import { hasClosedFist } from '../vision/gesture-sensor';
import type {
  ContextStore,
  EquipmentKind,
  InteractionState,
  InputMode,
} from './interaction-context';

/** 같은 손동작을 이만큼 유지해야 한 번 발동한다. */
export const GESTURE_HOLD_MS = 600;

/** 주먹을 유지하는 동안 서버의 300ms 잡기 창을 이 간격으로 갱신한다. */
export const GRAB_RESEND_MS = 200;

/** D만 등록하는 게임 단축키. */
export type GameKey = 'E' | 'F' | 'G' | '1' | '2' | 'Escape';

export type CommandInput =
  | { type: 'EXCHANGE_REQUEST'; payload: { targetPlayerId: string } }
  | { type: 'EXCHANGE_ACCEPT'; payload: { exchangeId: string } }
  | { type: 'EXCHANGE_CANCEL'; payload: { exchangeId: string } }
  | { type: 'INSTALL'; payload: { kind: EquipmentKind } }
  | { type: 'INSTALL_CANCEL'; payload: { installationId: string } }
  | { type: 'GRAB_INTENT'; payload: Record<string, never> }
  | { type: 'EXIT_START'; payload: { exitId: string } }
  | { type: 'EXIT_CANCEL'; payload: { challengeId: string } };

export type GestureIntentDeps = Readonly<{
  context: ContextStore;
  /** C sender. 반환 requestId는 보관만 한다. */
  send(command: CommandInput): string;
  onInteractionState(state: InteractionState): void;
  holdMs?: number;
}>;

export type GestureAction =
  | 'exchange-accept'
  | 'exchange-request'
  | 'exit-start'
  | 'install'
  | 'install-cancel'
  | 'grab'
  | 'exit-cancel'
  | 'select-equipment'
  | null;

export interface GestureIntentController {
  observe(snapshot: SensorSnapshot, nowMs: number, runtimeGeneration: number): GestureAction;
  pressKey(key: GameKey): GestureAction;
  setMode(mode: InputMode): void;
  /** C의 화면 선택을 반영한다. callback echo를 만들지 않는다. */
  syncEquipment(kind: EquipmentKind): void;
  /** 문맥 변화·장애에서 보류 시간만 비운다. 발동 잠금은 물리 해제까지 유지한다. */
  reset(): void;
  readonly selectedEquipment: EquipmentKind;
  readonly lastRequestId: string | null;
}

export function createGestureIntentController(deps: GestureIntentDeps): GestureIntentController {
  const holdMs = deps.holdMs ?? GESTURE_HOLD_MS;
  let selectedEquipment: EquipmentKind = 'sensor';
  let mode: InputMode = 'motion';
  let lastRequestId: string | null = null;
  let heldKind: 'palm' | 'victory' | null = null;
  let heldSince: number | null = null;
  let lastFrameId: number | null = null;
  let lastSampleAt: number | null = null;
  let lastObservedAt: number | null = null;
  let observedGeneration: number | null = null;
  let latchedKind: 'palm' | 'victory' | null = null;
  let lastGrabSentAt: number | null = null;

  const clearHold = () => {
    heldKind = null;
    heldSince = null;
  };

  const clearGrab = () => {
    lastGrabSentAt = null;
  };

  const dispatch = (command: CommandInput): string => {
    lastRequestId = deps.send(command);
    return lastRequestId;
  };

  const publishState = () => {
    deps.onInteractionState({ selectedEquipment, mode });
  };

  /** 손바닥·E의 공통 중재. 손바닥은 출구 시작에 쓰지 않는다. */
  const resolveExchangeOrExit = (allowExit: boolean): GestureAction => {
    const context = deps.context.get();
    if (!context) return null;
    // incoming 수락이 가장 우선한다. 자기 요청(outgoing)은 수락하지 않는다.
    if (context.incomingExchangeId) {
      dispatch({
        type: 'EXCHANGE_ACCEPT',
        payload: { exchangeId: context.incomingExchangeId },
      });
      clearHold();
      return 'exchange-accept';
    }
    if (allowExit && context.exitId) {
      dispatch({ type: 'EXIT_START', payload: { exitId: context.exitId } });
      clearHold();
      return 'exit-start';
    }
    // 교환 세션이 이미 있으면 새 요청을 만들지 않는다.
    if (context.outgoingExchangeId) return null;
    if (!context.targetPlayerId) return null;
    dispatch({
      type: 'EXCHANGE_REQUEST',
      payload: { targetPlayerId: context.targetPlayerId },
    });
    clearHold();
    return 'exchange-request';
  };

  const resolveInstall = (): GestureAction => {
    const context = deps.context.get();
    // 술래만 설치한다. role=null이나 runner에는 설치 명령을 만들지 않는다.
    if (context?.role !== 'tagger') return null;
    if (context.installationId) {
      dispatch({ type: 'INSTALL_CANCEL', payload: { installationId: context.installationId } });
      clearHold();
      return 'install-cancel';
    }
    dispatch({ type: 'INSTALL', payload: { kind: selectedEquipment } });
    clearHold();
    return 'install';
  };

  const blockedByChallenge = (): boolean => deps.context.inChallenge;

  return {
    observe(snapshot, nowMs, runtimeGeneration) {
      if (snapshot.runtimeGeneration !== runtimeGeneration) {
        clearHold();
        clearGrab();
        return null;
      }
      if (observedGeneration !== runtimeGeneration) {
        observedGeneration = runtimeGeneration;
        lastFrameId = lastSampleAt = lastObservedAt = null;
        latchedKind = null;
        clearHold();
        clearGrab();
      }
      const sample = snapshot.gesture;
      if (
        !sample ||
        sample.sampledAtMs > nowMs ||
        nowMs - sample.sampledAtMs > GESTURE_MAX_AGE_MS
      ) {
        // 관측 공백은 시간 누적을 끊지만 물리 해제의 증거는 아니다.
        clearHold();
        clearGrab();
        return null;
      }
      if (lastFrameId !== null && sample.frameId <= lastFrameId) return null;
      if (lastSampleAt !== null && sample.sampledAtMs <= lastSampleAt) return null;
      if (
        (lastSampleAt !== null && sample.sampledAtMs - lastSampleAt > GESTURE_MAX_AGE_MS) ||
        (lastObservedAt !== null && nowMs - lastObservedAt > GESTURE_MAX_AGE_MS)
      )
        clearHold();
      lastFrameId = sample.frameId;
      lastSampleAt = sample.sampledAtMs;
      lastObservedAt = nowMs;
      if (!isSampleFresh(sample, 'gesture', nowMs) || sample.status !== 'valid') {
        // 누락되거나 오래된 관측은 hold와 잡기 갱신을 모두 끊는다.
        latchedKind = null;
        clearHold();
        clearGrab();
        return null;
      }

      const context = deps.context.get();
      const fist = hasClosedFist(sample.data.hands);
      const canGrab =
        deps.context.acceptsInput &&
        !blockedByChallenge() &&
        mode === 'motion' &&
        context?.role === 'tagger' &&
        context.phase === 'PLAYING';
      if (fist && canGrab) {
        clearHold();
        if (lastGrabSentAt === null || sample.sampledAtMs - lastGrabSentAt >= GRAB_RESEND_MS) {
          lastGrabSentAt = sample.sampledAtMs;
          dispatch({ type: 'GRAB_INTENT', payload: {} });
          return 'grab';
        }
        return null;
      }
      clearGrab();

      if (sample.data.kind === 'none') {
        // 신선한 none은 기존 손동작 latch를 물리적으로 해제한다.
        latchedKind = null;
        clearHold();
        return null;
      }
      const kind = sample.data.kind;
      if (latchedKind === kind) return null;
      latchedKind = null;
      if (!deps.context.acceptsInput || blockedByChallenge() || mode !== 'motion') {
        clearHold();
        return null;
      }
      if (kind !== heldKind) {
        heldKind = kind;
        heldSince = sample.sampledAtMs;
      }
      heldSince ??= sample.sampledAtMs;
      if (sample.sampledAtMs - heldSince < holdMs) return null;
      // send()가 동기적으로 문맥을 갱신하더라도 잠금은 유지된다.
      latchedKind = kind;
      // 손바닥은 교환 요청·수락에만 쓴다.
      if (kind === 'palm') return resolveExchangeOrExit(false);
      return resolveInstall();
    },

    pressKey(key) {
      const context = deps.context.get();
      if (!context) return null;
      // Esc는 challenge 취소 전용이며 D만 등록한다.
      if (key === 'Escape') {
        if (!context.challengeId) return null;
        dispatch({ type: 'EXIT_CANCEL', payload: { challengeId: context.challengeId } });
        clearHold();
        return 'exit-cancel';
      }
      if (!deps.context.acceptsInput) return null;
      // challenge 중에는 취소 외 일반 행동을 막는다.
      if (blockedByChallenge()) return null;
      if (key === '1' || key === '2') {
        if (context.role !== 'tagger') return null;
        const next: EquipmentKind = key === '1' ? 'sensor' : 'trap';
        if (next === selectedEquipment) return null; // 같은 값 echo는 no-op이다.
        selectedEquipment = next;
        publishState();
        return 'select-equipment';
      }
      if (key === 'E') return resolveExchangeOrExit(true);
      if (key === 'G') {
        if (context.role !== 'tagger' || context.phase !== 'PLAYING') return null;
        dispatch({ type: 'GRAB_INTENT', payload: {} });
        clearHold();
        return 'grab';
      }
      // 도망자의 F에는 제품 행동을 배정하지 않는다.
      if (key === 'F') return resolveInstall();
      return null;
    },

    setMode(next) {
      if (next === mode) return; // 같은 값 재적용은 callback을 반복하지 않는다.
      mode = next;
      clearHold();
      clearGrab();
      publishState();
    },

    syncEquipment(next) {
      if (next === selectedEquipment) return;
      selectedEquipment = next;
      clearHold();
    },

    reset() {
      clearHold();
      clearGrab();
    },

    get selectedEquipment() {
      return selectedEquipment;
    },
    get lastRequestId() {
      return lastRequestId;
    },
  };
}

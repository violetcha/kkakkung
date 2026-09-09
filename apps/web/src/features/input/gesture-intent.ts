// D-11 / IN-09. 손동작·단축키의 행동 문맥 중재.
// C가 주입한 sendCommand만 호출하고 반환된 requestId는 식별자로만 보관한다.
// 반환값을 envelope나 접수/실행 성공으로 해석하지 않는다.
import { isSampleFresh, type SensorSnapshot } from '../vision/sensor-types';
import type {
  ContextStore,
  EquipmentKind,
  InteractionState,
  InputMode,
} from './interaction-context';

/** 같은 손동작을 이만큼 유지해야 한 번 발동한다. */
export const GESTURE_HOLD_MS = 600;

/** D만 등록하는 게임 단축키. */
export type GameKey = 'E' | 'F' | '1' | '2' | 'Escape';

export type CommandInput =
  | { type: 'EXCHANGE_REQUEST'; payload: { targetPlayerId: string } }
  | { type: 'EXCHANGE_ACCEPT'; payload: { exchangeId: string } }
  | { type: 'EXCHANGE_CANCEL'; payload: { exchangeId: string } }
  | { type: 'INSTALL'; payload: { kind: EquipmentKind } }
  | { type: 'INSTALL_CANCEL'; payload: { installationId: string } }
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
  | 'exit-cancel'
  | 'select-equipment'
  | null;

export interface GestureIntentController {
  observe(snapshot: SensorSnapshot, nowMs: number, runtimeGeneration: number): GestureAction;
  pressKey(key: GameKey): GestureAction;
  setMode(mode: InputMode): void;
  /** 문맥 변화·장애에서 hold를 비운다. */
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
  let heldFrameId: number | null = null;
  let firedFor: number | null = null;

  const clearHold = () => {
    heldKind = null;
    heldSince = null;
    heldFrameId = null;
    firedFor = null;
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
        return null;
      }
      const sample = snapshot.gesture;
      const usable =
        isSampleFresh(sample, 'gesture', nowMs) &&
        sample!.status === 'valid' &&
        sample!.data.kind !== 'none';
      if (!usable) {
        // 미검출·none·만료·관측 공백은 hold를 초기화한다.
        clearHold();
        return null;
      }
      const valid = sample!;
      const kind = valid.data.kind as 'palm' | 'victory';
      // 같은 Sample의 새 frameId만 유지 시간에 반영한다.
      if (valid.frameId === heldFrameId) return null;
      if (kind !== heldKind) {
        heldKind = kind;
        heldSince = nowMs;
        firedFor = null;
      }
      heldFrameId = valid.frameId;
      heldSince ??= nowMs;
      if (firedFor !== null) return null;
      if (nowMs - heldSince < holdMs) return null;
      firedFor = valid.frameId;

      if (!deps.context.acceptsInput) return null;
      if (blockedByChallenge()) return null;
      if (mode !== 'motion') return null;
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
      // 도망자의 F에는 제품 행동을 배정하지 않는다.
      if (key === 'F') return resolveInstall();
      return null;
    },

    setMode(next) {
      if (next === mode) return; // 같은 값 재적용은 callback을 반복하지 않는다.
      mode = next;
      clearHold();
      publishState();
    },

    reset() {
      clearHold();
    },

    get selectedEquipment() {
      return selectedEquipment;
    },
    get lastRequestId() {
      return lastRequestId;
    },
  };
}

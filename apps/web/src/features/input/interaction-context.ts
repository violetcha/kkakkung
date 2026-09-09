// D-11 / IN-09. 중앙 InteractionContext 보관과 무효화 판정.
// C가 만들어 준 full context를 교체 저장한다. D가 Zustand나 게임 Room에 직접 접근하지 않는다.
// 제품 결정 대기인 아이템 상태·슬롯·사용 명령은 여기에 추가하지 않는다.

export type Role = 'runner' | 'tagger';
export type PlayerStatus = 'ACTIVE' | 'ESCAPED' | 'CAPTURED';
export type EquipmentKind = 'sensor' | 'trap';
export type PoseKind = 'left' | 'right' | 'y';
export type InputMode = 'motion' | 'keyboard';

export type Phase =
  | 'LOBBY'
  | 'DEVICE_CHECK'
  | 'TEAM_PRACTICE'
  | 'MAP_FINALIZING'
  | 'GAME_LOADING'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'RESULT'
  | 'ABORTED';

export type InteractionContext = Readonly<{
  matchId: string;
  selfPlayerId: string;
  role: Role | null;
  phase: Phase;
  status: PlayerStatus;
  targetPlayerId?: string;
  incomingExchangeId?: string;
  outgoingExchangeId?: string;
  challengeId?: string;
  exitId?: string;
  poseKind?: PoseKind;
  selectedEquipment?: EquipmentKind;
  installationId?: string;
  mode: InputMode;
  pageActive: boolean;
}>;

export type InteractionState = Readonly<{
  selectedEquipment: EquipmentKind;
  mode: InputMode;
}>;

/** 이번 갱신에서 무엇이 사라졌는지. 해당 hold/timer를 지우는 근거다. */
export type ContextChange = Readonly<{
  matchChanged: boolean;
  roleChanged: boolean;
  modeChanged: boolean;
  /** 입력을 막아야 하는 상태로 바뀜: 비활성 탭, 비참가, challenge 시작 등. */
  inputLocked: boolean;
  exchangeInvalidated: boolean;
  challengeInvalidated: boolean;
  installationInvalidated: boolean;
  /** 위 중 하나라도 참이면 모든 pending hold를 버린다. */
  shouldClearHolds: boolean;
}>;

export interface ContextStore {
  set(next: InteractionContext): ContextChange;
  get(): InteractionContext | null;
  clear(): void;
  /** challenge 중에는 취소 외 일반 행동을 막는다. */
  readonly inChallenge: boolean;
  /** 입력을 받을 수 있는 상태인지. */
  readonly acceptsInput: boolean;
}

const ACTIVE_PHASES: readonly Phase[] = ['TEAM_PRACTICE', 'COUNTDOWN', 'PLAYING'];

function exchangeIdentity(context: InteractionContext | null): string {
  if (!context) return '';
  return `${context.incomingExchangeId ?? ''}|${context.outgoingExchangeId ?? ''}`;
}

export function createContextStore(): ContextStore {
  let current: InteractionContext | null = null;

  const acceptsInput = (context: InteractionContext | null): boolean => {
    if (!context) return false;
    if (!context.pageActive) return false;
    if (context.status !== 'ACTIVE') return false;
    return ACTIVE_PHASES.includes(context.phase);
  };

  return {
    set(next) {
      const previous = current;
      current = next;
      const matchChanged = previous !== null && previous.matchId !== next.matchId;
      const roleChanged = previous !== null && previous.role !== next.role;
      const modeChanged = previous !== null && previous.mode !== next.mode;
      // 교환 ID가 사라지거나 방향이 바뀌면 기존 pending을 폐기한다.
      const exchangeInvalidated =
        previous !== null && exchangeIdentity(previous) !== exchangeIdentity(next);
      const challengeInvalidated =
        previous !== null && (previous.challengeId ?? null) !== (next.challengeId ?? null);
      const installationInvalidated =
        previous !== null && (previous.installationId ?? null) !== (next.installationId ?? null);
      const wasAccepting = acceptsInput(previous);
      const inputLocked = wasAccepting && !acceptsInput(next);
      return {
        matchChanged,
        roleChanged,
        modeChanged,
        inputLocked,
        exchangeInvalidated,
        challengeInvalidated,
        installationInvalidated,
        shouldClearHolds:
          matchChanged ||
          roleChanged ||
          modeChanged ||
          inputLocked ||
          exchangeInvalidated ||
          challengeInvalidated ||
          installationInvalidated,
      };
    },

    get: () => current,

    clear() {
      current = null;
    },

    get inChallenge() {
      return typeof current?.challengeId === 'string' && current.challengeId.length > 0;
    },

    get acceptsInput() {
      return acceptsInput(current);
    },
  };
}

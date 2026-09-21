import type {
  Cell,
  Dir,
  KnownExit,
  MatchLayout,
  Phase,
  PlayerStatus,
  MatchTuning,
  PoseKind,
  Role,
  RosterEntry,
  WallFace,
} from './types.js';

// ---------------------------------------------------------------------------
// Product core contract (EXEC-CONTRACT-3): commands, outcomes, projections.
// The server adapter (B) converts wire messages to these and back. Core never
// reads wire, clocks, or SDKs.
// ---------------------------------------------------------------------------

export type Action = Readonly<{
  kind: 'move' | 'turn';
  from: Cell & Readonly<{ dir: Dir }>;
  to: Cell & Readonly<{ dir: Dir }>;
  startTick: number;
  endTick: number;
}>;

export type CommandCode =
  | 'INVALID_COMMAND'
  | 'PROTOCOL_MISMATCH'
  | 'WRONG_MATCH'
  | 'RATE_LIMITED'
  | 'INVALID_PHASE'
  | 'NOT_ACTIVE'
  | 'NOT_ALLOWED'
  | 'EXPIRED'
  | 'STALE_REQUEST'
  | 'NOT_READY'
  | 'QUEUE_FULL'
  | 'ROUND_ENDED'
  | 'CANCELED';

export type EquipmentKind = 'sensor' | 'trap';

export type CoreCommandPayloads = {
  MOVE_INTENT: { direction: 'forward' | 'back' | null };
  TURN: { direction: 'left' | 'right' };
  GRAB_INTENT: Record<string, never>;
  EXCHANGE_REQUEST: { targetPlayerId: string };
  EXCHANGE_ACCEPT: { exchangeId: string };
  EXCHANGE_CANCEL: { exchangeId: string };
  INSTALL: { kind: EquipmentKind };
  INSTALL_CANCEL: { installationId: string };
  EXIT_START: { exitId: string };
  EXIT_CANCEL: { challengeId: string };
  EXIT_PROGRESS: { challengeId: string; method: 'pose' | 'keys'; completed: boolean };
};

export type CoreCommandType = keyof CoreCommandPayloads;

/** A command already accepted by the server, with the authenticated actor injected. */
export type CoreCommand<K extends CoreCommandType = CoreCommandType> = {
  [T in K]: Readonly<{
    matchId: string;
    requestId: string;
    sequence: number;
    type: T;
    payload: CoreCommandPayloads[T];
    actorId: string;
  }>;
}[K];

export type AbortReason =
  'GAME_CONNECTION_LOST' | 'SERVER_TICK_OVERLOAD' | 'MEDIA_POLICY_UNCERTAIN' | 'MEDIA_UNAVAILABLE';

export type ControlIntent =
  | Readonly<{ type: 'EXPIRE_MOVE'; playerId: string; sequence: number }>
  | Readonly<{ type: 'CONNECTION_LOST'; playerId: string }>
  | Readonly<{ type: 'ABORT_MATCH'; reason: AbortReason }>
  | Readonly<{ type: 'START_PLAYING'; startTick: number }>;

export type OutcomeResult =
  | Readonly<{ result: 'applied'; code: null }>
  | Readonly<{ result: 'rejected' | 'canceled'; code: CommandCode }>;

/** Exactly one per accepted command processed by a step. No stateVersion: B attaches it. */
export type CoreOutcome = Readonly<{
  matchId: string;
  requestId: string;
  sequence: number;
  tick: number;
  actorId: string;
}> &
  OutcomeResult;

export type ExchangeView = Readonly<{
  exchangeId: string;
  fromPlayerId: string;
  toPlayerId: string;
  direction: 'incoming' | 'outgoing';
  expiresAtTick: number;
}>;

export type InstallationView = Readonly<{
  installationId: string;
  kind: EquipmentKind;
  startTick: number;
  endTick: number;
  armedTick: number;
}>;

export type ChallengeView = Readonly<{
  challengeId: string;
  exitId: string;
  poseKind: PoseKind;
  startedAtTick: number;
  minSuccessTick: number;
  expiresAtTick: number;
}>;

export type LoadingView = Readonly<{
  loadId: string;
  initialViewVersion: number;
  mediaInstanceId: string;
  receiverGeneration: number;
  assetVersion: string;
}>;

export type OwnedEquipment = Readonly<{
  equipmentId: string;
  state: 'UNARMED' | 'ARMED' | 'SPENT';
  armedTick: number;
}> &
  (
    | Readonly<{ kind: 'sensor'; cell: Cell; wall: WallFace }>
    | Readonly<{ kind: 'trap'; cell: Cell }>
  );

export type ActiveSelf = Readonly<{
  playerId: string;
  role: Role;
  status: 'ACTIVE';
  cell: Cell;
  dir: Dir;
  action: Action | null;
  equipment: Readonly<{ sensor: number; trap: number }>;
  ownedEquipment: readonly OwnedEquipment[];
  restraintUntilTick: number | null;
  restraintImmuneUntilTick: number | null;
  installation: InstallationView | null;
  exchange: ExchangeView | null;
  challenge: ChallengeView | null;
  loading: LoadingView | null;
}>;

export type EndedSelf = Readonly<{ playerId: string; role: Role; status: 'ESCAPED' | 'CAPTURED' }>;

export type VisibleEntity =
  | Readonly<{
      id: string;
      kind: 'player';
      cell: Cell;
      dir: Dir;
      action: Action | null;
      role?: Role;
    }>
  | Readonly<{
      id: string;
      kind: 'sensor';
      cell: Cell;
      wall: WallFace;
      state: 'UNARMED' | 'ARMED';
    }>
  | Readonly<{ id: string; kind: 'trap'; cell: Cell; state: 'UNARMED' | 'ARMED' }>;

export type KnownTerrain =
  Readonly<Cell & { kind: 'floor' }> | Readonly<WallFace & { kind: 'wall' }>;

export type PlayerKnowledge = Readonly<{
  mapVersion: number;
  knownTerrain: readonly KnownTerrain[];
  knownActiveExits: readonly KnownExit[];
}>;

export type Counts = Readonly<{ escaped: number; captured: number }>;

export type RoundResult = Readonly<{
  winner: 'runners' | 'taggers';
  reason: 'two-escaped' | 'two-captured' | 'timeout';
}>;

export type TracePoint = Readonly<{ x: number; y: number }>;

export type EventPayloads = {
  EXCHANGE_OFFER: { exchangeId: string; fromPlayerId: string; expiresAtTick: number };
  EXCHANGE_CANCELED: { exchangeId: string; reason: CommandCode };
  EXCHANGE_COMPLETED: { exchangeId: string; mapVersion: number };
  HUNTER_MARKER: {
    markerId: string;
    kind: 'exchange' | 'sensor' | 'trap';
    point: TracePoint;
    occurredTick: number;
    showAtTick: number;
    expiresTick: number;
  };
  EXIT_CHALLENGE: ChallengeView;
  EXIT_CHALLENGE_ENDED: {
    challengeId: string;
    result: 'canceled' | 'failed' | 'escaped';
    reason: CommandCode | null;
  };
};

export type EventType = keyof EventPayloads;

export type SpatialSoundEvent = Readonly<{
  eventId: string;
  tick: number;
  kind: 'footstep' | 'sensor' | 'trap';
  cell: Cell;
  sourcePlayerId?: string;
}>;

export type DomainEvent =
  | {
      [K in EventType]: Readonly<{
        eventId: string;
        tick: number;
        audience: readonly string[];
        type: K;
        payload: EventPayloads[K];
      }>;
    }[EventType]
  | Readonly<{ type: 'SPATIAL_SOUND'; sound: SpatialSoundEvent }>;

export type MediaIntent =
  | Readonly<{
      type: 'RETIRE_PLAYER';
      playerId: string;
      reason: 'personal-ended' | 'connection-lost';
    }>
  | Readonly<{ type: 'RETIRE_INSTANCE'; reason: 'phase-change' | 'round-ended' | 'aborted' }>;

export type StepResult<State> = Readonly<{
  state: State;
  outcomes: readonly CoreOutcome[];
  events: readonly DomainEvent[];
  mediaIntents: readonly MediaIntent[];
}>;

export type StepInput = Readonly<{
  tick: number;
  commands: readonly CoreCommand[];
  controls: readonly ControlIntent[];
}>;

export type CreateMatchInput = Readonly<{
  matchId: string;
  gameInstanceId: string;
  seed: number;
  tuning: MatchTuning;
  layout: MatchLayout;
  players: readonly RosterEntry[];
}>;

export type CreatePracticeInput = CreateMatchInput & Readonly<{ role: Role }>;

export type GameSubject = Readonly<{
  playerId: string;
  role: Role;
  status: PlayerStatus;
  cell: Cell;
  dir: Dir;
  action: Action | null;
}>;

export type CoreReadFrame = Readonly<{
  matchId: string;
  gameInstanceId: string;
  tick: number;
  phase: Phase;
  counts: Counts;
  result: RoundResult | null;
  abortReason: AbortReason | null;
  participants: readonly GameSubject[];
}>;

export type VisibleSurfaces = Readonly<{
  visibleCells: readonly Cell[];
  visibleWallFaces: readonly WallFace[];
}>;

export interface CorePort<State> {
  createMatch(input: CreateMatchInput): State;
  createPractice(input: CreatePracticeInput): State;
  stepMatch(state: State, input: StepInput): StepResult<State>;
  getPlayerKnowledge(state: State, playerId: string): PlayerKnowledge;
  getVisibleEntities(state: State, playerId: string): readonly VisibleEntity[];
  getPlayerSelf(state: State, playerId: string): ActiveSelf | EndedSelf | null;
  getVisibleSurfaces(state: State, playerId: string): VisibleSurfaces;
  getFrame(state: State): CoreReadFrame;
}

// EXEC-CONTRACT-3. Planning contracts; product modules do not exist merely because these types do.
export const CONTRACT_VERSION = 'EXEC-CONTRACT-3' as const;
export const SCOPE_VERSION = 'D-2026-09-08-01' as const;
export type Cell = Readonly<{ x: number; y: number }>;
export type TracePoint = Readonly<{ x: number; y: number }>;
export type Dir = 0 | 1 | 2 | 3;
export type WallFace = Cell & Readonly<{ side: Dir }>;
export type Role = 'runner' | 'tagger';
export type SessionRequest = Readonly<{ nickname: string; inviteToken?: string }> &
  ({ createRoom: true; roomCode?: never } | { createRoom: false; roomCode: string });
export const SESSION_ACCESS_ROUTE = '/api/sessions/access' as const;
export type SessionAccessResponse = Readonly<{ method: 'invitation' | 'gitlab-sso' }>;
export type SessionResponse = Readonly<{
  sessionToken: string;
  playerId: string;
  roomCode: string;
  expiresAt: number;
  protocolVersion: '0.2.0';
}>;
// Owner-only cancellation before the first game connection; no identity in the body.
export const SESSION_CANCEL_ROUTE = '/api/sessions/current' as const;
export type SessionCancelErrorCode = 'INVALID_REQUEST' | 'INVALID_SESSION' | 'SESSION_IN_USE';
// Server/operator-only. These endpoints do not accept a player's session Bearer token.
export const INVITATION_ROUTES = {
  issue: '/api/operations/invitations',
  revoke: '/api/operations/invitations/:inviteId/revoke',
} as const;
export type InvitationScope = Readonly<{
  allowCreate: boolean;
  roomCodes: readonly string[];
}>;
export type IssueInvitation = Readonly<{ scope: InvitationScope; expiresAt: number }>;
export type IssuedInvitation = IssueInvitation &
  Readonly<{ inviteId: string; inviteToken: string }>;
export type InvitationDenialCode = 'INVALID_INVITATION' | 'NOT_READY' | 'OUTSIDE_PUBLIC_WINDOW';
export type InvitationIssueResult =
  | Readonly<{ status: 'issued'; invitation: IssuedInvitation }>
  | Readonly<{ status: 'rejected'; code: InvitationDenialCode }>;
export type InvitationCheck = Readonly<{ inviteToken: string }> &
  ({ createRoom: true; roomCode?: never } | { createRoom: false; roomCode: string });
export interface InvitationPort {
  issue(input: IssueInvitation): InvitationIssueResult;
  revoke(inviteId: string): void;
  verify(input: InvitationCheck): Readonly<{ inviteId: string }> | null;
  bindCreatedRoom(inviteId: string, roomCode: string): void;
}
export type PlayerStatus = 'ACTIVE' | 'ESCAPED' | 'CAPTURED';
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
export type EquipmentKind = 'sensor' | 'trap';
export type PoseKind = 'left' | 'right' | 'y';
export type Action = Readonly<{
  kind: 'move' | 'turn';
  from: Cell & { dir: Dir };
  to: Cell & { dir: Dir };
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
export type CommandPayloads = {
  MOVE_INTENT: { direction: 'forward' | 'back' | null };
  TURN: { direction: 'left' | 'right' };
  READY: { ready: boolean };
  PRACTICE_READY: { ready: boolean };
  LOAD_READY: { loadId: string; mediaInstanceId: string; receiverGeneration: number };
  EXCHANGE_REQUEST: { targetPlayerId: string };
  EXCHANGE_ACCEPT: { exchangeId: string };
  EXCHANGE_CANCEL: { exchangeId: string };
  INSTALL: { kind: EquipmentKind };
  INSTALL_CANCEL: { installationId: string };
  EXIT_START: { exitId: string };
  EXIT_CANCEL: { challengeId: string };
  EXIT_PROGRESS: { challengeId: string; method: 'pose' | 'keys'; completed: boolean };
  REMATCH: { mode: 'same' | 'swap' | 'lobby' };
};
export type CommandType = keyof CommandPayloads;
export type CommandEnvelope<K extends CommandType = CommandType> = {
  [T in K]: Readonly<{
    matchId: string;
    requestId: string;
    sequence: number;
    type: T;
    payload: CommandPayloads[T];
  }>;
}[K];
export type CommandReceipt = Readonly<{
  matchId: string;
  requestId: string;
  sequence: number;
  stateVersion: number;
}> &
  ({ status: 'accepted'; code: null } | { status: 'rejected'; code: CommandCode });
export type OutcomeResult =
  { result: 'applied'; code: null } | { result: 'rejected' | 'canceled'; code: CommandCode };
export type CommandOutcome = Readonly<{
  matchId: string;
  requestId: string;
  sequence: number;
  tick: number;
  stateVersion: number;
}> &
  OutcomeResult;
export type RequestStatus = Readonly<{ matchId: string; requestId: string }>;
export type RequestStatusResult = RequestStatus &
  ({ status: 'done'; outcome: CommandOutcome } | { status: 'pending' | 'unknown'; outcome: null });
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
  ({ kind: 'sensor'; cell: Cell; wall: WallFace } | { kind: 'trap'; cell: Cell });
export type ActiveSelf = Readonly<{
  playerId: string;
  role: Role;
  status: 'ACTIVE';
  cell: Cell;
  dir: Dir;
  action: Action | null;
  equipment: { sensor: number; trap: number };
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
  | Readonly<{ id: string; kind: 'sensor'; cell: Cell; wall: WallFace; state: 'UNARMED' | 'ARMED' }>
  | Readonly<{ id: string; kind: 'trap'; cell: Cell; state: 'UNARMED' | 'ARMED' }>;
export type KnownTerrain =
  Readonly<Cell & { kind: 'floor' }> | Readonly<WallFace & { kind: 'wall' }>;
export type KnownExit = Readonly<{
  exitId: string;
  ownerId: string;
  wall: WallFace;
  approach: Cell;
}>;
export type PlayerKnowledge = Readonly<{
  mapVersion: number;
  knownTerrain: readonly KnownTerrain[];
  knownActiveExits: readonly KnownExit[];
}>;
export type ActiveGameScope = Readonly<{
  gameInstanceId: string;
  kind: 'practice' | 'game';
  revision: number;
}>;
export type GameViewScope =
  ActiveGameScope | Readonly<{ gameInstanceId: null; kind: 'none'; revision: number }>;
export type PrivateView = PlayerKnowledge &
  Readonly<{
    matchId: string;
    gameScope: GameViewScope;
    stateVersion: number;
    self: ActiveSelf | EndedSelf | null;
    visibleCells: readonly Cell[];
    visibleWallFaces: readonly WallFace[];
    visibleEntities: readonly VisibleEntity[];
  }>;
export type Counts = Readonly<{ escaped: number; captured: number }>;
export type RoundResult = Readonly<{
  winner: 'runners' | 'taggers';
  reason: 'two-escaped' | 'two-captured' | 'timeout';
}>;
export type AbortReason =
  'GAME_CONNECTION_LOST' | 'SERVER_TICK_OVERLOAD' | 'MEDIA_POLICY_UNCERTAIN' | 'MEDIA_UNAVAILABLE';
export type PublicRoundState = Readonly<{
  phase: Phase;
  matchId: string;
  stateVersion: number;
  serverTick: number;
  startTick: number | null;
  startAt: number | null;
  deadlineTick: number | null;
  counts: Counts;
  result: RoundResult | null;
  abortReason: AbortReason | null;
}>;
export type RoomRoster = Readonly<{
  matchId: string;
  stateVersion: number;
  phase: Phase;
  hostId: string;
  players: readonly { playerId: string; nickname: string; ready: boolean; connected: boolean }[];
}>;
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
export type PrivateEvent = {
  [K in EventType]: Readonly<{
    matchId: string;
    gameScope: ActiveGameScope;
    eventId: string;
    tick: number;
    stateVersion: number;
    type: K;
    payload: EventPayloads[K];
  }>;
}[EventType];
export type GameHeartbeat = Readonly<{
  serverEpoch: string;
  matchId: string;
  heartbeatSeq: number;
  serverTick: number;
  serverTimeMs: number;
}>;
export type HeartbeatAck = Readonly<{ serverEpoch: string; matchId: string; heartbeatSeq: number }>;
export type ClockProbe = Readonly<{ probeId: string; clientSentAtMs: number }>;
export type ClockReply = ClockProbe &
  Readonly<{ serverReceivedAtMs: number; serverSentAtMs: number; serverEpoch: string }>;
export type ViewResync = Readonly<{ matchId: string; lastStateVersion: number }>;
export type CoreCommandType = Exclude<
  CommandType,
  'READY' | 'PRACTICE_READY' | 'LOAD_READY' | 'REMATCH'
>;
export type CoreCommand = CommandEnvelope<CoreCommandType> & Readonly<{ actorId: string }>;
export type ControlIntent =
  | Readonly<{ type: 'EXPIRE_MOVE'; playerId: string; sequence: number }>
  | Readonly<{ type: 'CONNECTION_LOST'; playerId: string }>
  | Readonly<{ type: 'ABORT_MATCH'; reason: AbortReason }>
  | Readonly<{ type: 'START_PLAYING'; startTick: number }>;
export type CoreOutcome = Omit<CommandOutcome, 'stateVersion' | 'result' | 'code'> &
  OutcomeResult &
  Readonly<{ actorId: string }>;
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
export type Topology = Readonly<{
  topologyVersion: string;
  width: number;
  height: number;
  walkable: readonly boolean[];
}>;
export type MatchLayout = Readonly<{
  layoutId: string;
  topology: Topology;
  players: readonly { playerId: string; role: Role; cell: Cell; dir: Dir }[];
  exits: readonly (KnownExit & { poseKind: PoseKind })[];
  territories: readonly { playerId: string; cells: readonly Cell[] }[];
}>;
export type MatchTuning = Readonly<{
  tuningVersion: string;
  tickMs: 50;
  moveTicks: 9;
  turnTicks: 6;
  roundTicks: 3600;
  installationTicks: 10;
  armTicks: 20;
  restraintTicks: 30;
  restraintImmunityTicks: 40;
  exchangeExpiryTicks: 40;
  exitMinimumTicks: 40;
  exitExpiryTicks: 160;
  exitRetryTicks: 10;
}>;
export type CreateMatchInput = Readonly<{
  matchId: string;
  gameInstanceId: string;
  seed: number;
  tuning: MatchTuning;
  layout: MatchLayout;
  players: readonly { playerId: string; role: Role }[];
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
export interface CorePort<State> {
  createMatch(input: CreateMatchInput): State;
  createPractice(input: CreatePracticeInput): State;
  stepMatch(
    state: State,
    input: { tick: number; commands: readonly CoreCommand[]; controls: readonly ControlIntent[] },
  ): StepResult<State>;
  getPlayerKnowledge(state: State, playerId: string): PlayerKnowledge;
  getVisibleEntities(state: State, playerId: string): readonly VisibleEntity[];
  getPlayerSelf(state: State, playerId: string): ActiveSelf | EndedSelf | null;
  getVisibleSurfaces(
    state: State,
    playerId: string,
  ): { visibleCells: readonly Cell[]; visibleWallFaces: readonly WallFace[] };
  getFrame(state: State): CoreReadFrame;
}
export type SelectionProgress = Readonly<{ attempted: number; batchAttempts: number }>;
export type LayoutSelectionResult =
  | Readonly<{ status: 'selected'; layout: MatchLayout; source: 'online' | 'fallback' }>
  | Readonly<{ status: 'unavailable'; code: 'LAYOUT_UNAVAILABLE' }>;
export type MapSource = Readonly<{
  templateId: string;
  templateVersion: string;
  templateHash: string;
  variantId: string;
}>;
export type SpawnRegion = Readonly<{
  regionId: string;
  cells: readonly Cell[];
  spawnCandidates: readonly Cell[];
}>;
export type LayoutTemplate = MapSource &
  Readonly<{
    topology: Topology;
    taggerRegions: readonly [SpawnRegion, SpawnRegion, SpawnRegion];
    runnerSpawnRegions: readonly [SpawnRegion, SpawnRegion, SpawnRegion];
    exitCandidates: readonly WallFace[];
  }>;
export type MapPreparationFailure = Readonly<{
  status: 'invalid';
  code: 'INVALID_MAP_SOURCE' | 'INVALID_TEMPLATE';
  path: readonly (string | number)[];
}>;
export type MapTemplateResult =
  Readonly<{ status: 'valid'; template: LayoutTemplate }> | MapPreparationFailure;
export type MapVariantsResult =
  Readonly<{ status: 'valid'; variants: readonly LayoutTemplate[] }> | MapPreparationFailure;
export interface MapPreparationPort {
  validateTemplate(raw: unknown, source: MapSource): MapTemplateResult;
  createTemplateVariants(template: LayoutTemplate): MapVariantsResult;
}
// Fixed, isolated practice layouts use role slots, never real session IDs in JSON.
export type PracticeLayoutTemplate = Readonly<{
  practiceVersion: string;
  layouts: Readonly<Record<Role, MatchLayout>>;
}>;
export type PracticeLayoutResult =
  | Readonly<{ status: 'ready'; layout: MatchLayout }>
  | Readonly<{
      status: 'invalid';
      code: 'INVALID_PRACTICE_LAYOUT';
      path: readonly (string | number)[];
    }>;
export interface PracticeLayoutPort {
  preparePracticeLayout(
    raw: unknown,
    players: readonly { playerId: string; role: Role }[],
    role: Role,
  ): PracticeLayoutResult;
}
// Stored layout IDs are tagger-1..3/runner-1..3 slots. certifyFallback binds all
// player/exit/territory references to role-sorted input.players before validation.
export type FallbackLayout = MapSource & Readonly<{ layout: MatchLayout }>;
export type LayoutSelectionInput = Readonly<{
  template: LayoutTemplate;
  players: readonly { playerId: string; role: Role }[];
  seed: number;
  maxAttempts: number;
  fallback: FallbackLayout;
}>;
export interface LayoutSelectionPort {
  certifyFallback(input: LayoutSelectionInput): LayoutSelectionResult;
  selectWithFallback(
    input: LayoutSelectionInput,
  ): Generator<SelectionProgress, LayoutSelectionResult, void>;
}
export type MediaScope = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  receiverGeneration: number;
}>;
export type MediaBinding = Readonly<{
  playerId: string;
  publisherGeneration: number;
  mediaIdentity: string;
  participantSid: string;
  faceTrackSid?: string;
  audioTrackSid?: string;
}>;
export type MediaBindings = MediaScope &
  Readonly<{ bindingRevision: number; participants: readonly MediaBinding[] }>;
export type AudioPolicy = MediaScope &
  Readonly<{
    publisherPermissions?: readonly Readonly<{
      participantIdentity: string;
      allowedTrackSids: readonly string[];
    }>[];
    policyRevision: number;
    bindingRevision: number;
    stateVersion: number;
    voices: readonly {
      playerId: string;
      trackSid: string;
      gain: number;
      azimuthRad: number;
      lowpassHz: number;
    }[];
    effects: readonly {
      eventId: string;
      kind: 'footstep' | 'sensor' | 'trap';
      gain: number;
      azimuthRad: number;
      lowpassHz: number;
      tick: number;
    }[];
  }>;
export type MediaGrant = MediaScope &
  Readonly<{
    subscriptionMode?: 'publisher-permissions';
    url: string;
    token: string;
    roomName: string;
    mediaIdentity: string;
    expiresAt: number;
  }>;
export type MediaGrantRequest = Readonly<{
  matchId: string;
  purpose: 'practice' | 'game';
  previousReceiverGeneration?: number;
}>;
export type MediaStatusReport = MediaScope &
  Readonly<{ status: 'ready' | 'recovering' | 'failed' | 'closed' }>;
export type MediaRefreshRequest = MediaScope & Readonly<{ lastBindingRevision: number }>;
export type MediaFailureCode =
  | 'NOT_READY'
  | 'WRONG_SCOPE'
  | 'BUDGET_EXHAUSTED'
  | 'RETIREMENT_UNCONFIRMED'
  | 'POLICY_UNKNOWN'
  | 'REMOTE_UNAVAILABLE'
  | 'STALE_GENERATION'
  | 'TIMEOUT';
export type PrepareGenerationRequest = Readonly<{
  requestId: string;
  matchId: string;
  playerId: string;
  mediaInstanceId: string;
  purpose: 'practice' | 'game';
  expectedPreviousGeneration: number | null;
}>;
export type PreparationResult = Readonly<{
  requestId: string;
  matchId: string;
  playerId: string;
  mediaInstanceId: string;
}> &
  (
    | { status: 'ready'; receiverGeneration: number; grant: MediaGrant; code: null }
    | { status: 'unknown'; receiverGeneration: number; grant: null; code: MediaFailureCode }
    | { status: 'rejected'; receiverGeneration: number | null; grant: null; code: MediaFailureCode }
  );
export type RetireGenerationRequest = MediaScope &
  Readonly<{
    requestId: string;
    playerId: string;
    reason:
      | 'phase-change'
      | 'personal-ended'
      | 'connection-lost'
      | 'policy-unknown'
      | 'round-ended'
      | 'reconnect'
      | 'shutdown';
  }>;
export type RetirementResult = RetireGenerationRequest &
  ({ status: 'confirmed'; code: null } | { status: 'unknown'; code: MediaFailureCode });
export type TrustedMediaFrame = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  instancePurpose: 'practice' | 'game';
  frameRevision: number;
  tick: number;
  phase: Phase;
  topology: Topology;
  participants: readonly GameSubject[];
  events: readonly SpatialSoundEvent[];
}>;
export type SpatialSoundEvent = Readonly<{
  eventId: string;
  tick: number;
  kind: 'footstep' | 'sensor' | 'trap';
  cell: Cell;
  sourcePlayerId?: string;
}>;
export type MediaControl =
  | Readonly<{ type: 'MEDIA_PREPARED'; result: PreparationResult }>
  | Readonly<{ type: 'MEDIA_RETIRED'; result: RetirementResult }>
  | Readonly<
      MediaScope & {
        type: 'MEDIA_FAILED';
        eventId: string;
        playerId: string;
        code: MediaFailureCode;
      }
    >;
export type Readiness = Readonly<{
  state: 'READY' | 'RECOVERING' | 'LOCKED';
  reasonCodes: readonly string[];
  historyComplete: boolean;
  unresolvedCount: number;
}>;
export type MediaInitializationResult =
  | Readonly<{
      status: 'initialized';
      readiness: Readiness & Readonly<{ state: 'RECOVERING' | 'LOCKED' }>;
      admission: 'DRAINING';
    }>
  | Readonly<{ status: 'fatal'; code: 'WRITER_CONFLICT' | 'INITIALIZATION_FAILED' }>;
export interface MediaCoordinator {
  initialize(): Promise<MediaInitializationResult>;
  prepareGeneration(input: PrepareGenerationRequest): Promise<PreparationResult>;
  observeFrame(frame: TrustedMediaFrame): void;
  retireGeneration(input: RetireGenerationRequest): Promise<RetirementResult>;
  handleWebhook(
    rawBody: string,
    authorization: string,
  ): Promise<{ status: 'accepted' | 'ignored' }>;
  getReadiness(): Readiness;
  getOperations(): OperationsPort;
  close(): Promise<void>;
}
export type MediaCoordinatorDeps = Readonly<{
  config: MediaConfiguration;
  emitMetric: (sample: MetricSample) => void;
  enqueueControl: (control: MediaControl) => void;
  enqueueBindings: (playerId: string, message: MediaBindings) => void;
  enqueueAudioPolicy: (playerId: string, message: AudioPolicy) => void;
  monotonicNow: () => number;
  epochNowSeconds: () => number;
  getGameActivity: () => Readonly<{
    activeMatches: number;
    activePractices: number;
    pendingAdmissions: number;
  }>;
}>;
export type MediaConfiguration = Readonly<{
  operatingMode?: 'attested' | 'continuous';
  httpUrl: string;
  wsUrl: string;
  apiKey: string;
  apiSecret: string;
  namespace: string;
  opsDataDir: string;
  projectAlias: string;
  publicWindow:
    | Readonly<{ opensAtEpochMs: number; closesAtEpochMs: number }>
    | Readonly<{ mode: 'continuous' }>
    | null;
  officialBudgetMaxAgeMs: number;
  operationTimeoutMs: number;
  productSecurityReady: boolean;
  initialBudget: {
    remainingMinutes: number;
    remainingBytes: number;
    checkedAtEpochMs: number;
  } | null;
  maxConcurrentParticipants: number;
  maxNormalApiCallsPer60s: number;
  maxTotalApiCallsPer60s: number;
}>;
export type CreateMediaCoordinator = (deps: MediaCoordinatorDeps) => MediaCoordinator;
export type MetricSample = Readonly<{
  name: string;
  value: number;
  unit: 'count' | 'ms' | 'bytes' | 'ratio';
  atMs: number;
  matchRef?: string;
  generation?: number;
  requestId?: string;
}>;
// E implements the authentication factory; B mounts it before every operator route.
// This is server-internal configuration, never a client-authorized claim.
export type CreateOperatorAuth = (token: string) => (authorization: string | undefined) => boolean;
export type NormalizedLandmark = Readonly<{ x: number; y: number; z: number }>;
export type FaceSensor = Readonly<{
  landmarks: readonly NormalizedLandmark[];
  yawRad: number;
  quality: 'valid' | 'uncertain' | 'missing';
}>;
export type PoseSensor = Readonly<{
  landmarks: readonly (NormalizedLandmark & { visibility: number })[];
  quality: 'valid' | 'uncertain' | 'missing';
}>;
export type GestureSensor = Readonly<{ kind: 'palm' | 'victory' | 'none'; score: number }>;
export type Sample<T> = Readonly<{ frameId: number; sampledAtMs: number; receivedAtMs: number }> &
  ({ status: 'valid'; data: T } | { status: 'missing'; data: null });
export type SensorSnapshot = Readonly<{
  runtimeGeneration: number;
  emittedAtMs: number;
  face: Sample<FaceSensor> | null;
  pose: Sample<PoseSensor> | null;
  gesture: Sample<GestureSensor> | null;
}>;
export type DeviceStatus = Readonly<{
  camera: 'idle' | 'requesting' | 'ready' | 'failed';
  microphone: 'off' | 'requesting' | 'ready' | 'denied' | 'failed';
  vision: 'idle' | 'loading' | 'ready' | 'failed';
  calibration: 'idle' | 'running' | 'ready' | 'failed';
  audioPlayback: 'locked' | 'ready' | 'failed';
  errorCode: string | null;
}>;
export type MediaStatus = Readonly<{
  matchId: string | null;
  mediaInstanceId: string | null;
  receiverGeneration: number | null;
  state: 'idle' | 'connecting' | 'connected' | 'recovering' | 'closed' | 'failed';
  code: string | null;
}>;
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
  mode: 'motion' | 'keyboard';
  pageActive: boolean;
}>;
export type InteractionState = Readonly<{
  selectedEquipment: EquipmentKind;
  mode: 'motion' | 'keyboard';
}>;
export type FaceTrackEvent = MediaScope &
  Readonly<{
    playerId: string;
    publisherGeneration: number;
    trackSid: string;
    element: HTMLVideoElement | null;
  }>;
export type CommandInput = {
  [K in CommandType]: { type: K; payload: CommandPayloads[K] };
}[CommandType];
export type InteractionDeps = Readonly<{
  sendCommand: (command: CommandInput) => string;
  requestMediaGrant: (request: MediaGrantRequest) => Promise<MediaGrant>;
  reportMediaStatus: (report: MediaStatusReport) => Promise<void>;
  requestBindingsRefresh: (request: MediaRefreshRequest) => void;
  onDeviceStatus: (status: DeviceStatus) => void;
  onFaceTrack: (event: FaceTrackEvent) => void;
  onMediaStatus: (status: MediaStatus) => void;
  onSensors: (snapshot: SensorSnapshot) => void;
  onInteractionState: (state: InteractionState) => void;
  onLocalPreview: (element: HTMLVideoElement | null) => void;
}>;
export interface InteractionRuntime {
  startDevices(input: { microphone: boolean }): Promise<DeviceStatus>;
  calibrate(): Promise<DeviceStatus>;
  setContext(context: InteractionContext): void;
  connectMedia(grant: MediaGrant): Promise<void>;
  applyAudioPolicy(policy: AudioPolicy): void;
  applyMediaBindings(bindings: MediaBindings): void;
  setQualityPreset(preset: 'medium' | 'low'): void;
  retireMediaGeneration(): Promise<void>;
  endParticipation(): Promise<void>;
  dispose(): Promise<void>;
}
export type CreateInteractionRuntime = (deps: InteractionDeps) => InteractionRuntime;
export type OperationsCommand =
  | Readonly<{ requestId: string; action: 'drain' | 'resume' | 'checkpoint' }>
  | Readonly<{ requestId: string; action: 'retry-retirement'; retirementId: string }>;
export type OperationSnapshot = Readonly<{
  requestId: string;
  operationId: string;
  action: OperationsCommand['action'];
  status: 'pending' | 'succeeded' | 'failed';
  code: string | null;
  updatedAtEpochMs: number;
}>;
export type OperationsStatus = Readonly<{
  /** Absent means legacy attested operation; continuous balances remain unknown (null). */
  operatingMode?: 'attested' | 'continuous';
  admission: 'OPEN' | 'DRAINING' | 'LOCKED';
  readiness: Readiness['state'];
  unresolvedCount: number;
  remainingMinutes: number | null;
  remainingBytes: number | null;
  checkedAtEpochMs: number | null;
}>;
export type OperationSubmission =
  | Readonly<{ status: 'accepted'; snapshot: OperationSnapshot }>
  | Readonly<{ status: 'conflict'; code: 'REQUEST_ID_CONFLICT' }>;
export interface OperationsPort {
  submit(command: OperationsCommand): OperationSubmission;
  getSnapshot(requestId: string): OperationSnapshot | null;
  getStatus(): OperationsStatus;
}
export type OfficialBudgetCheckpoint = Readonly<{
  projectAlias: string;
  remainingMinutes: number;
  remainingBytes: number;
  checkedAtEpochMs: number;
  source: 'cloud-dashboard';
  checkedBy: string;
}>;
export type ClientMessages = {
  command: CommandEnvelope;
  'request-status': RequestStatus;
  'view-resync': ViewResync;
  'game-heartbeat-ack': HeartbeatAck;
  'clock-probe': ClockProbe;
  'media-bindings-refresh': MediaRefreshRequest;
};
export type ServerMessages = {
  'command-result': CommandReceipt;
  'command-outcome': CommandOutcome;
  'request-status-result': RequestStatusResult;
  'room-roster': RoomRoster;
  'private-view': PrivateView;
  'private-event': PrivateEvent;
  'game-heartbeat': GameHeartbeat;
  'clock-reply': ClockReply;
  'media-bindings': MediaBindings;
  'audio-policy': AudioPolicy;
};

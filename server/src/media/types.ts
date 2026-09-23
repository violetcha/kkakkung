// Server-owned structural implementation of EXEC-CONTRACT-3. No runtime docs dependency.
export type Cell = Readonly<{ x: number; y: number }>;
export type Dir = 0 | 1 | 2 | 3;
export type Role = 'runner' | 'tagger';
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
export type Action = Readonly<{
  kind: 'move' | 'turn';
  from: Cell & { dir: Dir };
  to: Cell & { dir: Dir };
  startTick: number;
  endTick: number;
}>;
export type Topology = Readonly<{
  topologyVersion: string;
  width: number;
  height: number;
  walkable: readonly boolean[];
}>;
export type GameSubject = Readonly<{
  playerId: string;
  role: Role;
  status: PlayerStatus;
  cell: Cell;
  dir: Dir;
  action: Action | null;
}>;
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
  /** Present when the face has a distinct, server-verified publisher in this receiver room. */
  facePublisher?: Readonly<{ mediaIdentity: string; participantSid: string }>;
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
    subscriptionMode?: 'publisher-permissions' | 'server-forwarding';
    /** Only server-forwarding: CAMERA-only source, distinct from the MIC/receive room. */
    facePublication?: Readonly<{
      url: string;
      token: string;
      roomName: string;
      mediaIdentity: string;
    }>;
    url: string;
    token: string;
    roomName: string;
    mediaIdentity: string;
    expiresAt: number;
  }>;
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
/** S15P21C204-269. An ended runner listening from a surviving runner's position. */
export type SpectatorLink = Readonly<{ playerId: string; targetId: string }>;
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
  /** Ended runners still receiving media through their target's ears and eyes (269). */
  spectators?: readonly SpectatorLink[];
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
  emitEvent?: (event: import('../observability/StructuredEvents.js').StructuredEvent) => void;
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
  subscriptionMode?: 'server-controlled' | 'publisher-permissions' | 'server-forwarding';
  httpUrl: string;
  wsUrl: string;
  apiKey: string;
  apiSecret: string;
  namespace: string;
  opsDataDir: string;
  projectAlias: string;
  operatingMode?: 'attested' | 'continuous';
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
  /** S15P21C204-364. Monthly participant-minute guard; absent or null leaves it off. */
  monthlyUsage?: import('./MonthlyUsageMeter.js').MonthlyUsageConfig | null;
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
export type CreateOperatorAuth = (token: string) => (authorization: string | undefined) => boolean;
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
  /** Absent means the legacy, manually attested budget policy. */
  operatingMode?: 'attested' | 'continuous';
  admission: 'OPEN' | 'DRAINING' | 'LOCKED';
  readiness: Readiness['state'];
  unresolvedCount: number;
  remainingMinutes: number | null;
  remainingBytes: number | null;
  checkedAtEpochMs: number | null;
  /**
   * S15P21C204-364. The LiveKit monthly guard, when configured. Separate from `remainingMinutes`,
   * which the continuous release gate requires to stay null (no official balance is claimed).
   */
  monthlyUsage?: import('./MonthlyUsageMeter.js').MonthlyUsageSnapshot;
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

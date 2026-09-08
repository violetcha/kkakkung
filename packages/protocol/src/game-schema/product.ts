/**
 * Product (0.2.0) public match state and recipient-private view types.
 *
 * These mirror EXEC-CONTRACT-3 for the wire between the web client and the game server.
 * The public Colyseus schema carries only round-level metadata. Terrain, players, exits,
 * seed and tuning never enter this schema; recipients receive their own `private-view`.
 *
 * Nullable fields: @colyseus/schema transmits `null` primitives as an absent field, so a
 * decoded client state reports `undefined`. Use {@link readPublicRoundState} to normalize.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { PRODUCT_PROTOCOL_VERSION } from '../version.js';

export type Cell = Readonly<{ x: number; y: number }>;
export type TracePoint = Readonly<{ x: number; y: number }>;
export type Dir = 0 | 1 | 2 | 3;
export type WallFace = Cell & Readonly<{ side: Dir }>;
export type Role = 'runner' | 'tagger';
export type PlayerStatus = 'ACTIVE' | 'ESCAPED' | 'CAPTURED';
export const PHASES = [
  'LOBBY',
  'DEVICE_CHECK',
  'TEAM_PRACTICE',
  'MAP_FINALIZING',
  'GAME_LOADING',
  'COUNTDOWN',
  'PLAYING',
  'RESULT',
  'ABORTED',
] as const;
export type Phase = (typeof PHASES)[number];
export type EquipmentKind = 'sensor' | 'trap';
export type PoseKind = 'left' | 'right' | 'y';
export type Action = Readonly<{
  kind: 'move' | 'turn';
  from: Cell & { dir: Dir };
  to: Cell & { dir: Dir };
  startTick: number;
  endTick: number;
}>;
export type Counts = Readonly<{ escaped: number; captured: number }>;
export type RoundResult = Readonly<{
  winner: 'runners' | 'taggers';
  reason: 'two-escaped' | 'two-captured' | 'timeout';
}>;
export const ABORT_REASONS = [
  'GAME_CONNECTION_LOST',
  'SERVER_TICK_OVERLOAD',
  'MEDIA_POLICY_UNCERTAIN',
  'MEDIA_UNAVAILABLE',
] as const;
export type AbortReason = (typeof ABORT_REASONS)[number];
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
export type RoomRoster = Readonly<{
  matchId: string;
  stateVersion: number;
  phase: Phase;
  hostId: string;
  players: readonly { playerId: string; nickname: string; ready: boolean; connected: boolean }[];
}>;

export const RoundCounts = schema(
  {
    escaped: t.uint8().default(0),
    captured: t.uint8().default(0),
  },
  'RoundCounts',
);
export type RoundCounts = SchemaType<typeof RoundCounts>;

export const RoundResultState = schema(
  {
    /** Empty strings mean "no result yet"; the schema cannot carry a null child reliably. */
    winner: t.string<RoundResult['winner'] | ''>().default(''),
    reason: t.string<RoundResult['reason'] | ''>().default(''),
  },
  'RoundResultState',
);
export type RoundResultState = SchemaType<typeof RoundResultState>;

/** Public, non-personal round metadata. No terrain, players, exits, seed or tuning. */
export const PublicMatchState = schema(
  {
    protocolVersion: t.string().default(PRODUCT_PROTOCOL_VERSION),
    phase: t.string<Phase>().default('LOBBY'),
    matchId: t.string().default(''),
    stateVersion: t.number().default(0),
    serverTick: t.number().default(0),
    /** Match-relative tick; absent (undefined on the client) until PLAYING. */
    startTick: t.number(),
    /** Server monotonic ms; absent until COUNTDOWN selects it. */
    startAt: t.number(),
    deadlineTick: t.number(),
    counts: t.ref(RoundCounts),
    result: t.ref(RoundResultState),
    abortReason: t.string<AbortReason>(),
  },
  'PublicMatchState',
);
export type PublicMatchState = SchemaType<typeof PublicMatchState>;

const nullable = <T>(value: T | null | undefined): T | null =>
  value === undefined || value === null ? null : value;

/** Normalizes a decoded (or server-side) schema into the contract's nullable shape. */
export function readPublicRoundState(state: {
  phase: string;
  matchId: string;
  stateVersion: number;
  serverTick: number;
  startTick?: number | null;
  startAt?: number | null;
  deadlineTick?: number | null;
  counts?: { escaped: number; captured: number } | null;
  result?: { winner: string; reason: string } | null;
  abortReason?: string | null;
}): PublicRoundState {
  const result = nullable(state.result);
  return {
    phase: state.phase as Phase,
    matchId: state.matchId,
    stateVersion: state.stateVersion,
    serverTick: state.serverTick,
    startTick: nullable(state.startTick),
    startAt: nullable(state.startAt),
    deadlineTick: nullable(state.deadlineTick),
    counts: {
      escaped: state.counts?.escaped ?? 0,
      captured: state.counts?.captured ?? 0,
    },
    result:
      result && result.winner && result.reason
        ? {
            winner: result.winner as RoundResult['winner'],
            reason: result.reason as RoundResult['reason'],
          }
        : null,
    abortReason: nullable(state.abortReason) as AbortReason | null,
  };
}

/** Field names permitted in the public schema. Used by payload leak tests. */
export const PUBLIC_MATCH_STATE_FIELDS = [
  'protocolVersion',
  'phase',
  'matchId',
  'stateVersion',
  'serverTick',
  'startTick',
  'startAt',
  'deadlineTick',
  'counts',
  'result',
  'abortReason',
] as const;

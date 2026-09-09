export const MAZE_SIZE = 32;

/** 0=north (y-1), 1=east (x+1), 2=south (y+1), 3=west (x-1). Shared by development and product code. */
export type Dir = 0 | 1 | 2 | 3;

export type Role = 'runner' | 'tagger';

// ---------------------------------------------------------------------------
// Development types. Used by the 0-stage KkakkungRoom through server/src/domain
// until consumers move to the product contract. Do not extend these for product
// rules; product code below never reads GameSnapshot/PlayerState.
// ---------------------------------------------------------------------------

export type LegacyPlayerStatus = 'alive' | 'escaped' | 'captured';
export type LegacyPhase = 'waiting' | 'prep' | 'countdown' | 'playing' | 'result';
export type MoveDir = 'forward' | 'back';
export type TurnDir = 'left' | 'right';

export interface PlayerState {
  id: string;
  role: Role;
  x: number;
  y: number;
  dir: Dir;
  status: LegacyPlayerStatus;
  trapped: boolean;
  /** Server time of the last accepted move, reserved for movement cooldown rules. */
  lastMoveAt: number;
}

export interface GameSnapshot {
  phase: LegacyPhase;
  tick: number;
  timeLeft: number;
  /** 32*32 grid, where 0 is open and 1 is a wall. */
  maze: Uint8Array | number[];
  players: Map<string, PlayerState>;
}

export interface RuleResult {
  ok: boolean;
  reason?: string;
}

export interface CaptureEvent {
  taggerId: string;
  runnerId: string;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Product types (EXEC-CONTRACT-3). Integer cell coordinates x/y in 0..31,
// Dir 0 north / 1 east / 2 south / 3 west. Server-only: the web receives only
// per-recipient projections that the server builds from these values.
// ---------------------------------------------------------------------------

export type Cell = Readonly<{ x: number; y: number }>;

/**
 * A wall face. `x`/`y` are the wall cell and `side` points from the wall toward
 * the passage cell that touches the face (the approach cell).
 */
export type WallFace = Cell & Readonly<{ side: Dir }>;

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

export type PoseKind = 'left' | 'right' | 'y';

/** Server-only walkable grid. `walkable[y * width + x]` is true for passage cells. */
export type Topology = Readonly<{
  topologyVersion: string;
  width: number;
  height: number;
  walkable: readonly boolean[];
}>;

export type KnownExit = Readonly<{
  exitId: string;
  ownerId: string;
  wall: WallFace;
  approach: Cell;
}>;

export type LayoutExit = KnownExit & Readonly<{ poseKind: PoseKind }>;

export type LayoutPlayer = Readonly<{ playerId: string; role: Role; cell: Cell; dir: Dir }>;

export type LayoutTerritory = Readonly<{ playerId: string; cells: readonly Cell[] }>;

/** A fully selected match placement. The server injects it into match creation. */
export type MatchLayout = Readonly<{
  layoutId: string;
  topology: Topology;
  players: readonly LayoutPlayer[];
  exits: readonly LayoutExit[];
  territories: readonly LayoutTerritory[];
}>;

/** Origin of a template variant. templateHash is the SHA-256 of the original file bytes computed by the server loader. */
export type MapSource = Readonly<{
  templateId: string;
  templateVersion: string;
  templateHash: string;
  variantId: string;
}>;

/** A tagger territory or runner start area with its own start candidates. Cells are sorted by y then x. */
export type SpawnRegion = Readonly<{
  regionId: string;
  cells: readonly Cell[];
  spawnCandidates: readonly Cell[];
}>;

/** One normalized, deeply frozen template variant. Produced only by validateTemplate/transform. */
export type LayoutTemplate = MapSource &
  Readonly<{
    topology: Topology;
    taggerRegions: readonly [SpawnRegion, SpawnRegion, SpawnRegion];
    runnerSpawnRegions: readonly [SpawnRegion, SpawnRegion, SpawnRegion];
    exitCandidates: readonly WallFace[];
  }>;

/** Stored layout whose player IDs are the stable slots tagger-1..3 / runner-1..3. */
export type FallbackLayout = MapSource & Readonly<{ layout: MatchLayout }>;

export type RosterEntry = Readonly<{ playerId: string; role: Role }>;

export type LayoutSelectionInput = Readonly<{
  template: LayoutTemplate;
  players: readonly RosterEntry[];
  seed: number;
  maxAttempts: number;
  fallback: FallbackLayout;
}>;

export type SelectionProgress = Readonly<{ attempted: number; batchAttempts: number }>;

export type LayoutSelectionResult =
  | Readonly<{ status: 'selected'; layout: MatchLayout; source: 'online' | 'fallback' }>
  | Readonly<{ status: 'unavailable'; code: 'LAYOUT_UNAVAILABLE' }>;

/** Tick-based rule constants. The server injects these; core never reads files or clocks. */
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

/** Placement constraints. Distances count path moves between cells (edges), not visited cells. */
export type LayoutConstraints = Readonly<{
  minRunnerDistance: number;
  minRunnerTaggerDistance: number;
  minExitDistance: number;
  minExitPathLength: number;
  maxExitPathLength: number;
  maxExitRatio: number;
  minSpawnNeighbors: number;
}>;

/** Computation budget for online layout selection. Versioned, not a balance value. */
export type SelectionBudget = Readonly<{
  maxAttempts: number;
  onlineMapBudgetMs: number;
  attemptsPerBatch: number;
}>;

export type MatchTuningConfig = Readonly<{
  tuningVersion: string;
  match: MatchTuning;
  layout: LayoutConstraints;
  selection: SelectionBudget;
}>;

// ---------------------------------------------------------------------------
// Map preparation and practice ports (EXEC-CONTRACT-3).
// ---------------------------------------------------------------------------

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

/** Fixed, isolated practice layouts use role slots, never real session IDs in JSON. */
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
    players: readonly RosterEntry[],
    role: Role,
  ): PracticeLayoutResult;
}

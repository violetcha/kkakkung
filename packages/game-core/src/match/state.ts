import type {
  Action,
  ChallengeView,
  Counts,
  ExchangeView,
  InstallationView,
  OwnedEquipment,
  RoundResult,
  AbortReason,
  VisibleSurfaces,
} from './core-types.js';
import type { PendingInstallations } from './equipment/types.js';
import type { ExchangeSessions } from './exchange/session.js';
import type { PendingTraces } from './exchange/trace.js';
import type { ExitRegistry } from './exits/registry.js';
import type { PriorityOrder } from './priority.js';
import type {
  Cell,
  DeadlineMode,
  Dir,
  MatchLayout,
  Phase,
  PlayerStatus,
  MatchTuning,
  Role,
} from './types.js';

/** Single-shot next action waiting for the current action to finish (RL-03). */
export type PendingTurn = Readonly<{ direction: 'left' | 'right'; sequence: number }>;

/** Held movement intent refreshed by the client at 10Hz; B expires it via EXPIRE_MOVE. */
export type HeldMove = Readonly<{ direction: 'forward' | 'back'; sequence: number }>;

export type PlayerRecord = Readonly<{
  playerId: string;
  role: Role;
  status: PlayerStatus;
  cell: Cell;
  dir: Dir;
  action: Action | null;
  nextAction: PendingTurn | null;
  heldMove: HeldMove | null;
  connected: boolean;
  restraintUntilTick: number | null;
  restraintImmuneUntilTick: number | null;
  equipment: Readonly<{ sensor: number; trap: number }>;
  ownedEquipment: readonly OwnedEquipment[];
  installation: InstallationView | null;
  exchange: ExchangeView | null;
  challenge: ChallengeView | null;
  /** Earliest tick a new exit challenge may start (EX-02 retry gate). */
  nextAttemptTick: number | null;
}>;

/** Per-player terrain memory. Keys: floors = y*width+x, walls = (y*width+x)*4+side. */
export type KnowledgeRecord = Readonly<{
  floors: ReadonlySet<number>;
  walls: ReadonlySet<number>;
  discoveredExits: ReadonlySet<string>;
  mapVersion: number;
}>;

export type MatchMode = 'game' | 'practice';

/**
 * Immutable authoritative match state. Large shared data (layout/topology) is
 * referenced, never copied; steps copy only the maps they change.
 */
export type MatchState = Readonly<{
  matchId: string;
  gameInstanceId: string;
  mode: MatchMode;
  seed: number;
  tuning: MatchTuning;
  layout: MatchLayout;
  phase: Phase;
  /**
   * S15P21C204-316. Whether this match runs to the tuned round length. `'none'` is the demo
   * harness: `START_PLAYING` leaves `deadlineTick` null so the round ends only by two captures,
   * two escapes or an abort. It is also the flag that admits `PLACE_PLAYER`; an ordinary match
   * is always `'round'` and refuses that control.
   */
  deadline: DeadlineMode;
  /** Last processed tick, or null before the first step. */
  tick: number | null;
  startTick: number | null;
  deadlineTick: number | null;
  players: ReadonlyMap<string, PlayerRecord>;
  /** Player ids in default string order for deterministic iteration. */
  order: readonly string[];
  priority: PriorityOrder | null;
  exits: ExitRegistry;
  counts: Counts;
  result: RoundResult | null;
  abortReason: AbortReason | null;
  knowledge: ReadonlyMap<string, KnowledgeRecord>;
  visibility: ReadonlyMap<string, VisibleSurfaces>;
  /** Open map exchange sessions keyed by exchangeId (KN-05). */
  exchanges: ExchangeSessions;
  exchangeSeq: number;
  /** Delayed tagger traces waiting for their publish tick (KN-08). */
  traces: PendingTraces;
  /** Installations in progress keyed by installationId (EQ-01). */
  installations: PendingInstallations;
  installationSeq: number;
  challengeSeq: number;
  eventSeq: number;
}>;

export function isTerminal(state: MatchState): boolean {
  return state.phase === 'RESULT' || state.phase === 'ABORTED';
}

export function commandPhase(state: MatchState): Phase {
  return state.mode === 'practice' ? 'TEAM_PRACTICE' : 'PLAYING';
}

export function withPlayer(state: MatchState, player: PlayerRecord): MatchState {
  const players = new Map(state.players);
  players.set(player.playerId, player);
  return { ...state, players };
}

export function withPlayers(state: MatchState, updated: Iterable<PlayerRecord>): MatchState {
  const players = new Map(state.players);
  for (const player of updated) players.set(player.playerId, player);
  return { ...state, players };
}

export const EMPTY_SURFACES: VisibleSurfaces = Object.freeze({
  visibleCells: Object.freeze([]),
  visibleWallFaces: Object.freeze([]),
});

/**
 * Server-only match context: process epoch, current matchId, continuous stateVersion and
 * serverTick, monotonic start time, tuning version and the logical game-space registry
 * (per-participant GameViewScope). Seed, tuning values and layouts never leave this module
 * into the public schema.
 */
import { randomUUID } from 'node:crypto';
import type { ActiveGameScope, GameViewScope, Role } from '@kkakkung/protocol/game-schema';
import type { MatchTuning } from './ports.js';

export type ScopeKind = ActiveGameScope['kind'];
export type LogicalInstance = Readonly<{
  gameInstanceId: string;
  kind: ScopeKind;
  /** Role owning a practice instance; null for the shared game instance. */
  role: Role | null;
}>;

export function createServerEpoch(): string {
  return randomUUID();
}

const NONE_SCOPE: GameViewScope = { gameInstanceId: null, kind: 'none', revision: 0 };

export class MatchContext {
  readonly serverEpoch: string;
  private currentMatchId: string;
  private version = 0;
  private tick = 0;
  private startAtValue: number | null = null;
  private startTickValue: number | null = null;
  private deadlineTickValue: number | null = null;
  private tuningValue: MatchTuning | null = null;
  private seedValue: number | null = null;
  private readonly createId: () => string;
  private readonly scopes = new Map<string, GameViewScope>();
  private readonly instances = new Map<string, LogicalInstance>();
  private readonly membership = new Map<string, string>();
  private rolePlan: ReadonlyMap<string, Role> | null = null;

  constructor(options: { serverEpoch: string; matchId?: string; createId?: () => string }) {
    this.serverEpoch = options.serverEpoch;
    this.createId = options.createId ?? randomUUID;
    this.currentMatchId = options.matchId ?? this.createId();
  }

  get matchId() {
    return this.currentMatchId;
  }
  get stateVersion() {
    return this.version;
  }
  get serverTick() {
    return this.tick;
  }
  get startAt() {
    return this.startAtValue;
  }
  get startTick() {
    return this.startTickValue;
  }
  get deadlineTick() {
    return this.deadlineTickValue;
  }
  get tuningVersion() {
    return this.tuningValue?.tuningVersion ?? null;
  }
  get tuning() {
    return this.tuningValue;
  }
  get seed() {
    return this.seedValue;
  }

  /** Injects A's tuning and the round seed once per match. Neither is copied to public state. */
  fixRoundInputs(input: { tuning: MatchTuning; seed: number }) {
    if (this.tuningValue !== null && this.tuningValue.tuningVersion !== input.tuning.tuningVersion)
      throw new Error('TUNING_CHANGED_MID_MATCH');
    if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff)
      throw new Error('INVALID_SEED');
    this.tuningValue = input.tuning;
    this.seedValue = input.seed;
  }

  bumpVersion(): number {
    this.version += 1;
    return this.version;
  }

  advanceTick(): number {
    this.tick += 1;
    return this.tick;
  }

  /** Records the countdown target (server monotonic ms). */
  scheduleStart(startAtMs: number) {
    if (!Number.isFinite(startAtMs)) throw new Error('INVALID_START_AT');
    this.startAtValue = startAtMs;
  }

  /** Fixes startTick/deadlineTick exactly once per match. Re-application is ignored. */
  fixStart(startTick: number, roundTicks: number): boolean {
    if (this.startTickValue !== null) return false;
    this.startTickValue = startTick;
    this.deadlineTickValue = startTick + roundTicks;
    return true;
  }

  isCommandForCurrentMatch(matchId: string) {
    return matchId === this.currentMatchId;
  }

  // ---- Logical game spaces ----

  scopeOf(playerId: string): GameViewScope {
    return this.scopes.get(playerId) ?? NONE_SCOPE;
  }

  createInstance(kind: ScopeKind, role: Role | null = null): LogicalInstance {
    const instance: LogicalInstance = { gameInstanceId: this.createId(), kind, role };
    this.instances.set(instance.gameInstanceId, instance);
    return instance;
  }

  hasInstance(gameInstanceId: string) {
    return this.instances.has(gameInstanceId);
  }

  instanceOf(playerId: string): LogicalInstance | null {
    const id = this.membership.get(playerId);
    return id ? (this.instances.get(id) ?? null) : null;
  }

  membersOf(gameInstanceId: string): string[] {
    return [...this.membership.entries()]
      .filter(([, id]) => id === gameInstanceId)
      .map(([playerId]) => playerId);
  }

  /** Enters a logical instance: revision increases and a new active scope is recorded. */
  enterInstance(playerId: string, gameInstanceId: string): ActiveGameScope {
    const instance = this.instances.get(gameInstanceId);
    if (!instance) throw new Error('UNKNOWN_GAME_INSTANCE');
    const previous = this.scopeOf(playerId);
    const scope: ActiveGameScope = {
      gameInstanceId,
      kind: instance.kind,
      revision: previous.revision + 1,
    };
    this.scopes.set(playerId, scope);
    this.membership.set(playerId, gameInstanceId);
    return scope;
  }

  /** Leaves the current logical instance: revision increases and the scope becomes none. */
  leaveInstance(playerId: string): GameViewScope {
    const previous = this.scopeOf(playerId);
    const scope: GameViewScope = {
      gameInstanceId: null,
      kind: 'none',
      revision: previous.revision + 1,
    };
    this.scopes.set(playerId, scope);
    this.membership.delete(playerId);
    return scope;
  }

  /** Retires a logical instance. Later results carrying its id must be discarded by callers. */
  retireInstance(gameInstanceId: string): string[] {
    const members = this.membersOf(gameInstanceId);
    for (const playerId of members) this.leaveInstance(playerId);
    this.instances.delete(gameInstanceId);
    return members;
  }

  activeInstances(): LogicalInstance[] {
    return [...this.instances.values()];
  }

  // ---- Round replacement ----

  setRolePlan(plan: ReadonlyMap<string, Role> | null) {
    this.rolePlan = plan;
  }

  takeRolePlan(): ReadonlyMap<string, Role> | null {
    const plan = this.rolePlan;
    this.rolePlan = null;
    return plan;
  }

  /**
   * Starts a new round: new matchId, reset version/tick/start/deadline/seed, every scope back
   * to none/0 and every logical instance dropped. Tuning is kept because it is a process input.
   */
  startNewRound(): { previousMatchId: string; matchId: string } {
    const previousMatchId = this.currentMatchId;
    this.currentMatchId = this.createId();
    this.version = 0;
    this.tick = 0;
    this.startAtValue = null;
    this.startTickValue = null;
    this.deadlineTickValue = null;
    this.seedValue = null;
    this.scopes.clear();
    this.instances.clear();
    this.membership.clear();
    return { previousMatchId, matchId: this.currentMatchId };
  }
}

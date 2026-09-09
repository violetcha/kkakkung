import type {
  ActiveSelf,
  CommandCode,
  CoreCommand,
  CoreOutcome,
  CoreReadFrame,
  CorePort,
  CreateMatchInput,
  CreatePracticeInput,
  DomainEvent,
  EndedSelf,
  MediaIntent,
  PlayerKnowledge,
  StepInput,
  StepResult,
  VisibleEntity,
  VisibleSurfaces,
} from './core-types.js';
import { detectCaptures } from './capture.js';
import { abortMatch, applyConnectionLost } from './disconnection.js';
import { endExchange, openExchange, requestEligibility, verifyAccept } from './exchange/session.js';
import { createExitRegistry } from './exits/registry.js';
import { clearNextAction, expireMove, holdMove, queueTurn, releaseMove } from './input-buffer.js';
import { discoverExits, knownActiveExits } from './knowledge/exits.js';
import { initialTerrain, knownTerrainOf, observeTerrain } from './knowledge/terrain.js';
import { completeActions, reserveMove } from './movement.js';
import { visibilityOf } from './vision/visibility.js';
import { terminateRunner, type TerminationOutcome } from './participation.js';
import { createPriorityOrder } from './priority.js';
import { evaluateResult } from './result.js';
import { reserveTurn } from './rotation.js';
import {
  EMPTY_SURFACES,
  commandPhase,
  isTerminal,
  withPlayers,
  type KnowledgeRecord,
  type MatchState,
  type PlayerRecord,
} from './state.js';
import type { RosterEntry } from './types.js';

export type { MatchState, PlayerRecord } from './state.js';

function sortedIds(players: readonly RosterEntry[]): string[] {
  return [...players.map((p) => p.playerId)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function initialPlayer(entry: RosterEntry, input: CreateMatchInput): PlayerRecord {
  const placed = input.layout.players.find((p) => p.playerId === entry.playerId);
  if (!placed) throw new RangeError(`layout has no placement for ${entry.playerId}`);
  if (placed.role !== entry.role) throw new RangeError(`role mismatch for ${entry.playerId}`);
  return Object.freeze({
    playerId: entry.playerId,
    role: entry.role,
    status: 'ACTIVE',
    cell: Object.freeze({ x: placed.cell.x, y: placed.cell.y }),
    dir: placed.dir,
    action: null,
    nextAction: null,
    heldMove: null,
    connected: true,
    restraintUntilTick: null,
    restraintImmuneUntilTick: null,
    equipment: Object.freeze({ sensor: 0, trap: 0 }),
    ownedEquipment: Object.freeze([]),
    installation: null,
    exchange: null,
    challenge: null,
  });
}

function validateCreateInput(input: CreateMatchInput): void {
  if (typeof input.matchId !== 'string' || input.matchId.length === 0) {
    throw new RangeError('matchId is required');
  }
  if (typeof input.gameInstanceId !== 'string' || input.gameInstanceId.length === 0) {
    throw new RangeError('gameInstanceId is required');
  }
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) {
    throw new RangeError('seed must be a uint32');
  }
  const ids = new Set<string>();
  for (const p of input.players) {
    if (ids.has(p.playerId)) throw new RangeError(`duplicate player ${p.playerId}`);
    ids.add(p.playerId);
  }
}

function baseState(input: CreateMatchInput, mode: MatchState['mode']): MatchState {
  validateCreateInput(input);
  const order = sortedIds(input.players);
  const players = new Map<string, PlayerRecord>();
  for (const id of order) {
    players.set(
      id,
      initialPlayer(
        input.players.find((p) => p.playerId === id)!,
        input,
      ),
    );
  }
  const runnerIds = order.filter((id) => players.get(id)!.role === 'runner');
  // Practice layouts carry no exits and no runner triple: the 6-player invariants stay off.
  const registry =
    mode === 'game'
      ? createExitRegistry(input.layout.topology, input.layout.exits, runnerIds)
      : null;
  if (registry && !registry.ok) throw new RangeError(`exit registry: ${registry.error.code}`);
  const knowledge = new Map<string, KnowledgeRecord>();
  for (const id of order) {
    const player = players.get(id)!;
    const territory =
      player.role === 'tagger'
        ? (input.layout.territories.find((t) => t.playerId === id)?.cells ?? null)
        : null;
    knowledge.set(id, initialTerrain(input.layout.topology, player.cell, territory));
  }
  const created: MatchState = {
    matchId: input.matchId,
    gameInstanceId: input.gameInstanceId,
    mode,
    seed: input.seed,
    tuning: input.tuning,
    layout: input.layout,
    phase: mode === 'practice' ? 'TEAM_PRACTICE' : 'GAME_LOADING',
    tick: null,
    startTick: null,
    deadlineTick: null,
    players,
    order,
    priority: mode === 'game' ? createPriorityOrder(runnerIds, input.seed) : null,
    exits: registry?.ok ? registry.registry : new Map(),
    counts: Object.freeze({ escaped: 0, captured: 0 }),
    result: null,
    abortReason: null,
    knowledge,
    visibility: new Map(),
    exchanges: new Map(),
    exchangeSeq: 0,
    eventSeq: 0,
  };
  // First real sight from the spawn pose is part of the initial knowledge.
  return refreshPerception(created, 0);
}

/**
 * Recomputes every ACTIVE player's visibility from the authoritative pose at
 * `tick`, unions the observation into terrain memory, and records exit
 * discoveries. Ended players keep their memory but expose no current sight.
 */
function refreshPerception(state: MatchState, tick: number): MatchState {
  const visibility = new Map<string, VisibleSurfaces>();
  let knowledge: Map<string, KnowledgeRecord> | null = null;
  for (const id of state.order) {
    const player = state.players.get(id)!;
    if (player.status !== 'ACTIVE') continue;
    const surfaces = visibilityOf(state.layout.topology, player, tick);
    visibility.set(id, surfaces);
    const record = state.knowledge.get(id);
    if (!record) continue;
    const observed = observeTerrain(state.layout.topology, record, surfaces);
    const discovered = discoverExits(observed, player.role, surfaces, state.exits);
    if (discovered !== record) {
      knowledge ??= new Map(state.knowledge);
      knowledge.set(id, discovered);
    }
  }
  return { ...state, visibility, knowledge: knowledge ?? state.knowledge };
}

/** Creates the authoritative game state. Six placed players, 3 taggers + 3 runners. */
export function createMatch(input: CreateMatchInput): MatchState {
  const taggers = input.players.filter((p) => p.role === 'tagger').length;
  const runners = input.players.filter((p) => p.role === 'runner').length;
  if (taggers !== 3 || runners !== 3) throw new RangeError('a match needs 3 taggers and 3 runners');
  return baseState(input, 'game');
}

/**
 * Practice instance for one team (up to three players of `input.role`). Uses the
 * same pure rules for movement, turning, exchange, and tagger equipment; contact
 * capture, team result, and the round deadline stay disabled.
 */
export function createPractice(input: CreatePracticeInput): MatchState {
  if (input.players.length === 0 || input.players.length > 3) {
    throw new RangeError('practice allows one to three players');
  }
  if (input.players.some((p) => p.role !== input.role)) {
    throw new RangeError('practice players must share the practice role');
  }
  return baseState(input, 'practice');
}

type StepContext = {
  state: MatchState;
  tick: number;
  outcomes: CoreOutcome[];
  events: DomainEvent[];
  media: MediaIntent[];
  /** Players whose personal result was fixed during this step. */
  endedThisStep: Set<string>;
};

function outcome(
  ctx: StepContext,
  command: CoreCommand,
  result: 'applied' | 'rejected' | 'canceled',
  code: CommandCode | null,
): void {
  const base = {
    matchId: command.matchId,
    requestId: command.requestId,
    sequence: command.sequence,
    tick: ctx.tick,
    actorId: command.actorId,
  };
  ctx.outcomes.push(
    result === 'applied'
      ? { ...base, result: 'applied', code: null }
      : { ...base, result, code: code ?? 'CANCELED' },
  );
}

function nextEventId(ctx: StepContext): string {
  const seq = ctx.state.eventSeq + 1;
  ctx.state = { ...ctx.state, eventSeq: seq };
  return `${ctx.state.matchId}/${ctx.state.gameInstanceId}/${ctx.tick}/${seq}`;
}

function applyStartPlaying(ctx: StepContext, startTick: number): void {
  if (ctx.state.mode !== 'game' || ctx.state.phase !== 'GAME_LOADING') return;
  if (!Number.isInteger(startTick) || startTick > ctx.tick) return;
  ctx.state = {
    ...ctx.state,
    phase: 'PLAYING',
    startTick,
    deadlineTick: startTick + ctx.state.tuning.roundTicks,
  };
}

function completeDueActions(ctx: StepContext): void {
  const completion = completeActions(ctx.state.players.values(), ctx.tick);
  if (completion.players.length === 0) return;
  ctx.state = withPlayers(ctx.state, completion.players);
  for (const move of completion.completedMoves) {
    ctx.events.push({
      type: 'SPATIAL_SOUND',
      sound: {
        eventId: nextEventId(ctx),
        tick: ctx.tick,
        kind: 'footstep',
        cell: move.to,
        sourcePlayerId: move.playerId,
      },
    });
  }
}

function actorCheck(ctx: StepContext, command: CoreCommand): CommandCode | null {
  if (command.matchId !== ctx.state.matchId) return 'WRONG_MATCH';
  if (ctx.state.phase !== commandPhase(ctx.state)) return 'INVALID_PHASE';
  const player = ctx.state.players.get(command.actorId);
  if (!player) return 'NOT_ALLOWED';
  if (player.status !== 'ACTIVE') return 'NOT_ACTIVE';
  return null;
}

function handleMoveIntent(ctx: StepContext, command: CoreCommand<'MOVE_INTENT'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const player = ctx.state.players.get(command.actorId)!;
  const direction = command.payload.direction;
  if (direction !== 'forward' && direction !== 'back' && direction !== null) {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  if (direction === null) {
    // Stop intent: drop only the held move; a running action still completes.
    ctx.state = withPlayers(ctx.state, [releaseMove(player)]);
    return outcome(ctx, command, 'applied', null);
  }
  if (player.action === null) {
    if (player.restraintUntilTick !== null && ctx.tick < player.restraintUntilTick) {
      return outcome(ctx, command, 'rejected', 'NOT_ALLOWED');
    }
    const reserved = reserveMove(
      ctx.state.layout.topology,
      player,
      direction,
      ctx.tick,
      ctx.state.tuning.moveTicks,
    );
    if (!reserved) return outcome(ctx, command, 'rejected', 'NOT_ALLOWED');
    ctx.state = withPlayers(ctx.state, [holdMove(reserved, direction, command.sequence)]);
    return outcome(ctx, command, 'applied', null);
  }
  ctx.state = withPlayers(ctx.state, [holdMove(player, direction, command.sequence)]);
  return outcome(ctx, command, 'applied', null);
}

function handleTurn(ctx: StepContext, command: CoreCommand<'TURN'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const player = ctx.state.players.get(command.actorId)!;
  const direction = command.payload.direction;
  if (direction !== 'left' && direction !== 'right') {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  if (player.action === null) {
    if (player.restraintUntilTick !== null && ctx.tick < player.restraintUntilTick) {
      return outcome(ctx, command, 'rejected', 'NOT_ALLOWED');
    }
    ctx.state = withPlayers(ctx.state, [
      reserveTurn(player, direction, ctx.tick, ctx.state.tuning.turnTicks),
    ]);
    return outcome(ctx, command, 'applied', null);
  }
  // Busy: the turn waits in the single next-action slot; the running move keeps its direction.
  ctx.state = withPlayers(ctx.state, [queueTurn(player, direction, command.sequence)]);
  return outcome(ctx, command, 'applied', null);
}

function handleExchangeRequest(ctx: StepContext, command: CoreCommand<'EXCHANGE_REQUEST'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const targetId = command.payload.targetPlayerId;
  if (typeof targetId !== 'string' || targetId.length === 0) {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  const actor = ctx.state.players.get(command.actorId)!;
  const target = ctx.state.players.get(targetId);
  if (!target) return outcome(ctx, command, 'rejected', 'NOT_ALLOWED');
  const reason = requestEligibility(ctx.state, actor, target);
  if (reason) return outcome(ctx, command, 'rejected', reason);
  const opened = openExchange(ctx.state, actor, target, ctx.tick);
  ctx.state = opened.state;
  // Only the recipient learns of the offer; no knowledge moves and no tagger trace is made.
  ctx.events.push({
    eventId: nextEventId(ctx),
    tick: ctx.tick,
    audience: [target.playerId],
    type: 'EXCHANGE_OFFER',
    payload: {
      exchangeId: opened.session.exchangeId,
      fromPlayerId: opened.session.fromPlayerId,
      expiresAtTick: opened.session.expiresAtTick,
    },
  });
  return outcome(ctx, command, 'applied', null);
}

function handleExchangeAccept(ctx: StepContext, command: CoreCommand<'EXCHANGE_ACCEPT'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const exchangeId = command.payload.exchangeId;
  if (typeof exchangeId !== 'string' || exchangeId.length === 0) {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  const verified = verifyAccept(ctx.state, command.actorId, exchangeId, ctx.tick);
  if (verified.status === 'rejected') {
    // A passed deadline ends the session so the UI can close on the outcome alone.
    if (verified.expired) ctx.state = endExchange(ctx.state, verified.expired);
    return outcome(ctx, command, 'rejected', verified.code);
  }
  // The verified pair is what KN-07 merges; the id ends here either way.
  ctx.state = endExchange(ctx.state, verified.session);
  return outcome(ctx, command, 'applied', null);
}

function handleCommand(ctx: StepContext, command: CoreCommand): void {
  if (ctx.endedThisStep.has(command.actorId)) {
    // The actor's personal result was fixed earlier in this step: cancel, do not reject.
    return outcome(ctx, command, 'canceled', 'NOT_ACTIVE');
  }
  switch (command.type) {
    case 'MOVE_INTENT':
      return handleMoveIntent(ctx, command);
    case 'TURN':
      return handleTurn(ctx, command);
    case 'EXCHANGE_REQUEST':
      return handleExchangeRequest(ctx, command);
    case 'EXCHANGE_ACCEPT':
      return handleExchangeAccept(ctx, command);
    default:
      return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
}

function applyExpireMove(ctx: StepContext, playerId: string, sequence: number): void {
  const player = ctx.state.players.get(playerId);
  if (!player || !Number.isInteger(sequence)) return;
  const expired = expireMove(player, sequence);
  if (expired !== player) ctx.state = withPlayers(ctx.state, [expired]);
}

/** Idle players consume their pending slot or held move once per tick. */
function startQueuedActions(ctx: StepContext): void {
  if (ctx.state.phase !== commandPhase(ctx.state)) return;
  const updated: PlayerRecord[] = [];
  for (const id of ctx.state.order) {
    const player = ctx.state.players.get(id)!;
    if (player.status !== 'ACTIVE' || player.action !== null) continue;
    if (player.restraintUntilTick !== null && ctx.tick < player.restraintUntilTick) continue;
    if (player.nextAction) {
      // The single-shot turn is consumed before any held move resumes.
      updated.push(
        clearNextAction(
          reserveTurn(player, player.nextAction.direction, ctx.tick, ctx.state.tuning.turnTicks),
        ),
      );
      continue;
    }
    if (player.heldMove) {
      const reserved = reserveMove(
        ctx.state.layout.topology,
        player,
        player.heldMove.direction,
        ctx.tick,
        ctx.state.tuning.moveTicks,
      );
      if (reserved) updated.push(reserved);
    }
  }
  if (updated.length > 0) ctx.state = withPlayers(ctx.state, updated);
}

/**
 * Advances the match to `input.tick`. Order: controls that open play, action
 * completion (from the previous state), commands in the server's confirmed
 * order, then queued action starts. Exactly one CoreOutcome per command.
 */
export function stepMatch(state: MatchState, input: StepInput): StepResult<MatchState> {
  if (!Number.isInteger(input.tick)) throw new RangeError('tick must be an integer');
  if (state.tick !== null && input.tick <= state.tick) {
    throw new RangeError('tick must increase');
  }
  const ctx: StepContext = {
    state: { ...state, tick: input.tick },
    tick: input.tick,
    outcomes: [],
    events: [],
    media: [],
    endedThisStep: new Set(),
  };
  if (isTerminal(ctx.state)) {
    for (const command of input.commands) outcome(ctx, command, 'canceled', 'ROUND_ENDED');
    return { state: ctx.state, outcomes: ctx.outcomes, events: [], mediaIntents: [] };
  }
  for (const control of input.controls) {
    if (control.type === 'START_PLAYING') applyStartPlaying(ctx, control.startTick);
    // TTL expiry is decided on the server's monotonic clock before the tick; core only applies it.
    if (control.type === 'EXPIRE_MOVE') applyExpireMove(ctx, control.playerId, control.sequence);
  }
  const before = ctx.state.players;
  completeDueActions(ctx);
  if (ctx.state.mode === 'game' && ctx.state.phase === 'PLAYING') {
    // Capture is committed before equipment or pose stages; ended runners leave later stages.
    for (const runnerId of detectCaptures(before, ctx.state.players)) {
      endRunner(ctx, runnerId, 'CAPTURED');
    }
  }
  // Terminal before commands: cancel the rest of this step. The later settle only
  // needs to apply the deadline result; the control loop below always runs because
  // applyConnectionLost/abortMatch check isTerminal themselves.
  if (settleResult(ctx, { includeTimeout: false })) {
    for (const command of input.commands) outcome(ctx, command, 'canceled', 'ROUND_ENDED');
  } else {
    for (const command of input.commands) handleCommand(ctx, command);
    startQueuedActions(ctx);
    settleResult(ctx, { includeTimeout: true });
  }
  for (const control of input.controls) {
    if (control.type === 'CONNECTION_LOST') {
      const lost = applyConnectionLost(ctx.state, control.playerId);
      ctx.state = lost.state;
      ctx.media.push(...lost.mediaIntents);
    } else if (control.type === 'ABORT_MATCH') {
      const aborted = abortMatch(ctx.state, control.reason);
      ctx.state = aborted.state;
      ctx.media.push(...aborted.mediaIntents);
    }
  }
  ctx.state = refreshPerception(ctx.state, ctx.tick);
  return {
    state: ctx.state,
    outcomes: ctx.outcomes,
    events: ctx.events,
    mediaIntents: ctx.media,
  };
}

/** Fixes a runner's personal result once; repeated calls change nothing. */
function endRunner(ctx: StepContext, runnerId: string, result: TerminationOutcome): void {
  const termination = terminateRunner(ctx.state, runnerId, result, ctx.tick, () =>
    nextEventId(ctx),
  );
  if (!termination.changed) return;
  ctx.state = termination.state;
  ctx.events.push(...termination.events);
  ctx.media.push(...termination.mediaIntents);
  ctx.endedThisStep.add(runnerId);
}

/** Applies the team result when decided; returns whether the match is now terminal. */
function settleResult(ctx: StepContext, options: { includeTimeout: boolean }): boolean {
  if (isTerminal(ctx.state)) return true;
  if (ctx.state.mode !== 'game' || ctx.state.phase !== 'PLAYING') return false;
  const result = evaluateResult(ctx.state, ctx.tick, options);
  if (!result) return false;
  ctx.state = { ...ctx.state, phase: 'RESULT', result };
  ctx.media.push({ type: 'RETIRE_INSTANCE', reason: 'round-ended' });
  return true;
}

export function getFrame(state: MatchState): CoreReadFrame {
  return {
    matchId: state.matchId,
    gameInstanceId: state.gameInstanceId,
    tick: state.tick ?? 0,
    phase: state.phase,
    counts: state.counts,
    result: state.result,
    abortReason: state.abortReason,
    participants: state.order.map((id) => {
      const p = state.players.get(id)!;
      return {
        playerId: p.playerId,
        role: p.role,
        status: p.status,
        cell: p.cell,
        dir: p.dir,
        action: p.action,
      };
    }),
  };
}

export function getPlayerSelf(state: MatchState, playerId: string): ActiveSelf | EndedSelf | null {
  const p = state.players.get(playerId);
  if (!p) return null;
  if (p.status !== 'ACTIVE') return { playerId: p.playerId, role: p.role, status: p.status };
  return {
    playerId: p.playerId,
    role: p.role,
    status: 'ACTIVE',
    cell: p.cell,
    dir: p.dir,
    action: p.action,
    equipment: p.equipment,
    ownedEquipment: p.ownedEquipment,
    restraintUntilTick: p.restraintUntilTick,
    restraintImmuneUntilTick: p.restraintImmuneUntilTick,
    installation: p.installation,
    exchange: p.exchange,
    challenge: p.challenge,
    loading: null,
  };
}

export function getVisibleSurfaces(state: MatchState, playerId: string): VisibleSurfaces {
  return state.visibility.get(playerId) ?? EMPTY_SURFACES;
}

export function getVisibleEntities(state: MatchState, playerId: string): readonly VisibleEntity[] {
  const surfaces = getVisibleSurfaces(state, playerId);
  if (surfaces.visibleCells.length === 0) return [];
  const visible = new Set(surfaces.visibleCells.map((c) => `${c.x},${c.y}`));
  const entities: VisibleEntity[] = [];
  for (const id of state.order) {
    if (id === playerId) continue;
    const other = state.players.get(id)!;
    if (other.status !== 'ACTIVE') continue;
    const cell = other.action?.kind === 'move' ? other.action.to : other.cell;
    if (visible.has(`${other.cell.x},${other.cell.y}`) || visible.has(`${cell.x},${cell.y}`)) {
      entities.push({
        id: other.playerId,
        kind: 'player',
        cell: other.cell,
        dir: other.dir,
        action: other.action,
        role: other.role,
      });
    }
  }
  return entities;
}

export function getPlayerKnowledge(state: MatchState, playerId: string): PlayerKnowledge {
  const record = state.knowledge.get(playerId);
  const player = state.players.get(playerId);
  if (!record || !player) return { mapVersion: 0, knownTerrain: [], knownActiveExits: [] };
  return {
    mapVersion: record.mapVersion,
    knownTerrain: knownTerrainOf(state.layout.topology, record),
    knownActiveExits: knownActiveExits(record, player.role, state.exits),
  };
}

export const matchCore: CorePort<MatchState> = Object.freeze({
  createMatch,
  createPractice,
  stepMatch,
  getPlayerKnowledge,
  getVisibleEntities,
  getPlayerSelf,
  getVisibleSurfaces,
  getFrame,
});

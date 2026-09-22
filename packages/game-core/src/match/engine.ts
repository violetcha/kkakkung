import type {
  ActiveSelf,
  CommandCode,
  CoreCommand,
  CoreOutcome,
  CoreReadFrame,
  CorePort,
  ChallengeView,
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
import {
  advanceInstallations,
  dropInstall,
  planInstall,
  isStartCell,
  reserveInstall,
  spendEquipment,
  verifyInstallCancel,
} from './equipment/install.js';
import { expireRestraints, isRestrained, lockRestrainedActions } from './equipment/restraint.js';
import { sensorTriggers } from './equipment/sensor.js';
import { activateTraps } from './equipment/trap-activate.js';
import { cancelExchange, sweepExchanges } from './exchange/cancel.js';
import { mergeKnowledge } from './exchange/merge.js';
import { midpointOf, releaseTraces, scheduleTrace } from './exchange/trace.js';
import {
  endExchange,
  openExchange,
  requestEligibility,
  verifyAccept,
  type ExchangeSession,
} from './exchange/session.js';
import {
  advanceChallenges,
  cancelChallenge,
  isChallenging,
  startChallenge,
} from './exits/challenge.js';
import { verifyProgress } from './exits/complete.js';
import { createExitRegistry } from './exits/registry.js';
import { clearNextAction, expireMove, holdMove, queueTurn, releaseMove } from './input-buffer.js';
import { discoverExits, knownActiveExits } from './knowledge/exits.js';
import { initialTerrain, knownTerrainOf, observeTerrain } from './knowledge/terrain.js';
import { completeActions, reserveMove, type CompletedMove } from './movement.js';
import { isWalkable } from './map/validate-template.js';
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
import type { Cell, Dir, RosterEntry } from './types.js';

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
    grabUntilTick: null,
    restraintUntilTick: null,
    restraintImmuneUntilTick: null,
    // Runner items stay at zero until the product decision (D-2026-09-08-01).
    equipment:
      entry.role === 'tagger'
        ? Object.freeze({ sensor: 1, trap: 1 })
        : Object.freeze({ sensor: 0, trap: 0 }),
    ownedEquipment: Object.freeze([]),
    installation: null,
    exchange: null,
    challenge: null,
    nextAttemptTick: null,
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
    // S15P21C204-316. Practice never starts a round clock, so the flag only means something for
    // a game. An absent value is the ordinary tuned round.
    deadline: mode === 'game' ? (input.deadline ?? 'round') : 'round',
    resultPolicy: mode === 'game' ? (input.result ?? 'rules') : 'rules',
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
    traces: new Map(),
    installations: new Map(),
    installationSeq: 0,
    challengeSeq: 0,
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
  /** Moves that completed at this tick, the input of equipment activation. */
  completedMoves: readonly CompletedMove[];
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
    // S15P21C204-316. The demo harness runs without a clock: `evaluateResult` already skips the
    // timeout when there is no deadline, so leaving it null is the whole change.
    deadlineTick: ctx.state.deadline === 'none' ? null : startTick + ctx.state.tuning.roundTicks,
  };
}

/**
 * S15P21C204-316. Puts one participant on a free passage cell facing `dir`, for the operator
 * demo harness. Refusals are silent and leave the state untouched: a control carries no
 * requestId, so there is no outcome to answer with. The caller sees the refusal by reading the
 * position back, which is what the demo scenario runner already does between steps.
 *
 * The guards exist so a placement can never stand in for a judgement the rules own. It cannot
 * move somebody who is mid-action, mid-challenge, mid-exchange or installing, because those are
 * decided by tick arithmetic that a jump would silently invalidate; it cannot land on a start
 * cell, a wall, or a cell somebody occupies, because walking onto a participant is a capture.
 */
function applyPlacePlayer(ctx: StepContext, playerId: string, cell: Cell, dir: Dir): void {
  const state = ctx.state;
  // Only the demo harness. An ordinary match never carries `deadline: 'none'`.
  if (state.mode !== 'game' || state.deadline !== 'none') return;
  if (state.phase !== 'PLAYING' || isTerminal(state)) return;
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) return;
  const player = state.players.get(playerId);
  if (!player || player.status !== 'ACTIVE') return;
  if (player.action !== null || player.installation !== null) return;
  if (player.exchange !== null || isChallenging(player)) return;
  if (!isWalkable(state.layout.topology, cell) || isStartCell(state, cell)) return;
  for (const id of state.order) {
    const other = state.players.get(id)!;
    if (other.playerId === playerId || other.status !== 'ACTIVE') continue;
    if (other.cell.x === cell.x && other.cell.y === cell.y) return;
  }
  // A held intent or queued turn from the old position would walk the wrong way from the new
  // one, so the jump clears them. Equipment, knowledge and restraint are untouched.
  ctx.state = withPlayers(state, [
    {
      ...player,
      cell: Object.freeze({ x: cell.x, y: cell.y }),
      dir,
      heldMove: null,
      nextAction: null,
    },
  ]);
}

function completeDueActions(ctx: StepContext): void {
  const completion = completeActions(ctx.state.players.values(), ctx.tick);
  if (completion.players.length === 0) return;
  ctx.state = withPlayers(ctx.state, completion.players);
  ctx.completedMoves = completion.completedMoves;
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
    if (isRestrained(player, ctx.tick) || isChallenging(player)) {
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
    // An exit challenge locks the pose; a restraint stops moving, not looking
    // around (EQ-05).
    if (isChallenging(player)) return outcome(ctx, command, 'rejected', 'NOT_ALLOWED');
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
  const reason = requestEligibility(ctx.state, actor, target, ctx.tick);
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
    if (verified.close) ctx.state = endExchange(ctx.state, verified.close);
    return outcome(ctx, command, 'rejected', verified.code);
  }
  const merged = mergeKnowledge(ctx.state, verified.session);
  if (merged.status === 'unchanged') {
    // Nothing left to merge: the session ends without a knowledge or trace change.
    ctx.state = endExchange(ctx.state, verified.session);
    return outcome(ctx, command, 'rejected', 'NOT_ALLOWED');
  }
  ctx.state = endExchange(merged.state, verified.session);
  // The pair's cells at this tick become one delayed tagger trace (KN-08).
  ctx.state = scheduleTrace(ctx.state, {
    markerId: `mk-${verified.session.exchangeId}`,
    kind: 'exchange',
    point: midpointOf(merged.cells[0], merged.cells[1]),
    occurredTick: ctx.tick,
  });
  // Each side hears its own new map version; the pair's cells at this tick are
  // the material KN-08 turns into the delayed tagger trace.
  for (const party of merged.parties) {
    ctx.events.push({
      eventId: nextEventId(ctx),
      tick: ctx.tick,
      audience: [party.playerId],
      type: 'EXCHANGE_COMPLETED',
      payload: { exchangeId: verified.session.exchangeId, mapVersion: party.mapVersion },
    });
  }
  return outcome(ctx, command, 'applied', null);
}

/** Notifies both parties, and only them, that a session ended. */
function exchangeCanceled(ctx: StepContext, session: ExchangeSession, reason: CommandCode): void {
  ctx.events.push({
    eventId: nextEventId(ctx),
    tick: ctx.tick,
    audience: [session.fromPlayerId, session.toPlayerId],
    type: 'EXCHANGE_CANCELED',
    payload: { exchangeId: session.exchangeId, reason },
  });
}

function handleExchangeCancel(ctx: StepContext, command: CoreCommand<'EXCHANGE_CANCEL'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const exchangeId = command.payload.exchangeId;
  if (typeof exchangeId !== 'string' || exchangeId.length === 0) {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  const canceled = cancelExchange(ctx.state, command.actorId, exchangeId, ctx.tick);
  if (canceled.status === 'rejected') return outcome(ctx, command, 'rejected', canceled.code);
  ctx.state = endExchange(ctx.state, canceled.session);
  exchangeCanceled(ctx, canceled.session, 'CANCELED');
  return outcome(ctx, command, 'applied', null);
}

/**
 * Per-tick session upkeep (KN-06): distance, personal end, locks and the
 * deadline end a session quietly for its two parties. No tagger notification
 * and no position event is produced.
 */
function sweepExchangeSessions(ctx: StepContext): void {
  const swept = sweepExchanges(ctx.state, ctx.tick);
  if (swept.ended.length === 0) return;
  ctx.state = swept.state;
  for (const entry of swept.ended) exchangeCanceled(ctx, entry.session, entry.reason);
}

/**
 * Publishes the traces due at this tick (KN-08) to the active taggers. The
 * payload carries the past point and its ticks only: no identity, no heading,
 * no current position, no surrounding terrain.
 */
function publishDueTraces(ctx: StepContext): void {
  const released = releaseTraces(ctx.state, ctx.tick);
  ctx.state = released.state;
  if (released.due.length === 0) return;
  const audience = ctx.state.order.filter((id) => {
    const player = ctx.state.players.get(id)!;
    return player.role === 'tagger' && player.status === 'ACTIVE';
  });
  if (audience.length === 0) return;
  for (const trace of released.due) {
    ctx.events.push({
      eventId: nextEventId(ctx),
      tick: ctx.tick,
      audience,
      type: 'HUNTER_MARKER',
      payload: {
        markerId: trace.markerId,
        kind: trace.kind,
        point: trace.point,
        occurredTick: trace.occurredTick,
        showAtTick: trace.publishTick,
        expiresTick: trace.expiresTick,
      },
    });
  }
}

function handleInstall(ctx: StepContext, command: CoreCommand<'INSTALL'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const actor = ctx.state.players.get(command.actorId)!;
  const plan = planInstall(ctx.state, actor, command.payload.kind);
  if (plan.status === 'rejected') return outcome(ctx, command, 'rejected', plan.code);
  // Reserving spends no charge: only a finished placement does.
  ctx.state = reserveInstall(ctx.state, actor, plan.target, ctx.tick).state;
  return outcome(ctx, command, 'applied', null);
}

function handleGrabIntent(ctx: StepContext, command: CoreCommand<'GRAB_INTENT'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  if (ctx.state.mode !== 'game' || ctx.state.phase !== 'PLAYING') {
    return outcome(ctx, command, 'rejected', 'INVALID_PHASE');
  }
  const actor = ctx.state.players.get(command.actorId)!;
  if (actor.role !== 'tagger') return outcome(ctx, command, 'rejected', 'NOT_ALLOWED');
  ctx.state = withPlayers(ctx.state, [
    { ...actor, grabUntilTick: ctx.tick + ctx.state.tuning.grabTicks + 1 },
  ]);
  return outcome(ctx, command, 'applied', null);
}

function handleInstallCancel(ctx: StepContext, command: CoreCommand<'INSTALL_CANCEL'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const installationId = command.payload.installationId;
  if (typeof installationId !== 'string' || installationId.length === 0) {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  const canceled = verifyInstallCancel(ctx.state, command.actorId, installationId);
  if (canceled.status === 'rejected') return outcome(ctx, command, 'rejected', canceled.code);
  ctx.state = dropInstall(ctx.state, canceled.pending);
  return outcome(ctx, command, 'applied', null);
}

/**
 * Installation upkeep before this tick's commands (EQ-01), so a cancel that
 * arrives on the completion tick is already too late. Completion spends the
 * charge once; leaving the pose drops the reservation free of charge.
 */
function advanceDueInstallations(ctx: StepContext): void {
  ctx.state = advanceInstallations(ctx.state, ctx.tick).state;
}

/**
 * The two events of one device activation (EQ-02/EQ-04). The tagger marker
 * shows the past cell at once and lives 40 ticks; the sound is a server-only
 * input for the audio pipeline. Each carries its own id, and the activation key
 * - the marker id plus the device's single-shot SPENT - keeps both to one.
 */
function deviceActivated(
  ctx: StepContext,
  kind: 'sensor' | 'trap',
  equipmentId: string,
  cell: Cell,
): void {
  ctx.state = scheduleTrace(ctx.state, {
    markerId: `mk-${equipmentId}`,
    kind,
    point: { x: cell.x, y: cell.y },
    occurredTick: ctx.tick,
    delayTicks: 0,
  });
  ctx.events.push({
    type: 'SPATIAL_SOUND',
    sound: { eventId: nextEventId(ctx), tick: ctx.tick, kind, cell },
  });
}

/**
 * Equipment activation (EQ-02/EQ-04): after the capture stage and before this
 * tick's commands. A sensor with a new ACTIVE runner on its approach cell is
 * spent once; a trap restrains exactly one candidate of the common tick
 * priority and is spent in the same state. Neither event names the runner: the
 * target learns of its own restraint through the self projection.
 */
function activateEquipment(ctx: StepContext): void {
  for (const trigger of sensorTriggers(ctx.state, ctx.completedMoves)) {
    ctx.state = spendEquipment(ctx.state, trigger.ownerId, trigger.equipmentId);
    deviceActivated(ctx, 'sensor', trigger.equipmentId, trigger.cell);
  }
  const traps = activateTraps(ctx.state, ctx.completedMoves, ctx.tick);
  ctx.state = traps.state;
  for (const activation of traps.activations) {
    // The new restraint ends the target's exit challenge; its map exchange is
    // ended by the session upkeep later in this same tick (KN-06).
    const locked = lockRestrainedActions(ctx.state, activation.targetId);
    ctx.state = locked.state;
    if (locked.endedChallenge) {
      ctx.events.push({
        eventId: nextEventId(ctx),
        tick: ctx.tick,
        audience: [activation.targetId],
        type: 'EXIT_CHALLENGE_ENDED',
        payload: {
          challengeId: locked.endedChallenge.challengeId,
          result: 'canceled',
          reason: 'NOT_ALLOWED',
        },
      });
    }
    deviceActivated(ctx, 'trap', activation.equipmentId, activation.cell);
  }
}

/** Personal event for every start and end of an exit challenge (EX-02). */
function challengeStarted(ctx: StepContext, playerId: string, challenge: ChallengeView): void {
  ctx.events.push({
    eventId: nextEventId(ctx),
    tick: ctx.tick,
    audience: [playerId],
    type: 'EXIT_CHALLENGE',
    payload: challenge,
  });
}

function challengeEnded(
  ctx: StepContext,
  playerId: string,
  challengeId: string,
  result: 'canceled' | 'failed' | 'escaped',
  reason: CommandCode | null,
): void {
  ctx.events.push({
    eventId: nextEventId(ctx),
    tick: ctx.tick,
    audience: [playerId],
    type: 'EXIT_CHALLENGE_ENDED',
    payload: { challengeId, result, reason },
  });
}

function handleExitStart(ctx: StepContext, command: CoreCommand<'EXIT_START'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const exitId = command.payload.exitId;
  if (typeof exitId !== 'string' || exitId.length === 0) {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  const actor = ctx.state.players.get(command.actorId)!;
  const started = startChallenge(ctx.state, actor, exitId, ctx.tick);
  if (started.status === 'rejected') return outcome(ctx, command, 'rejected', started.code);
  ctx.state = started.state;
  challengeStarted(ctx, command.actorId, started.challenge);
  return outcome(ctx, command, 'applied', null);
}

function handleExitCancel(ctx: StepContext, command: CoreCommand<'EXIT_CANCEL'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const challengeId = command.payload.challengeId;
  if (typeof challengeId !== 'string' || challengeId.length === 0) {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  const canceled = cancelChallenge(ctx.state, command.actorId, challengeId, ctx.tick);
  if (canceled.status === 'rejected') return outcome(ctx, command, 'rejected', canceled.code);
  ctx.state = canceled.state;
  challengeEnded(ctx, command.actorId, challengeId, 'canceled', 'CANCELED');
  return outcome(ctx, command, 'applied', null);
}

/**
 * Per-tick challenge upkeep, before this tick's commands: the deadline, a new
 * restraint, a personal end and the pose conditions end a challenge on their
 * own. Automatic ends never create a second outcome for the original request.
 */
function advanceDueChallenges(ctx: StepContext): void {
  const upkeep = advanceChallenges(ctx.state, ctx.tick);
  ctx.state = upkeep.state;
  for (const end of upkeep.ended) {
    challengeEnded(ctx, end.playerId, end.challenge.challengeId, end.result, end.reason);
  }
}

/**
 * Exit completion report (EX-03). Core checks the challenge ownership, the 2
 * second minimum, the 8 second deadline and the pose position; it does not
 * prove the real body pose or camera integrity behind C's report. A verified
 * success ends the runner once through RL-07.
 */
function handleExitProgress(ctx: StepContext, command: CoreCommand<'EXIT_PROGRESS'>): void {
  const code = actorCheck(ctx, command);
  if (code) return outcome(ctx, command, 'rejected', code);
  const challengeId = command.payload.challengeId;
  if (typeof challengeId !== 'string' || challengeId.length === 0) {
    return outcome(ctx, command, 'rejected', 'INVALID_COMMAND');
  }
  const verdict = verifyProgress(
    ctx.state,
    command.actorId,
    challengeId,
    command.payload.method,
    command.payload.completed,
    ctx.tick,
  );
  if (verdict.status === 'rejected') return outcome(ctx, command, 'rejected', verdict.code);
  // A valid report that is not a completion leaves the attempt running.
  if (verdict.status === 'incomplete') return outcome(ctx, command, 'applied', null);
  endRunner(ctx, command.actorId, 'ESCAPED');
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
    case 'GRAB_INTENT':
      return handleGrabIntent(ctx, command);
    case 'EXCHANGE_REQUEST':
      return handleExchangeRequest(ctx, command);
    case 'EXCHANGE_ACCEPT':
      return handleExchangeAccept(ctx, command);
    case 'EXCHANGE_CANCEL':
      return handleExchangeCancel(ctx, command);
    case 'INSTALL':
      return handleInstall(ctx, command);
    case 'INSTALL_CANCEL':
      return handleInstallCancel(ctx, command);
    case 'EXIT_START':
      return handleExitStart(ctx, command);
    case 'EXIT_CANCEL':
      return handleExitCancel(ctx, command);
    case 'EXIT_PROGRESS':
      return handleExitProgress(ctx, command);
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
    if (isChallenging(player)) continue;
    const restrained = isRestrained(player, ctx.tick);
    if (player.nextAction) {
      // The single-shot turn is consumed before any held move resumes.
      updated.push(
        clearNextAction(
          reserveTurn(player, player.nextAction.direction, ctx.tick, ctx.state.tuning.turnTicks),
        ),
      );
      continue;
    }
    if (player.heldMove && !restrained) {
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
    completedMoves: [],
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
  // First rule stage: restraints that reached their end tick are released and
  // the re-restraint immunity starts (EQ-05).
  ctx.state = expireRestraints(ctx.state, ctx.tick).state;
  const before = ctx.state.players;
  completeDueActions(ctx);
  if (ctx.state.mode === 'game' && ctx.state.phase === 'PLAYING') {
    // Capture is committed before equipment or pose stages; ended runners leave later stages.
    for (const runnerId of detectCaptures(
      before,
      ctx.state.players,
      ctx.state.layout.topology,
      ctx.tick,
    )) {
      endRunner(ctx, runnerId, 'CAPTURED');
    }
  }
  advanceDueInstallations(ctx);
  // Terminal before commands: cancel the rest of this step. The later settle only
  // needs to apply the deadline result; the control loop below always runs because
  // applyConnectionLost/abortMatch check isTerminal themselves.
  if (settleResult(ctx, { includeTimeout: false })) {
    for (const command of input.commands) outcome(ctx, command, 'canceled', 'ROUND_ENDED');
  } else {
    activateEquipment(ctx);
    advanceDueChallenges(ctx);
    for (const command of input.commands) handleCommand(ctx, command);
    startQueuedActions(ctx);
    // After the commands of this tick: an accept at the deadline still reports
    // EXPIRED before the session is swept away.
    sweepExchangeSessions(ctx);
    publishDueTraces(ctx);
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
    } else if (control.type === 'PLACE_PLAYER') {
      // After this tick's captures and results, so a jump is never mistaken for a move into
      // somebody. The refreshPerception below gives the new position its sight this same tick.
      applyPlacePlayer(ctx, control.playerId, control.cell, control.dir);
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
  // Devices standing in real sight (KN-04). A sensor always carries its wall
  // face, a trap only its floor cell, and neither carries an owner.
  for (const id of state.order) {
    for (const owned of state.players.get(id)!.ownedEquipment) {
      if (owned.state === 'SPENT') continue;
      if (!visible.has(`${owned.cell.x},${owned.cell.y}`)) continue;
      entities.push(
        owned.kind === 'sensor'
          ? {
              id: owned.equipmentId,
              kind: 'sensor',
              cell: owned.cell,
              wall: owned.wall,
              state: owned.state,
            }
          : { id: owned.equipmentId, kind: 'trap', cell: owned.cell, state: owned.state },
      );
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

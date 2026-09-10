import type { ChallengeView, CommandCode } from '../core-types.js';
import { isRestrained } from '../equipment/restraint.js';
import { clearIntents } from '../input-buffer.js';
import { DIR_VECTORS, sameCell } from '../map/validate-template.js';
import type { MatchState, PlayerRecord } from '../state.js';
import type { ExitRecord } from './registry.js';

/** How a challenge ended, in the wording of the personal event contract. */
export type ChallengeEnd = Readonly<{
  playerId: string;
  challenge: ChallengeView;
  result: 'canceled' | 'failed';
  reason: CommandCode;
}>;

export type ChallengeStartResult =
  | Readonly<{ status: 'started'; state: MatchState; challenge: ChallengeView }>
  | Readonly<{ status: 'rejected'; code: CommandCode }>;

export type ChallengeCancelResult =
  | Readonly<{ status: 'canceled'; state: MatchState; challenge: ChallengeView }>
  | Readonly<{ status: 'rejected'; code: CommandCode }>;

export type ChallengeUpkeepResult = Readonly<{
  state: MatchState;
  ended: readonly ChallengeEnd[];
}>;

export function isChallenging(player: PlayerRecord): boolean {
  return player.challenge !== null;
}

/** The pose must stand on the exit's approach cell and look straight at its wall. */
export function facesExit(player: PlayerRecord, exit: ExitRecord): boolean {
  if (!sameCell(player.cell, exit.approach)) return false;
  const vector = DIR_VECTORS[player.dir];
  const ahead = { x: player.cell.x + vector.dx, y: player.cell.y + vector.dy };
  return ahead.x === exit.wall.x && ahead.y === exit.wall.y;
}

/**
 * Conditions a live challenge keeps needing: an ACTIVE, unrestrained owner
 * still posed at its own active exit. Returns the rejection code for the first
 * broken condition, or null while everything holds.
 */
function poseConditions(
  state: MatchState,
  player: PlayerRecord,
  exitId: string,
): CommandCode | null {
  if (player.role !== 'runner' || player.status !== 'ACTIVE') return 'NOT_ACTIVE';
  if (isRestrained(player, state.tick ?? 0)) return 'NOT_ALLOWED';
  const exit = state.exits.get(exitId);
  if (!exit || !exit.active || exit.ownerId !== player.playerId) return 'NOT_ALLOWED';
  if (!facesExit(player, exit)) return 'NOT_ALLOWED';
  return null;
}

/**
 * Explicit start of an exit challenge (EX-02). Entering the approach cell locks
 * nothing: only this command issues a challengeId, and only for the owner of an
 * active exit who stands on its approach cell facing the wall, is ACTIVE, is
 * not restrained, has no action running and is past its retry gate. The
 * client's own idea of owner or direction is never trusted - both come from the
 * server's registry and pose. The revealed poseKind is the one the seeded
 * layout fixed for the match; a retry never redraws it.
 */
export function startChallenge(
  state: MatchState,
  actor: PlayerRecord,
  exitId: string,
  tick: number,
): ChallengeStartResult {
  if (actor.role !== 'runner') return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (actor.challenge !== null) return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (actor.action !== null) return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (isRestrained(actor, tick)) return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (actor.nextAttemptTick !== null && tick < actor.nextAttemptTick) {
    return { status: 'rejected', code: 'NOT_ALLOWED' };
  }
  const exit = state.exits.get(exitId);
  if (!exit || !exit.active || exit.ownerId !== actor.playerId) {
    return { status: 'rejected', code: 'NOT_ALLOWED' };
  }
  if (!facesExit(actor, exit)) return { status: 'rejected', code: 'NOT_ALLOWED' };
  const challengeSeq = state.challengeSeq + 1;
  const challenge: ChallengeView = Object.freeze({
    challengeId: `ch-${challengeSeq}`,
    exitId: exit.exitId,
    poseKind: exit.poseKind,
    startedAtTick: tick,
    minSuccessTick: tick + state.tuning.exitMinimumTicks,
    expiresAtTick: tick + state.tuning.exitExpiryTicks,
  });
  const players = new Map(state.players);
  // Movement, turning and map exchange are locked from here on; pending
  // intents are dropped so none of them resumes behind the lock.
  players.set(actor.playerId, { ...clearIntents(actor), challenge });
  return { status: 'started', state: { ...state, players, challengeSeq }, challenge };
}

/**
 * Ends a challenge and, unless it succeeded, opens the retry gate 10 ticks
 * later. The exit keeps its registry poseKind: only the attempt's progress is
 * reset.
 */
export function endChallenge(
  state: MatchState,
  playerId: string,
  tick: number,
  options: Readonly<{ retry: boolean }> = { retry: true },
): MatchState {
  const player = state.players.get(playerId);
  if (!player || player.challenge === null) return state;
  const players = new Map(state.players);
  players.set(playerId, {
    ...player,
    challenge: null,
    nextAttemptTick: options.retry ? tick + state.tuning.exitRetryTicks : player.nextAttemptTick,
  });
  return { ...state, players };
}

/** Explicit EXIT_CANCEL: only the owner of that challengeId, only while it runs. */
export function cancelChallenge(
  state: MatchState,
  actorId: string,
  challengeId: string,
  tick: number,
): ChallengeCancelResult {
  const player = state.players.get(actorId);
  if (!player) return { status: 'rejected', code: 'NOT_ALLOWED' };
  const challenge = player.challenge;
  // A challenge that already ended is gone: its retry gate stays as it is.
  if (!challenge || challenge.challengeId !== challengeId) {
    return { status: 'rejected', code: 'STALE_REQUEST' };
  }
  return { status: 'canceled', state: endChallenge(state, actorId, tick), challenge };
}

/**
 * Per-tick re-check of every running challenge (EX-02): the 8 second deadline,
 * personal end, a new restraint and the pose conditions all end it. Automatic
 * ends report through the challenge state and a personal event; they never
 * produce a second outcome for the original request.
 */
export function advanceChallenges(state: MatchState, tick: number): ChallengeUpkeepResult {
  const ended: ChallengeEnd[] = [];
  let next = state;
  for (const playerId of state.order) {
    const player = next.players.get(playerId)!;
    const challenge = player.challenge;
    if (!challenge) continue;
    if (tick >= challenge.expiresAtTick) {
      next = endChallenge(next, playerId, tick);
      ended.push({ playerId, challenge, result: 'failed', reason: 'EXPIRED' });
      continue;
    }
    const broken = poseConditions(next, player, challenge.exitId);
    if (!broken) continue;
    next = endChallenge(next, playerId, tick);
    ended.push({ playerId, challenge, result: 'canceled', reason: broken });
  }
  return { state: next, ended };
}

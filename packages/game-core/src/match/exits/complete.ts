import type { ChallengeView, CommandCode } from '../core-types.js';
import type { MatchState } from '../state.js';
import { facesExit } from './challenge.js';

export type ProgressMethod = 'pose' | 'keys';

export type ProgressVerdict =
  /** The reported success passed every server condition: RL-07 may end the runner. */
  | Readonly<{ status: 'escaped'; challenge: ChallengeView }>
  /** A valid report that is not a completion: nothing about the attempt changes. */
  | Readonly<{ status: 'incomplete'; challenge: ChallengeView }>
  | Readonly<{ status: 'rejected'; code: CommandCode }>;

export function isProgressMethod(value: unknown): value is ProgressMethod {
  return value === 'pose' || value === 'keys';
}

/**
 * Server side of an exit completion report (EX-03).
 *
 * What this checks: the report belongs to the reporter's own running challenge,
 * the 2 second minimum has passed, the 8 second deadline has not, and the owner
 * still stands ACTIVE on the approach cell of its own active exit facing the
 * wall. A client cannot shorten the minimum by reporting early, and the same
 * challenge can never complete twice because success ends it.
 *
 * What this does NOT check: whether the player really held the pose for 1.2
 * seconds, or whether the camera was honest. Core proves no body pose and no
 * capture integrity; it only guarantees the time, position and duplicate
 * conditions around the success that C reports. `pose` and `keys` are held to
 * exactly the same server constraints.
 */
export function verifyProgress(
  state: MatchState,
  actorId: string,
  challengeId: string,
  method: unknown,
  completed: unknown,
  tick: number,
): ProgressVerdict {
  if (!isProgressMethod(method) || typeof completed !== 'boolean') {
    return { status: 'rejected', code: 'INVALID_COMMAND' };
  }
  const player = state.players.get(actorId);
  if (!player) return { status: 'rejected', code: 'NOT_ALLOWED' };
  const challenge = player.challenge;
  // Not this player's running challenge: a finished or foreign id is stale.
  if (!challenge || challenge.challengeId !== challengeId) {
    return { status: 'rejected', code: 'STALE_REQUEST' };
  }
  if (tick < challenge.minSuccessTick) return { status: 'rejected', code: 'NOT_READY' };
  if (tick >= challenge.expiresAtTick) return { status: 'rejected', code: 'EXPIRED' };
  if (player.role !== 'runner' || player.status !== 'ACTIVE') {
    return { status: 'rejected', code: 'NOT_ACTIVE' };
  }
  const exit = state.exits.get(challenge.exitId);
  if (!exit || !exit.active || exit.ownerId !== actorId) {
    return { status: 'rejected', code: 'NOT_ALLOWED' };
  }
  if (!facesExit(player, exit)) return { status: 'rejected', code: 'NOT_ALLOWED' };
  // A report of "not done yet" is a valid report, never an escape.
  if (!completed) return { status: 'incomplete', challenge };
  return { status: 'escaped', challenge };
}

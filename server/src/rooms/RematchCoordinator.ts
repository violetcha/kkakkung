/**
 * Rematch intent from the host in RESULT/ABORTED. `same` keeps roles, `swap` inverts them and
 * `lobby` returns to a fresh draw. The intent never confirms anyone else's READY; the next
 * round re-runs DEVICE_CHECK → practice → map → loading. New matchId/seed/instances are made
 * by the room's single round-start path, not here.
 */
import type { Phase, Role } from '@kkakkung/protocol/game-schema';
import type { OutcomeResult } from '../game/ports.js';

export type RematchMode = 'same' | 'swap' | 'lobby';

export type RematchDecision = OutcomeResult & {
  mode: RematchMode | null;
  plan: Map<string, Role> | null;
};

const flip = (role: Role): Role => (role === 'runner' ? 'tagger' : 'runner');

export class RematchCoordinator {
  private requested: { mode: RematchMode; plan: Map<string, Role> | null } | null = null;

  apply(input: {
    actorId: string;
    hostId: string | null;
    phase: Phase;
    mode: RematchMode;
    currentRoles: ReadonlyMap<string, Role>;
    remainingPlayers: readonly string[];
  }): RematchDecision {
    if (input.phase !== 'RESULT' && input.phase !== 'ABORTED')
      return { result: 'rejected', code: 'INVALID_PHASE', mode: null, plan: null };
    if (input.hostId === null || input.actorId !== input.hostId)
      return { result: 'rejected', code: 'NOT_ALLOWED', mode: null, plan: null };
    if (this.requested)
      return {
        result: 'applied',
        code: null,
        mode: this.requested.mode,
        plan: this.requested.plan,
      };
    let plan: Map<string, Role> | null = null;
    if (input.mode !== 'lobby') {
      plan = new Map();
      for (const playerId of input.remainingPlayers) {
        const role = input.currentRoles.get(playerId);
        if (role) plan.set(playerId, input.mode === 'same' ? role : flip(role));
      }
    }
    this.requested = { mode: input.mode, plan };
    return { result: 'applied', code: null, mode: input.mode, plan };
  }

  get pending() {
    return this.requested;
  }

  /** The new round may start only after the previous media generation is retired or absent. */
  canStart(input: { mediaRetirementConfirmed: boolean }): boolean {
    return this.requested !== null && input.mediaRetirementConfirmed;
  }

  take() {
    const request = this.requested;
    this.requested = null;
    return request;
  }
}

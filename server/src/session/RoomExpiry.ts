/**
 * Waiting-room cleanup policy and host delegation. A running match is never deleted by
 * the waiting-room timer. Preparation and results have an absolute phase deadline. The idle TTL is
 * F's `roomIdleTtlMs`; when absent the policy records that production readiness is not met
 * and performs no idle expiry.
 */
import type { Phase } from '@kkakkung/protocol/game-schema';

export type ExpiryDecision =
  'keep' | 'recover-device-check' | 'expire-idle' | 'expire-empty' | 'expire-sessions';

export class RoomExpiry {
  constructor(
    readonly idleTtlMs: number | null,
    readonly phaseTtlMs = 300_000,
  ) {
    if (idleTtlMs !== null && (!Number.isSafeInteger(idleTtlMs) || idleTtlMs <= 0))
      throw new Error('INVALID_ROOM_IDLE_TTL');
    if (!Number.isSafeInteger(phaseTtlMs) || phaseTtlMs <= 0)
      throw new Error('INVALID_ROOM_PHASE_TTL');
  }

  get productionReady() {
    return this.idleTtlMs !== null;
  }

  remainingMs(input: {
    phase: Phase;
    lastActivityMs: number;
    phaseStartedAtMs?: number;
    nowMs: number;
  }): number | null {
    if (this.idleTtlMs === null) return null;
    if (input.phase === 'LOBBY')
      return Math.max(0, this.idleTtlMs - (input.nowMs - input.lastActivityMs));
    if (['DEVICE_CHECK', 'RESULT', 'ABORTED'].includes(input.phase))
      return Math.max(
        0,
        this.phaseTtlMs - (input.nowMs - (input.phaseStartedAtMs ?? input.lastActivityMs)),
      );
    return null;
  }

  decide(input: {
    phase: Phase;
    connectedCount: number;
    liveSessionCount: number;
    lastActivityMs: number;
    phaseStartedAtMs?: number;
    nowMs: number;
  }): ExpiryDecision {
    if (!['LOBBY', 'DEVICE_CHECK', 'RESULT', 'ABORTED'].includes(input.phase)) return 'keep';
    if (input.liveSessionCount === 0) return 'expire-sessions';
    if (this.remainingMs(input) === 0) {
      // A connected room in device check is still an active group. Reclaim only the
      // participants that did not complete the check; destroying the whole room would
      // make one failed camera or permission prompt take five other players with it.
      if (input.phase === 'DEVICE_CHECK' && input.connectedCount > 0) return 'recover-device-check';
      return input.connectedCount === 0 ? 'expire-empty' : 'expire-idle';
    }
    return 'keep';
  }
}

/** Earliest joined, still connected, live-session participant becomes host. */
export function selectHost(
  players: readonly { playerId: string; joinOrder: number; connected: boolean; live: boolean }[],
  currentHostId: string | null,
): string | null {
  const current = players.find((p) => p.playerId === currentHostId);
  if (current && current.connected && current.live) return currentHostId;
  const candidates = players
    .filter((p) => p.connected && p.live)
    .sort((a, b) => a.joinOrder - b.joinOrder);
  return candidates[0]?.playerId ?? null;
}

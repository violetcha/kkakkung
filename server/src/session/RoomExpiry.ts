/**
 * Waiting-room cleanup policy and host delegation. Idle expiry applies only to LOBBY and
 * DEVICE_CHECK; a running match is never deleted by the waiting-room timer. The idle TTL is
 * F's `roomIdleTtlMs`; when absent the policy records that production readiness is not met
 * and performs no idle expiry.
 */
import type { Phase } from '@kkakkung/protocol/game-schema';

export type ExpiryDecision = 'keep' | 'expire-idle' | 'expire-empty' | 'expire-sessions';

export class RoomExpiry {
  constructor(readonly idleTtlMs: number | null) {
    if (idleTtlMs !== null && (!Number.isSafeInteger(idleTtlMs) || idleTtlMs <= 0))
      throw new Error('INVALID_ROOM_IDLE_TTL');
  }

  get productionReady() {
    return this.idleTtlMs !== null;
  }

  decide(input: {
    phase: Phase;
    connectedCount: number;
    liveSessionCount: number;
    lastActivityMs: number;
    nowMs: number;
  }): ExpiryDecision {
    if (input.phase !== 'LOBBY' && input.phase !== 'DEVICE_CHECK') return 'keep';
    if (input.liveSessionCount === 0) return 'expire-sessions';
    if (
      input.connectedCount === 0 &&
      this.idleTtlMs !== null &&
      input.nowMs - input.lastActivityMs >= this.idleTtlMs
    )
      return 'expire-empty';
    if (this.idleTtlMs !== null && input.nowMs - input.lastActivityMs >= this.idleTtlMs)
      return 'expire-idle';
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

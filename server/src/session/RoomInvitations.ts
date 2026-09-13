import type { RoomInvitationResponse } from '@kkakkung/protocol/game-messages';
import type { InvitationPort } from './invite-types.js';
import type { ProductSessionStore } from './ProductSessionStore.js';
import type { SlotRegistry } from './SlotRegistry.js';

/** One current invitation per live room. Only digests are retained by the underlying store. */
export class RoomInvitations {
  private readonly current = new Map<string, { inviteId: string; expiresAt: number }>();

  constructor(
    private readonly options: {
      invites: InvitationPort;
      sessions: ProductSessionStore;
      slots: SlotRegistry;
      now: () => number;
      maxTtlMs: number | null;
    },
  ) {}

  rotate(roomCode: string): RoomInvitationResponse | null {
    this.prune();
    if (!this.options.slots.hasRoom(roomCode) || this.options.maxTtlMs === null) return null;
    const expiresAt = this.options.now() + Math.min(10 * 60_000, this.options.maxTtlMs);
    const result = this.options.invites.issue({
      scope: { allowCreate: false, roomCodes: [roomCode] },
      expiresAt,
    });
    if (result.status !== 'issued') return null;
    // If issuance fails the previous link stays valid. No await between successful rotation,
    // invalidating old reservations and installing the new scoped invitation.
    this.revoke(roomCode);
    const { inviteId, inviteToken } = result.invitation;
    this.current.set(roomCode, { inviteId, expiresAt });
    return { roomCode, inviteToken, expiresAt };
  }

  revoke(roomCode: string): void {
    const previous = this.current.get(roomCode);
    if (!previous) return;
    this.options.invites.revoke(previous.inviteId);
    this.current.delete(roomCode);
    for (const session of this.options.sessions.sessionsInRoom(roomCode)) {
      if (
        session.inviteId === previous.inviteId &&
        !this.options.sessions.activeConnection(session.sessionId) &&
        this.options.slots.slotState(roomCode, session.playerId) === 'RESERVED'
      ) {
        this.options.slots.release(roomCode, session.playerId);
        this.options.sessions.invalidate(session.sessionId);
      }
    }
  }

  prune(): void {
    const now = this.options.now();
    for (const [roomCode, invitation] of this.current)
      if (!this.options.slots.hasRoom(roomCode) || now >= invitation.expiresAt)
        this.revoke(roomCode);
  }
}

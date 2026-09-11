import type { ProductSessionStore } from './ProductSessionStore.js';
import type { SlotRegistry } from './SlotRegistry.js';

/** Runs even when no WebSocket ever created a Room. Session expiry remains authoritative. */
export function createReservationCleanup(deps: {
  sessions: ProductSessionStore;
  slots: SlotRegistry;
  hasLiveRoom(roomCode: string): boolean;
  onRoomClosed(roomCode: string): void;
}) {
  return () => {
    for (const roomCode of deps.slots.roomCodes()) {
      for (const member of deps.slots.members(roomCode)) {
        if (member.state === 'RESERVED' && !deps.sessions.getByPlayer(member.playerId))
          deps.slots.release(roomCode, member.playerId);
      }
      // A live Room owns its disposal; JOINED and RETIRING seats are never reaped here.
      if (!deps.hasLiveRoom(roomCode) && deps.slots.occupied(roomCode) === 0) {
        deps.slots.closeRoom(roomCode);
        deps.sessions.invalidateRoom(roomCode);
        deps.onRoomClosed(roomCode);
      }
    }
    deps.sessions.prune();
  };
}

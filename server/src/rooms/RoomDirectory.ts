/**
 * Registry of live product rooms by roomCode. HTTP media routes and E callbacks reach a room
 * only through this narrow interface; they never mutate room state directly.
 */
import type { MediaBindings, AudioPolicy } from '@kkakkung/protocol/game-messages';
import type { MediaControl } from '../game/ports.js';

export interface ProductRoomHandle {
  readonly roomCode: string;
  readonly matchId: string;
  /** Current media instance for a participant's requested purpose, or null when none exists. */
  mediaScopeFor(
    playerId: string,
    purpose: 'practice' | 'game',
  ): { mediaInstanceId: string; gameInstanceId: string } | null;
  enqueueMediaControl(control: MediaControl): void;
  deliverBindings(playerId: string, message: MediaBindings): void;
  deliverAudioPolicy(playerId: string, message: AudioPolicy): void;
}

export class RoomDirectory {
  private readonly rooms = new Map<string, ProductRoomHandle>();

  register(handle: ProductRoomHandle) {
    this.rooms.set(handle.roomCode, handle);
  }

  unregister(roomCode: string, handle?: ProductRoomHandle) {
    if (!handle || this.rooms.get(roomCode) === handle) this.rooms.delete(roomCode);
  }

  get(roomCode: string): ProductRoomHandle | null {
    return this.rooms.get(roomCode) ?? null;
  }

  byMatch(matchId: string): ProductRoomHandle | null {
    for (const room of this.rooms.values()) if (room.matchId === matchId) return room;
    return null;
  }

  get size() {
    return this.rooms.size;
  }
}

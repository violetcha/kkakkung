import { ServerError } from '@colyseus/core';

/**
 * Colyseus room instance cap for one process. The default singleton keeps the development
 * limit of one room shared by the team's kkakkung room and the sandbox; the product server
 * creates its own instance with the F-verified room count.
 */
export class RoomAdmission {
  private readonly active = new Set<string>();

  constructor(readonly maxRooms = 1) {
    if (!Number.isSafeInteger(maxRooms) || maxRooms < 1) throw new Error('INVALID_MAX_ROOMS');
  }

  acquire(roomId: string) {
    if (this.active.has(roomId)) return;
    if (this.active.size >= this.maxRooms) throw new ServerError(503, 'ROOM_CAPACITY');
    this.active.add(roomId);
  }

  release(roomId: string) {
    this.active.delete(roomId);
  }

  get size() {
    return this.active.size;
  }
}

export const roomAdmission = new RoomAdmission(1);

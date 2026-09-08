import { ServerError } from '@colyseus/core';

/** One development room across both the team's kkakkung room and the integration sandbox. */
class RoomAdmission {
  private active: string | undefined;

  acquire(roomId: string) {
    if (this.active && this.active !== roomId) throw new ServerError(503, 'ROOM_CAPACITY');
    this.active = roomId;
  }

  release(roomId: string) {
    if (this.active === roomId) this.active = undefined;
  }
}

export const roomAdmission = new RoomAdmission();

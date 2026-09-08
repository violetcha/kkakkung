import { describe, expect, it } from 'vitest';
import { LobbyCoordinator } from '../../src/rooms/LobbyCoordinator.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';

describe('host delegation and seat lifecycle', () => {
  it('delegates to the earliest remaining connected player and keeps other seats', () => {
    const lobby = new LobbyCoordinator({ random: () => 0 });
    const slots = new SlotRegistry({ maxRooms: 1 });
    for (const [i, id] of ['A', 'B', 'C'].entries()) {
      slots.reserve('ROOM01', id, i, { create: true });
      slots.markJoined('ROOM01', id, i);
      lobby.add(id, `nick-${id}`, i);
    }
    expect(lobby.host).toBe('A');
    lobby.setConnected('A', false);
    lobby.remove('A');
    slots.release('ROOM01', 'A');
    expect(lobby.host).toBe('B');
    expect(slots.members('ROOM01').map((m) => m.playerId)).toEqual(['B', 'C']);
  });

  it('keeps a RETIRING seat reserved across repeated cleanup passes until retirement is confirmed', () => {
    const slots = new SlotRegistry({ maxRooms: 1 });
    slots.reserve('ROOM01', 'A', 0, { create: true });
    slots.markJoined('ROOM01', 'A', 0);
    slots.markRetiring('ROOM01', 'A');
    for (let pass = 0; pass < 3; pass++) {
      expect(slots.release('ROOM01', 'A')).toBe(false);
      expect(slots.closeRoom('ROOM01')).toBe(false);
    }
    expect(slots.occupied('ROOM01')).toBe(1);
    expect(slots.release('ROOM01', 'A', { confirmedRetirement: true })).toBe(true);
    expect(slots.closeRoom('ROOM01')).toBe(true);
  });

  it('refuses refill of a seat vacated during a match until the next round reopens the lobby', () => {
    const slots = new SlotRegistry({ maxRooms: 1 });
    for (let i = 0; i < 6; i++) slots.reserve('ROOM01', `p${i}`, 0, { create: true });
    slots.setPhase('ROOM01', 'PLAYING', 1);
    slots.release('ROOM01', 'p5');
    expect(slots.reserve('ROOM01', 'newcomer', 2)).toBe('ROOM_CLOSED');
    slots.setPhase('ROOM01', 'LOBBY', 3);
    expect(slots.reserve('ROOM01', 'newcomer', 4)).toBe('reserved');
  });
});

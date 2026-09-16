import { describe, expect, it } from 'vitest';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';

describe('SlotRegistry', () => {
  it('closes admission before asynchronous retirement without releasing protected seats', () => {
    const slots = new SlotRegistry({ maxRooms: 1 });
    slots.reserve('ROOM01', 'reserved', 0, { create: true });
    slots.reserve('ROOM01', 'retiring', 0);
    slots.markRetiring('ROOM01', 'retiring');
    slots.beginClose('ROOM01');
    expect(slots.reserve('ROOM01', 'new', 1)).toBe('ROOM_CLOSED');
    expect(slots.reserve('ROOM01', 'reserved', 1)).toBe('ROOM_CLOSED');
    expect(slots.markJoined('ROOM01', 'reserved', 1)).toBe(false);
    expect(slots.release('ROOM01', 'retiring')).toBe(false);
    expect(slots.closeRoom('ROOM01')).toBe(false);
    slots.release('ROOM01', 'reserved');
    slots.release('ROOM01', 'retiring', { confirmedRetirement: true });
    expect(slots.closeRoom('ROOM01')).toBe(true);
  });
  it('caps a room at six seats and the service at sixty, counting RETIRING seats', () => {
    const slots = new SlotRegistry({ maxRooms: 10 });
    for (let i = 0; i < 6; i++)
      expect(slots.reserve('ROOM01', `p${i}`, 0, { create: true })).toBe('reserved');
    expect(slots.reserve('ROOM01', 'p6', 0)).toBe('ROOM_FULL');
    expect(slots.reserve('ROOM01', 'p6', 0)).toBe('ROOM_FULL');
    for (let r = 1; r < 10; r++)
      for (let i = 0; i < 6; i++)
        expect(slots.reserve(`ROOM${r}`, `r${r}p${i}`, 0, { create: true })).toBe('reserved');
    expect(slots.totalOccupied()).toBe(60);
    expect(slots.reserve('ROOM99', 'x', 0, { create: true })).toBe('ROOM_LIMIT');
    slots.release('ROOM01', 'p0');
    expect(slots.totalOccupied()).toBe(59);
    slots.markRetiring('ROOM01', 'p1');
    expect(slots.release('ROOM01', 'p1')).toBe(false);
    expect(slots.reserve('ROOM01', 'q0', 0)).toBe('reserved');
    expect(slots.totalOccupied()).toBe(60);
    expect(slots.reserve('ROOM01', 'q1', 0)).toBe('ROOM_FULL');
    expect(slots.release('ROOM01', 'p1', { confirmedRetirement: true })).toBe(true);
    expect(slots.reserve('ROOM01', 'q1', 0)).toBe('reserved');
  });

  it('refuses new seats once the room left the waiting phases and keeps closing idempotent', () => {
    const slots = new SlotRegistry({ maxRooms: 1 });
    slots.reserve('ROOM01', 'p0', 0, { create: true });
    slots.markJoined('ROOM01', 'p0', 1);
    slots.setPhase('ROOM01', 'PLAYING', 2);
    expect(slots.reserve('ROOM01', 'p1', 3)).toBe('ROOM_CLOSED');
    expect(slots.reserve('ROOM02', 'p1', 3)).toBe('ROOM_CLOSED');
    expect(slots.activity()).toEqual({
      activeMatches: 1,
      activePractices: 0,
      pendingAdmissions: 0,
    });
    expect(slots.closeRoom('ROOM01')).toBe(false);
    slots.release('ROOM01', 'p0');
    expect(slots.closeRoom('ROOM01')).toBe(true);
    expect(slots.closeRoom('ROOM01')).toBe(true);
    expect(slots.hasRoom('ROOM01')).toBe(false);
  });

  it('opens a demo room with one operator seat and reports how it was opened', () => {
    const slots = new SlotRegistry({ maxRooms: 2 });
    expect(
      slots.reserve('D00001', 'operator', 0, { create: true, demo: { operatorRole: 'runner' } }),
    ).toBe('reserved');
    expect(slots.optionsOf('D00001')).toEqual({
      capacity: 1,
      kind: 'demo',
      operatorRole: 'runner',
    });
    // The single seat is the barrier: nobody else can reserve into the demo room.
    expect(slots.reserve('D00001', 'other', 0)).toBe('ROOM_FULL');
    expect(slots.reserve('D00001', 'operator', 0)).toBe('reserved');
    slots.reserve('M00001', 'p0', 0, { create: true });
    expect(slots.optionsOf('M00001')).toEqual({ capacity: 6, kind: 'match', operatorRole: null });
    expect(slots.reserve('M00001', 'p1', 0)).toBe('reserved');
    expect(slots.optionsOf('MISSING')).toBeNull();
  });

  it('exposes join order and read-only activity counts without double counting', () => {
    const slots = new SlotRegistry({ maxRooms: 2 });
    slots.reserve('A00001', 'p0', 0, { create: true });
    slots.reserve('A00001', 'p1', 0);
    slots.markJoined('A00001', 'p1', 1);
    slots.reserve('B00001', 'q0', 0, { create: true });
    slots.setPhase('B00001', 'TEAM_PRACTICE', 1);
    expect(slots.joinOrder('A00001', 'p1')).toBe(1);
    expect(slots.members('A00001').map((m) => [m.playerId, m.state])).toEqual([
      ['p0', 'RESERVED'],
      ['p1', 'JOINED'],
    ]);
    expect(slots.activity()).toEqual({
      activeMatches: 0,
      activePractices: 1,
      pendingAdmissions: 2,
    });
    expect(() => new SlotRegistry({ maxRooms: 0 })).toThrow('INVALID_MAX_ROOMS');
  });
});

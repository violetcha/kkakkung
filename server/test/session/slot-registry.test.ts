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

  // S15P21C204-312. 데모 방은 미디어를 쓰지 않고 좌석도 하나뿐이다. 경기 방 예산에서 빼고 따로 센다.
  it('counts demo rooms apart from the match room and seat budgets', () => {
    const slots = new SlotRegistry({ maxRooms: 1, serviceCapacity: 6, maxDemoRooms: 1 });
    const demo = { create: true, demo: { operatorRole: 'runner' as const } };
    expect(slots.reserve('D00001', 'operator', 0, demo)).toBe('reserved');
    // 데모 방이 열려 있어도 경기 방 하나와 그 여섯 좌석은 온전히 남는다.
    expect(slots.reserve('M00001', 'p0', 0, { create: true })).toBe('reserved');
    for (let index = 1; index < 6; index++)
      expect(slots.reserve('M00001', `p${index}`, 0)).toBe('reserved');
    expect(slots.playerOccupied()).toBe(6);
    expect(slots.totalOccupied()).toBe(7);
    expect(slots.reserve('M00002', 'q0', 0, { create: true })).toBe('ROOM_LIMIT');
    // 데모 방은 자기 상한으로만 막힌다.
    expect(slots.reserve('D00002', 'operator-2', 0, demo)).toBe('DEMO_LIMIT');
    slots.release('D00001', 'operator');
    expect(slots.closeRoom('D00001')).toBe(true);
    expect(slots.reserve('D00002', 'operator-2', 0, demo)).toBe('reserved');
  });

  // 시연 방(331)은 실제 사람이 뛰므로 경기 방과 같은 예산을 쓴다. 데모 방만 따로 센다.
  it('counts showcase rooms in the player budget, not the demo budget', () => {
    const slots = new SlotRegistry({ maxRooms: 1, maxDemoRooms: 1 });
    expect(slots.reserve('S00001', 'a', 0, { create: true, showcase: { role: 'runner' } })).toBe(
      'reserved',
    );
    expect(slots.reserve('M00001', 'p0', 0, { create: true })).toBe('ROOM_LIMIT');
    expect(
      slots.reserve('D00001', 'operator', 0, { create: true, demo: { operatorRole: 'runner' } }),
    ).toBe('reserved');
    expect(slots.playerOccupied()).toBe(1);
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

  // S15P21C204-293. 공개 서비스에서는 탭 몇 개로 전체 방 예산을 가져갈 수 있었다.
  it('stops one owner from taking the whole room budget and frees the slot when a room closes', () => {
    const slots = new SlotRegistry({ maxRooms: 10, maxRoomsPerOwner: 2 });
    expect(slots.reserve('ROOM01', 'a1', 0, { create: true, openedBy: 'ip-a' })).toBe('reserved');
    expect(slots.reserve('ROOM02', 'a2', 0, { create: true, openedBy: 'ip-a' })).toBe('reserved');
    expect(slots.roomsOpenedBy('ip-a')).toBe(2);

    // 세 번째는 서비스가 비어 있어도 거절된다. "가득 찼다"가 아니라 "네가 많이 열었다"이다.
    expect(slots.reserve('ROOM03', 'a3', 0, { create: true, openedBy: 'ip-a' })).toBe(
      'OWNER_LIMIT',
    );
    // 다른 출처는 영향을 받지 않는다.
    expect(slots.reserve('ROOM03', 'b1', 0, { create: true, openedBy: 'ip-b' })).toBe('reserved');
    // 주체가 없는 생성(팀 입장·데모)은 상한 대상이 아니다.
    expect(slots.reserve('ROOM04', 'c1', 0, { create: true })).toBe('reserved');
    expect(slots.reserve('ROOM05', 'c2', 0, { create: true, openedBy: null })).toBe('reserved');

    // 열어 둔 방을 닫으면 곧바로 다시 열 수 있다.
    slots.release('ROOM01', 'a1');
    expect(slots.closeRoom('ROOM01')).toBe(true);
    expect(slots.roomsOpenedBy('ip-a')).toBe(1);
    expect(slots.reserve('ROOM06', 'a4', 0, { create: true, openedBy: 'ip-a' })).toBe('reserved');
  });

  it('refuses a nonsensical per-owner cap instead of defaulting quietly', () => {
    expect(() => new SlotRegistry({ maxRooms: 1, maxRoomsPerOwner: 0 })).toThrow(
      'INVALID_MAX_ROOMS_PER_OWNER',
    );
    // 주지 않으면 기본값이 있고, 그 값이 전역 상한을 대신하지 않는다.
    expect(new SlotRegistry({ maxRooms: 10 }).maxRoomsPerOwner).toBe(2);
  });

  it('S15P21C204-361: counts showcase rooms inside maxRooms and caps how many may be forming at once', () => {
    // 시연 방은 데모 방과 달리 따로 세지 않는다. 셋이 모이는 중이면 일반 방은 둘만 남는다.
    const slots = new SlotRegistry({ maxRooms: 5, maxShowcaseRooms: 3 });
    const showcase = { create: true, showcase: { role: 'runner' as const } };
    expect(slots.canOpenShowcaseRoom()).toBe(true);
    expect(slots.reserve('SHOW01', 's1', 0, showcase)).toBe('reserved');
    expect(slots.reserve('SHOW02', 's2', 0, showcase)).toBe('reserved');
    expect(slots.formingShowcaseRooms()).toBe(2);
    expect(slots.canOpenShowcaseRoom()).toBe(true);
    expect(slots.reserve('SHOW03', 's3', 0, showcase)).toBe('reserved');
    expect(slots.formingShowcaseRooms()).toBe(3);
    expect(slots.canOpenShowcaseRoom()).toBe(false);
    // 빈 자리가 있는 방은 가장 먼저 열린 방부터 채운다.
    expect(slots.joinableShowcaseRoom()).toBe('SHOW01');

    expect(slots.reserve('ROOM01', 'a1', 0, { create: true })).toBe('reserved');
    expect(slots.reserve('ROOM02', 'b1', 0, { create: true })).toBe('reserved');
    expect(slots.reserve('ROOM03', 'c1', 0, { create: true })).toBe('ROOM_LIMIT');

    // 경기가 시작된 시연 방은 모이는 중이 아니라 다음 시연이 새 방을 열 수 있다. 방 수 예산은 그대로 쓴다.
    slots.setPhase('SHOW01', 'TEAM_PRACTICE', 0);
    expect(slots.formingShowcaseRooms()).toBe(2);
    expect(slots.canOpenShowcaseRoom()).toBe(true);
    expect(slots.joinableShowcaseRoom()).toBe('SHOW02');
    expect(slots.reserve('ROOM03', 'c1', 0, { create: true })).toBe('ROOM_LIMIT');
  });

  it('refuses a nonsensical showcase cap and defaults to one forming room', () => {
    expect(() => new SlotRegistry({ maxRooms: 1, maxShowcaseRooms: 0 })).toThrow(
      'INVALID_MAX_SHOWCASE_ROOMS',
    );
    expect(new SlotRegistry({ maxRooms: 10 }).maxShowcaseRooms).toBe(1);
  });
});

// S15P21C204-366. 계정 주체는 출처와 다른 한도로 센다.
describe('SlotRegistry account owner limit', () => {
  it('applies maxRoomsPerAccount to account owners and maxRoomsPerOwner to origins', () => {
    const slots = new SlotRegistry({ maxRooms: 6, maxRoomsPerOwner: 2, maxRoomsPerAccount: 1 });
    const account = { create: true, openedBy: 'sso:a', ownerKind: 'account' } as const;
    expect(slots.reserve('ROOM01', 'a1', 0, account)).toBe('reserved');
    expect(slots.reserve('ROOM02', 'a2', 0, account)).toBe('OWNER_LIMIT');
    expect(slots.reserve('ROOM02', 'g1', 0, { create: true, openedBy: 'guest:x' })).toBe(
      'reserved',
    );
    expect(slots.reserve('ROOM03', 'g2', 0, { create: true, openedBy: 'guest:x' })).toBe(
      'reserved',
    );
    expect(() => new SlotRegistry({ maxRooms: 2, maxRoomsPerAccount: 0 })).toThrow(
      'INVALID_MAX_ROOMS_PER_ACCOUNT',
    );
  });
});

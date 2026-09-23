/**
 * Logical seat accounting across rooms: RESERVED (session issued), JOINED (connected) and
 * RETIRING (left but remote media not yet confirmed released). A match room holds 6 seats and a
 * demo room holds 1; service capacity is 60 seats and the number of rooms is the F-verified
 * limit. Both limits count the rooms players join (match and showcase): demo rooms have their own
 * small room budget (S15P21C204-312), so a demonstration never takes a room or a seat away. A RETIRING seat still counts; only `releaseConfirmed` (after E confirms retirement)
 * frees it.
 */
import type { Phase, Role } from '@kkakkung/protocol/game-schema';

export type SlotState = 'RESERVED' | 'JOINED' | 'RETIRING';

/**
 * How a room was opened. A demo room (S15P21C204-258) holds one seat for the operator and its
 * chosen role; the other five participants are server-driven puppets that never take a seat.
 */
export type RoomKind = 'match' | 'demo' | 'showcase';

export type RoomOptions = Readonly<{
  capacity: number;
  kind: RoomKind;
  operatorRole: Role | null;
}>;

/** 시연 방(showcase)은 실제 사람 넷이 2:2 로 뛴다. 역할은 각자 고르고 한 역할에 둘까지다. */
export const SHOWCASE_CAPACITY = 4;

export type ReserveResult =
  | 'reserved'
  | 'ROOM_FULL'
  | 'ROLE_FULL'
  | 'SERVICE_FULL'
  | 'ROOM_LIMIT'
  | 'DEMO_LIMIT'
  | 'OWNER_LIMIT'
  | 'ROOM_CLOSED';

type RoomEntry = {
  roomCode: string;
  phase: Phase;
  capacity: number;
  kind: RoomKind;
  operatorRole: Role | null;
  /** `role` 은 시연 방에서 참가자가 고른 역할이다. 다른 방은 서버가 배정하므로 없다. */
  slots: Map<string, { state: SlotState; joinOrder: number; role?: Role }>;
  nextJoinOrder: number;
  createdAtMs: number;
  lastActivityMs: number;
  phaseStartedAtMs: number;
  closing: boolean;
  joinLocked: boolean;
  accessRevision: number;
  /**
   * 이 방을 연 주체(S15P21C204-293). 게스트 생성에만 붙는 불투명한 키이며 팀 입장은 null 이다.
   * 한 주체가 방 예산 전체를 가져가지 못하게 세는 데만 쓰고 다른 판단에는 쓰지 않는다.
   */
  openedBy: string | null;
};

export const JOINABLE_PHASES: readonly Phase[] = ['LOBBY', 'DEVICE_CHECK'];

export class SlotRegistry {
  private readonly rooms = new Map<string, RoomEntry>();
  readonly roomCapacity: number;
  readonly serviceCapacity: number;
  readonly maxRooms: number;
  /** 한 주체가 동시에 열어 둘 수 있는 방 수(S15P21C204-293). */
  readonly maxRoomsPerOwner: number;
  /** 한 SSO 계정이 동시에 열어 둘 수 있는 방 수(S15P21C204-366). 출처와 따로 센다. */
  readonly maxRoomsPerAccount: number;
  /** 동시에 열 수 있는 데모 방 수. maxRooms 와 따로 센다(S15P21C204-312). */
  readonly maxDemoRooms: number;

  constructor(options: {
    roomCapacity?: number;
    serviceCapacity?: number;
    maxRooms: number;
    maxRoomsPerOwner?: number;
    maxRoomsPerAccount?: number;
    maxDemoRooms?: number;
  }) {
    this.roomCapacity = options.roomCapacity ?? 6;
    this.serviceCapacity = options.serviceCapacity ?? 60;
    this.maxRooms = options.maxRooms;
    this.maxRoomsPerOwner = options.maxRoomsPerOwner ?? 2;
    this.maxRoomsPerAccount = options.maxRoomsPerAccount ?? 1;
    this.maxDemoRooms = options.maxDemoRooms ?? 1;
    if (!Number.isSafeInteger(this.maxDemoRooms) || this.maxDemoRooms < 1)
      throw new Error('INVALID_MAX_DEMO_ROOMS');
    if (!Number.isSafeInteger(this.maxRooms) || this.maxRooms < 1)
      throw new Error('INVALID_MAX_ROOMS');
    if (!Number.isSafeInteger(this.maxRoomsPerOwner) || this.maxRoomsPerOwner < 1)
      throw new Error('INVALID_MAX_ROOMS_PER_OWNER');
    if (!Number.isSafeInteger(this.maxRoomsPerAccount) || this.maxRoomsPerAccount < 1)
      throw new Error('INVALID_MAX_ROOMS_PER_ACCOUNT');
  }

  roomCodes(): ReadonlySet<string> {
    return new Set(this.rooms.keys());
  }

  hasRoom(roomCode: string) {
    return this.rooms.has(roomCode);
  }

  phaseOf(roomCode: string): Phase | null {
    return this.rooms.get(roomCode)?.phase ?? null;
  }

  access(roomCode: string): { locked: boolean; revision: number } | null {
    const room = this.rooms.get(roomCode);
    return room ? { locked: room.joinLocked, revision: room.accessRevision } : null;
  }

  setJoinLocked(roomCode: string, locked: boolean): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.closing || !JOINABLE_PHASES.includes(room.phase)) return false;
    if (room.joinLocked !== locked) room.accessRevision++;
    room.joinLocked = locked;
    return true;
  }

  canJoin(roomCode: string): boolean {
    const room = this.rooms.get(roomCode);
    return !!room && !room.closing && !room.joinLocked && JOINABLE_PHASES.includes(room.phase);
  }

  setPhase(roomCode: string, phase: Phase, nowMs: number) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    if (room.phase !== phase) room.phaseStartedAtMs = nowMs;
    room.phase = phase;
    room.lastActivityMs = nowMs;
  }

  /** 같은 주체가 지금 열어 두고 있는 방 수(S15P21C204-293). */
  roomsOpenedBy(owner: string): number {
    let count = 0;
    for (const room of this.rooms.values()) if (room.openedBy === owner) count++;
    return count;
  }

  touch(roomCode: string, nowMs: number) {
    const room = this.rooms.get(roomCode);
    if (room) room.lastActivityMs = nowMs;
  }

  lastActivity(roomCode: string): number | null {
    return this.rooms.get(roomCode)?.lastActivityMs ?? null;
  }

  phaseStartedAt(roomCode: string): number | null {
    return this.rooms.get(roomCode)?.phaseStartedAtMs ?? null;
  }

  /** Close admission immediately while async socket/media retirement is still pending. */
  beginClose(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (room) room.closing = true;
  }

  totalOccupied(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.slots.size;
    return total;
  }

  /**
   * Seats that count toward the service capacity: every room players join, match or showcase. A
   * demo operator's seat is not one of them; demo rooms have their own budget (S15P21C204-312).
   */
  playerOccupied(): number {
    let total = 0;
    for (const room of this.rooms.values()) if (room.kind !== 'demo') total += room.slots.size;
    return total;
  }

  /** Demo rooms, or every other room when `demo` is false. */
  private roomsCounted(demo: boolean): number {
    let count = 0;
    for (const room of this.rooms.values()) if ((room.kind === 'demo') === demo) count += 1;
    return count;
  }

  occupied(roomCode: string): number {
    return this.rooms.get(roomCode)?.slots.size ?? 0;
  }

  slotState(roomCode: string, playerId: string): SlotState | null {
    return this.rooms.get(roomCode)?.slots.get(playerId)?.state ?? null;
  }

  /** How the room was opened. Null when the room no longer exists. */
  optionsOf(roomCode: string): RoomOptions | null {
    const room = this.rooms.get(roomCode);
    return room
      ? { capacity: room.capacity, kind: room.kind, operatorRole: room.operatorRole }
      : null;
  }

  /** New participants only in LOBBY/DEVICE_CHECK; refills during a match are refused. */
  reserve(
    roomCode: string,
    playerId: string,
    nowMs: number,
    options: {
      create?: boolean;
      demo?: { operatorRole: Role };
      /** 시연 방 자리. 방을 새로 열 때는 종류를 정하고, 있는 방에서는 고른 역할의 빈자리를 찾는다. */
      showcase?: { role: Role };
      openedBy?: string | null;
      /** 주체가 출처(게스트)인지 SSO 계정인지. 한도가 다르다. 생략하면 출처. */
      ownerKind?: 'origin' | 'account';
    } = {},
  ): ReserveResult {
    let room = this.rooms.get(roomCode);
    if (!room) {
      if (!options.create) return 'ROOM_CLOSED';
      if (options.demo) {
        if (this.roomsCounted(true) >= this.maxDemoRooms) return 'DEMO_LIMIT';
      } else if (this.roomsCounted(false) >= this.maxRooms) return 'ROOM_LIMIT';
      // 전역 예산을 한 주체가 다 가져가지 못하게 한다. 방이 닫히면 항목이 사라지므로 따로
      // 정리할 계수기를 두지 않고 매번 센다(방은 최대 열 개다).
      const ownerLimit =
        options.ownerKind === 'account' ? this.maxRoomsPerAccount : this.maxRoomsPerOwner;
      if (options.openedBy && this.roomsOpenedBy(options.openedBy) >= ownerLimit)
        return 'OWNER_LIMIT';
      room = {
        roomCode,
        phase: 'LOBBY',
        // A demo room seats only the operator; its five puppets are server-side participants.
        capacity: options.demo ? 1 : options.showcase ? SHOWCASE_CAPACITY : this.roomCapacity,
        kind: options.demo ? 'demo' : options.showcase ? 'showcase' : 'match',
        operatorRole: options.demo?.operatorRole ?? null,
        slots: new Map(),
        nextJoinOrder: 0,
        createdAtMs: nowMs,
        lastActivityMs: nowMs,
        phaseStartedAtMs: nowMs,
        closing: false,
        joinLocked: false,
        accessRevision: 0,
        openedBy: options.openedBy ?? null,
      };
      this.rooms.set(roomCode, room);
    }
    if (room.closing || room.joinLocked) return 'ROOM_CLOSED';
    if (room.slots.has(playerId)) return 'reserved';
    if (!JOINABLE_PHASES.includes(room.phase)) return 'ROOM_CLOSED';
    if (room.slots.size >= room.capacity) return 'ROOM_FULL';
    if (room.kind !== 'demo' && this.playerOccupied() >= this.serviceCapacity)
      return 'SERVICE_FULL';
    if (room.kind === 'showcase') {
      // 시연 방은 역할을 고르고 들어온다. 고른 역할이 이미 절반을 채웠으면 다른 역할을 고르게 한다.
      const role = options.showcase?.role;
      if (!role) return 'ROOM_CLOSED';
      const sameRole = [...room.slots.values()].filter((slot) => slot.role === role).length;
      if (sameRole >= room.capacity / 2) return 'ROLE_FULL';
      room.slots.set(playerId, { state: 'RESERVED', joinOrder: room.nextJoinOrder++, role });
    } else room.slots.set(playerId, { state: 'RESERVED', joinOrder: room.nextJoinOrder++ });
    room.lastActivityMs = nowMs;
    return 'reserved';
  }

  /** 지금 들어갈 수 있는 시연 방. `/showcase` 를 연 사람은 모두 이 방에 모인다. 없으면 null. */
  joinableShowcaseRoom(): string | null {
    for (const room of this.rooms.values()) {
      if (room.kind !== 'showcase' || room.closing || room.joinLocked) continue;
      if (!JOINABLE_PHASES.includes(room.phase)) continue;
      if (room.slots.size >= room.capacity) continue;
      return room.roomCode;
    }
    return null;
  }

  /**
   * 아직 모이는 중인 시연 방이 있는가. 찼거나 잠긴 방이 있으면 새 방을 열어 무리를 둘로 나누지
   * 않고 CAPACITY 로 답한다. 경기가 시작되거나 끝난 방은 세지 않아 다음 시연이 새 방을 열 수 있다.
   */
  formingShowcaseRoom(): boolean {
    for (const room of this.rooms.values())
      if (room.kind === 'showcase' && !room.closing && JOINABLE_PHASES.includes(room.phase))
        return true;
    return false;
  }

  /** 시연 방 참가자가 고른 역할. 방이 역할을 배정할 때 계획으로 넘긴다. */
  requestedRoles(roomCode: string): Map<string, Role> {
    const roles = new Map<string, Role>();
    const room = this.rooms.get(roomCode);
    if (!room) return roles;
    for (const [playerId, slot] of room.slots) if (slot.role) roles.set(playerId, slot.role);
    return roles;
  }

  markJoined(roomCode: string, playerId: string, nowMs: number): boolean {
    const room = this.rooms.get(roomCode);
    if (room?.closing || room?.joinLocked) return false;
    const slot = room?.slots.get(playerId);
    if (!slot || slot.state === 'RETIRING') return false;
    slot.state = 'JOINED';
    this.touch(roomCode, nowMs);
    return true;
  }

  /** A seat whose media generation is still being retired remotely stays occupied. */
  markRetiring(roomCode: string, playerId: string) {
    const slot = this.rooms.get(roomCode)?.slots.get(playerId);
    if (slot) slot.state = 'RETIRING';
  }

  /** Frees a seat that never had media or whose retirement was confirmed. */
  release(
    roomCode: string,
    playerId: string,
    options: { confirmedRetirement?: boolean } = {},
  ): boolean {
    const room = this.rooms.get(roomCode);
    const slot = room?.slots.get(playerId);
    if (!room || !slot) return false;
    if (slot.state === 'RETIRING' && !options.confirmedRetirement) return false;
    room.slots.delete(playerId);
    return true;
  }

  joinOrder(roomCode: string, playerId: string): number | null {
    return this.rooms.get(roomCode)?.slots.get(playerId)?.joinOrder ?? null;
  }

  members(
    roomCode: string,
  ): { playerId: string; state: SlotState; joinOrder: number; role?: Role }[] {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return [...room.slots.entries()]
      .map(([playerId, slot]) => ({ playerId, ...slot }))
      .sort((a, b) => a.joinOrder - b.joinOrder);
  }

  /** Idempotent. Only an empty room disappears; RETIRING seats keep the room alive. */
  closeRoom(roomCode: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return true;
    if (room.slots.size > 0) return false;
    this.rooms.delete(roomCode);
    return true;
  }

  /** Read-only counts for E's getGameActivity; each seat is counted once. */
  activity(): { activeMatches: number; activePractices: number; pendingAdmissions: number } {
    let activeMatches = 0;
    let activePractices = 0;
    let pendingAdmissions = 0;
    for (const room of this.rooms.values()) {
      if (room.phase === 'TEAM_PRACTICE') activePractices++;
      else if (['MAP_FINALIZING', 'GAME_LOADING', 'COUNTDOWN', 'PLAYING'].includes(room.phase))
        activeMatches++;
      for (const slot of room.slots.values()) if (slot.state === 'RESERVED') pendingAdmissions++;
    }
    return { activeMatches, activePractices, pendingAdmissions };
  }
}

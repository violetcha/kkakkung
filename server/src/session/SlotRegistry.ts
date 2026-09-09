/**
 * Logical seat accounting across rooms: RESERVED (session issued), JOINED (connected) and
 * RETIRING (left but remote media not yet confirmed released). Room capacity is 6 seats,
 * service capacity is 60 seats and the number of rooms is the F-verified limit. A RETIRING
 * seat still counts; only `releaseConfirmed` (after E confirms retirement) frees it.
 */
import type { Phase } from '@kkakkung/protocol/game-schema';

export type SlotState = 'RESERVED' | 'JOINED' | 'RETIRING';

export type ReserveResult =
  'reserved' | 'ROOM_FULL' | 'SERVICE_FULL' | 'ROOM_LIMIT' | 'ROOM_CLOSED';

type RoomEntry = {
  roomCode: string;
  phase: Phase;
  slots: Map<string, { state: SlotState; joinOrder: number }>;
  nextJoinOrder: number;
  createdAtMs: number;
  lastActivityMs: number;
};

export const JOINABLE_PHASES: readonly Phase[] = ['LOBBY', 'DEVICE_CHECK'];

export class SlotRegistry {
  private readonly rooms = new Map<string, RoomEntry>();
  readonly roomCapacity: number;
  readonly serviceCapacity: number;
  readonly maxRooms: number;

  constructor(options: { roomCapacity?: number; serviceCapacity?: number; maxRooms: number }) {
    this.roomCapacity = options.roomCapacity ?? 6;
    this.serviceCapacity = options.serviceCapacity ?? 60;
    this.maxRooms = options.maxRooms;
    if (!Number.isSafeInteger(this.maxRooms) || this.maxRooms < 1)
      throw new Error('INVALID_MAX_ROOMS');
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

  setPhase(roomCode: string, phase: Phase, nowMs: number) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    room.phase = phase;
    room.lastActivityMs = nowMs;
  }

  touch(roomCode: string, nowMs: number) {
    const room = this.rooms.get(roomCode);
    if (room) room.lastActivityMs = nowMs;
  }

  lastActivity(roomCode: string): number | null {
    return this.rooms.get(roomCode)?.lastActivityMs ?? null;
  }

  totalOccupied(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.slots.size;
    return total;
  }

  occupied(roomCode: string): number {
    return this.rooms.get(roomCode)?.slots.size ?? 0;
  }

  slotState(roomCode: string, playerId: string): SlotState | null {
    return this.rooms.get(roomCode)?.slots.get(playerId)?.state ?? null;
  }

  /** New participants only in LOBBY/DEVICE_CHECK; refills during a match are refused. */
  reserve(
    roomCode: string,
    playerId: string,
    nowMs: number,
    options: { create?: boolean } = {},
  ): ReserveResult {
    let room = this.rooms.get(roomCode);
    if (!room) {
      if (!options.create) return 'ROOM_CLOSED';
      if (this.rooms.size >= this.maxRooms) return 'ROOM_LIMIT';
      room = {
        roomCode,
        phase: 'LOBBY',
        slots: new Map(),
        nextJoinOrder: 0,
        createdAtMs: nowMs,
        lastActivityMs: nowMs,
      };
      this.rooms.set(roomCode, room);
    }
    if (room.slots.has(playerId)) return 'reserved';
    if (!JOINABLE_PHASES.includes(room.phase)) return 'ROOM_CLOSED';
    if (room.slots.size >= this.roomCapacity) return 'ROOM_FULL';
    if (this.totalOccupied() >= this.serviceCapacity) return 'SERVICE_FULL';
    room.slots.set(playerId, { state: 'RESERVED', joinOrder: room.nextJoinOrder++ });
    room.lastActivityMs = nowMs;
    return 'reserved';
  }

  markJoined(roomCode: string, playerId: string, nowMs: number): boolean {
    const slot = this.rooms.get(roomCode)?.slots.get(playerId);
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

  members(roomCode: string): { playerId: string; state: SlotState; joinOrder: number }[] {
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

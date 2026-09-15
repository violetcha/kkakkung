import { randomUUID } from 'node:crypto';
import { freezeSnapshot } from '../operations/ImmutableSnapshot.js';
import type { SplitMediaOwnership } from '../operations/SplitMediaOwnership.js';
import type { PrepareGenerationRequest, TrustedMediaFrame } from './types.js';

export type Generation = {
  request: PrepareGenerationRequest;
  generation: number;
  roomName: string;
  identity: string;
  serverEpoch: string;
  reservationId: string;
  issuedAtEpochMs: number;
  expiresAtEpochMs: number;
  splitOwnership?: SplitMediaOwnership;
  terminal: boolean;
  state: 'PREPARED' | 'REVOKING' | 'REVOKED' | 'UNRESOLVED';
};

const playerKey = (matchId: string, playerId: string) => JSON.stringify([matchId, playerId]);
const instanceKey = (matchId: string, instanceId: string) => JSON.stringify([matchId, instanceId]);

export class MediaGenerationRegistry {
  readonly serverEpoch = randomUUID();
  private readonly current = new Map<string, Generation>();
  private readonly generations: Generation[] = [];
  private readonly unissued = new WeakSet<Generation>();
  private readonly rooms = new Map<string, string>();
  private readonly splitRosters = new Map<string, readonly string[]>();
  private readonly frames = new Map<string, TrustedMediaFrame>();
  private readonly playerInstances = new Map<string, string>();
  private readonly obsoleteScopes = new Set<string>();
  private readonly openMatches = new Set<string>();
  private closed = false;

  constructor(
    readonly namespace: string,
    private readonly requireOpenMatch = false,
    private readonly transport: 'single' | 'split' = 'single',
  ) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(namespace) || namespace.includes('--')) {
      throw new Error('INVALID_NAMESPACE');
    }
  }

  /** Only authenticated Room ownership may open a match; a frame cannot reopen it. */
  openMatch(matchId: string): boolean {
    if (
      this.closed ||
      !matchId ||
      (!this.openMatches.has(matchId) && this.openMatches.size >= 4096)
    )
      return false;
    this.openMatches.add(matchId);
    return true;
  }
  isMatchOpen(matchId: string): boolean {
    return !this.closed && this.openMatches.has(matchId);
  }
  endMatch(matchId: string): void {
    this.openMatches.delete(matchId);
    const belongs = (key: string) => JSON.parse(key)[0] === matchId;
    for (const key of this.frames.keys()) if (belongs(key)) this.frames.delete(key);
    for (const key of this.rooms.keys()) if (belongs(key)) this.rooms.delete(key);
    for (const key of this.splitRosters.keys()) if (belongs(key)) this.splitRosters.delete(key);
    for (const key of this.current.keys()) if (belongs(key)) this.current.delete(key);
    for (const key of this.playerInstances.keys())
      if (belongs(key)) this.playerInstances.delete(key);
    for (const key of this.obsoleteScopes)
      if (belongs(JSON.parse(key)[0])) this.obsoleteScopes.delete(key);
    // Keep objects until remote revocation and durable accounting have been confirmed.
    for (const generation of this.generations)
      if (generation.request.matchId === matchId) generation.terminal = true;
  }
  prune(canForget: (generation: Generation) => boolean): Generation[] {
    const removed: Generation[] = [];
    for (let i = this.generations.length - 1; i >= 0; i--) {
      const generation = this.generations[i]!;
      if (
        !generation.terminal ||
        generation.state !== 'REVOKED' ||
        this.get(generation.request.matchId, generation.request.playerId) === generation ||
        !canForget(generation)
      )
        continue;
      this.generations.splice(i, 1);
      removed.push(generation);
    }
    return removed;
  }
  get retained() {
    return {
      generations: this.generations.length,
      current: this.current.size,
      rooms: this.rooms.size,
      frames: this.frames.size,
      players: this.playerInstances.size,
      obsoleteScopes: this.obsoleteScopes.size,
      openMatches: this.openMatches.size,
    };
  }

  observe(frame: TrustedMediaFrame): boolean {
    if (this.closed || !Number.isSafeInteger(frame.frameRevision) || frame.frameRevision < 0)
      return false;
    if (this.requireOpenMatch && !this.isMatchOpen(frame.matchId)) return false;
    const key = instanceKey(frame.matchId, frame.mediaInstanceId);
    if (this.transport === 'split') {
      const ids = frame.participants.map((participant) => participant.playerId);
      const roster = this.splitRosters.get(key);
      if (
        ids.length > 6 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !id || (roster && !roster.includes(id)))
      )
        return false;
    }
    const old = this.frames.get(key);
    if (!old && this.frames.size >= 4096) return false;
    if (old && frame.frameRevision <= old.frameRevision) return false;
    if (old && old.instancePurpose !== frame.instancePurpose) return false;
    for (const participant of frame.participants) {
      const player = playerKey(frame.matchId, participant.playerId);
      const scoped = JSON.stringify([player, frame.mediaInstanceId]);
      if (this.obsoleteScopes.has(scoped)) continue;
      const previous = this.playerInstances.get(player);
      if (previous && previous !== frame.mediaInstanceId)
        this.obsoleteScopes.add(JSON.stringify([player, previous]));
      this.playerInstances.set(player, frame.mediaInstanceId);
    }
    this.frames.set(key, structuredClone(frame));
    return true;
  }

  eligible(input: PrepareGenerationRequest): boolean {
    const frame = this.frames.get(instanceKey(input.matchId, input.mediaInstanceId));
    if (
      this.closed ||
      (this.requireOpenMatch && !this.isMatchOpen(input.matchId)) ||
      !frame ||
      frame.instancePurpose !== input.purpose
    )
      return false;
    if (
      this.playerInstances.get(playerKey(input.matchId, input.playerId)) !== input.mediaInstanceId
    )
      return false;
    if (!frame.participants.some((p) => p.playerId === input.playerId && p.status === 'ACTIVE'))
      return false;
    return input.purpose === 'practice'
      ? frame.phase === 'TEAM_PRACTICE'
      : ['GAME_LOADING', 'COUNTDOWN', 'PLAYING'].includes(frame.phase);
  }

  get(matchId: string, playerId: string): Generation | undefined {
    return this.current.get(playerKey(matchId, playerId));
  }

  isLatestScope(matchId: string, playerId: string, mediaInstanceId: string): boolean {
    return (
      !this.closed && this.playerInstances.get(playerKey(matchId, playerId)) === mediaInstanceId
    );
  }

  all(): readonly Generation[] {
    return [...this.generations];
  }

  capacityFor(input?: PrepareGenerationRequest): number {
    if (this.transport !== 'split') return 1;
    if (!input) return 12;
    const key = instanceKey(input.matchId, input.mediaInstanceId);
    return (
      2 * (this.splitRosters.get(key)?.length ?? this.frames.get(key)?.participants.length ?? 6)
    );
  }

  /** Only a definitive reservation rejection BEFORE persistence/signing may use this path. */
  abandonUnissued(value: Generation): void {
    if (!this.generations.includes(value)) throw new Error('UNKNOWN_GENERATION');
    value.terminal = true;
    value.state = 'REVOKED';
    this.unissued.add(value);
  }

  wasNeverIssued(value: Generation): boolean {
    return this.unissued.has(value);
  }

  allocate(input: PrepareGenerationRequest, nowEpochMs: number): Generation {
    if (!this.eligible(input)) throw new Error('WRONG_SCOPE');
    if (this.generations.length >= 4096) throw new Error('NOT_READY');
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs <= 0) throw new Error('INVALID_CLOCK');
    const old = this.get(input.matchId, input.playerId);
    if (
      (old?.generation ?? null) !== input.expectedPreviousGeneration ||
      (old && old.state !== 'REVOKED')
    ) {
      throw new Error('STALE_GENERATION');
    }
    const key = instanceKey(input.matchId, input.mediaInstanceId);
    const sharedRoom = this.room(key);
    let roomName = sharedRoom;
    let splitOwnership: SplitMediaOwnership | undefined;
    if (this.transport === 'split') {
      let roster = this.splitRosters.get(key);
      if (!roster) {
        roster = Object.freeze(
          this.frames
            .get(key)!
            .participants.map((participant) => participant.playerId)
            .sort(),
        );
        this.splitRosters.set(key, roster);
      }
      if (!roster.includes(input.playerId)) throw new Error('WRONG_SCOPE');
      const receiverRoom = (playerId: string) =>
        this.room(JSON.stringify([input.matchId, input.mediaInstanceId, playerId]));
      roomName = receiverRoom(input.playerId);
      // An owned frozen snapshot lets readiness reuse its accounting without re-comparing it.
      splitOwnership = freezeSnapshot({
        faceRoomName: sharedRoom,
        faceIdentity: `${this.namespace}--${this.serverEpoch}--${randomUUID()}`,
        receiverRoomNames: roster
          .filter((playerId) => playerId !== input.playerId)
          .map(receiverRoom),
      });
    }
    const value: Generation = {
      request: { ...input },
      generation: (old?.generation ?? 0) + 1,
      roomName,
      identity: `${this.namespace}--${this.serverEpoch}--${randomUUID()}`,
      serverEpoch: this.serverEpoch,
      reservationId: randomUUID(),
      issuedAtEpochMs: nowEpochMs,
      expiresAtEpochMs: nowEpochMs + 300_000,
      ...(splitOwnership ? { splitOwnership } : {}),
      terminal: false,
      state: 'PREPARED',
    };
    this.current.set(playerKey(input.matchId, input.playerId), value);
    this.generations.push(value);
    return value;
  }

  private room(key: string): string {
    let roomName = this.rooms.get(key);
    if (!roomName) {
      roomName = `${this.namespace}--${this.serverEpoch}--${randomUUID()}`;
      this.rooms.set(key, roomName);
    }
    return roomName;
  }

  isCurrent(value: Generation): boolean {
    return (
      !this.closed &&
      !value.terminal &&
      this.get(value.request.matchId, value.request.playerId) === value &&
      this.eligible(value.request)
    );
  }

  close(): void {
    this.closed = true;
    for (const value of this.generations) value.terminal = true;
    this.frames.clear();
    this.playerInstances.clear();
    this.obsoleteScopes.clear();
    this.openMatches.clear();
    this.splitRosters.clear();
  }
}

import { randomUUID } from 'node:crypto';
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
  terminal: boolean;
  state: 'PREPARED' | 'REVOKING' | 'REVOKED' | 'UNRESOLVED';
};

const playerKey = (matchId: string, playerId: string) => JSON.stringify([matchId, playerId]);
const instanceKey = (matchId: string, instanceId: string) => JSON.stringify([matchId, instanceId]);

export class MediaGenerationRegistry {
  readonly serverEpoch = randomUUID();
  private readonly current = new Map<string, Generation>();
  private readonly generations: Generation[] = [];
  private readonly rooms = new Map<string, string>();
  private readonly frames = new Map<string, TrustedMediaFrame>();
  private readonly playerInstances = new Map<string, string>();
  private readonly obsoleteScopes = new Set<string>();
  private closed = false;

  constructor(readonly namespace: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(namespace) || namespace.includes('--')) {
      throw new Error('INVALID_NAMESPACE');
    }
  }

  observe(frame: TrustedMediaFrame): boolean {
    if (this.closed || !Number.isSafeInteger(frame.frameRevision) || frame.frameRevision < 0)
      return false;
    const key = instanceKey(frame.matchId, frame.mediaInstanceId);
    const old = this.frames.get(key);
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
    if (this.closed || !frame || frame.instancePurpose !== input.purpose) return false;
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

  all(): readonly Generation[] {
    return [...this.generations];
  }

  allocate(input: PrepareGenerationRequest, nowEpochMs: number): Generation {
    if (!this.eligible(input)) throw new Error('WRONG_SCOPE');
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs <= 0) throw new Error('INVALID_CLOCK');
    const old = this.get(input.matchId, input.playerId);
    if (
      (old?.generation ?? null) !== input.expectedPreviousGeneration ||
      (old && old.state !== 'REVOKED')
    ) {
      throw new Error('STALE_GENERATION');
    }
    const key = instanceKey(input.matchId, input.mediaInstanceId);
    let roomName = this.rooms.get(key);
    if (!roomName) {
      roomName = `${this.namespace}--${this.serverEpoch}--${randomUUID()}`;
      this.rooms.set(key, roomName);
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
      terminal: false,
      state: 'PREPARED',
    };
    this.current.set(playerKey(input.matchId, input.playerId), value);
    this.generations.push(value);
    return value;
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
  }
}

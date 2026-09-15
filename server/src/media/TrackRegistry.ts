import { TrackSource, TrackType } from 'livekit-server-sdk';
import type { MediaBinding } from './types.js';

export type TrackOwner = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  mediaRoomName: string;
  playerId: string;
  mediaIdentity: string;
  publisherGeneration: number;
}>;
export type RemoteParticipant = Readonly<{
  sid: string;
  identity: string;
  tracks: readonly Readonly<{ sid: string; source: number; type: number }>[];
}>;
export type TrackBinding = TrackOwner &
  Readonly<{
    participantSid: string;
    source: 'camera' | 'microphone';
    trackSid: string;
    verifiedAt: number;
  }>;
export type TrackRegistryDependencies = Readonly<{
  now: () => number;
  getParticipant: (owner: TrackOwner) => Promise<RemoteParticipant | null>;
  onChanged: (owner: TrackOwner) => void;
  onUnauthorized: (owner: TrackOwner, reason: string) => void;
}>;
type RegistryEntry = {
  owner: TrackOwner;
  participantSid: string | null;
  bindings: TrackBinding[];
  dirty: boolean;
  dirtyRevision: number;
  lastAttemptAt: number;
  lastVerifiedAt: number | null;
  pending: Promise<void> | null;
  terminal: boolean;
};

export class TrackRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  constructor(private readonly deps: TrackRegistryDependencies) {}

  register(owner: TrackOwner): void {
    const key = this.key(owner);
    if (this.entries.has(key)) return;
    for (const entry of this.entries.values()) {
      if (
        !entry.terminal &&
        entry.owner.mediaRoomName === owner.mediaRoomName &&
        (entry.owner.mediaIdentity === owner.mediaIdentity ||
          (entry.owner.matchId === owner.matchId && entry.owner.playerId === owner.playerId))
      ) {
        throw new Error('TRACK_OWNER_CONFLICT');
      }
    }
    this.entries.set(key, {
      owner: { ...owner },
      participantSid: null,
      bindings: [],
      dirty: true,
      dirtyRevision: 1,
      lastAttemptAt: -Infinity,
      lastVerifiedAt: null,
      pending: null,
      terminal: false,
    });
  }

  retire(owner: TrackOwner): void {
    const entry = this.entries.get(this.key(owner));
    if (!entry || entry.terminal) return;
    entry.terminal = true;
    entry.dirty = false;
    entry.bindings = [];
    this.deps.onChanged(entry.owner);
  }
  /** Retirement latches the captured query before its lookup entry is removed. */
  forget(owner: TrackOwner): void {
    this.retire(owner);
    this.entries.delete(this.key(owner));
  }
  get retained() {
    return this.entries.size;
  }
  markDirty(owner: TrackOwner): void {
    const entry = this.entries.get(this.key(owner));
    if (!entry || entry.terminal) return;
    entry.dirty = true;
    entry.dirtyRevision++;
  }
  /** Authenticated event is only a query trigger, including reordered unpublish. */
  markEvent(event: { roomName: string; identity?: string }): boolean {
    let matched = false;
    for (const entry of this.entries.values()) {
      if (
        !entry.terminal &&
        entry.owner.mediaRoomName === event.roomName &&
        (event.identity === undefined || entry.owner.mediaIdentity === event.identity)
      ) {
        this.markDirty(entry.owner);
        matched = true;
      }
    }
    return matched;
  }

  async reconcileDue(): Promise<void> {
    const requests: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (entry.terminal) continue;
      if (entry.lastVerifiedAt !== null && this.deps.now() - entry.lastVerifiedAt >= 30_000)
        entry.dirty = true;
      if (entry.pending) {
        requests.push(entry.pending);
        continue;
      }
      if (!entry.dirty || this.deps.now() - entry.lastAttemptAt < 5000) continue;
      entry.lastAttemptAt = this.deps.now();
      const revision = entry.dirtyRevision;
      const pending = this.reconcile(entry, revision);
      entry.pending = pending;
      requests.push(pending);
    }
    await Promise.all(requests);
  }

  bindingFor(owner: TrackOwner): MediaBinding | null {
    const entry = this.entries.get(this.key(owner));
    return entry ? this.bindingOf(entry) : null;
  }
  listBindings(matchId: string, mediaInstanceId: string): MediaBinding[] {
    const bindings: MediaBinding[] = [];
    for (const entry of this.entries.values()) {
      if (entry.owner.matchId !== matchId || entry.owner.mediaInstanceId !== mediaInstanceId)
        continue;
      const binding = this.bindingOf(entry);
      if (binding) bindings.push(binding);
    }
    return bindings.sort((a, b) => a.playerId.localeCompare(b.playerId));
  }
  /** Verified bindings in this scope that currently carry the track (normally exactly one). */
  bindingsForTrack(matchId: string, mediaInstanceId: string, trackSid: string): MediaBinding[] {
    const bindings: MediaBinding[] = [];
    for (const entry of this.entries.values()) {
      if (entry.owner.matchId !== matchId || entry.owner.mediaInstanceId !== mediaInstanceId)
        continue;
      if (!entry.bindings.some((track) => track.trackSid === trackSid)) continue;
      const binding = this.bindingOf(entry);
      if (binding && (binding.faceTrackSid === trackSid || binding.audioTrackSid === trackSid))
        bindings.push(binding);
    }
    return bindings;
  }
  private bindingOf(entry: RegistryEntry): MediaBinding | null {
    if (entry.terminal || !entry.participantSid || !entry.bindings.length) return null;
    const face = entry.bindings.find((track) => track.source === 'camera');
    const audio = entry.bindings.find((track) => track.source === 'microphone');
    return {
      playerId: entry.owner.playerId,
      publisherGeneration: entry.owner.publisherGeneration,
      mediaIdentity: entry.owner.mediaIdentity,
      participantSid: entry.participantSid,
      ...(face ? { faceTrackSid: face.trackSid } : {}),
      ...(audio ? { audioTrackSid: audio.trackSid } : {}),
    };
  }
  validateTrack(
    receiver: { matchId: string; mediaInstanceId: string; mediaRoomName: string },
    trackSid: string,
  ): boolean {
    return [...this.entries.values()].some(
      (entry) =>
        !entry.terminal &&
        entry.owner.matchId === receiver.matchId &&
        entry.owner.mediaInstanceId === receiver.mediaInstanceId &&
        entry.owner.mediaRoomName === receiver.mediaRoomName &&
        entry.bindings.some((track) => track.trackSid === trackSid),
    );
  }
  inspect(owner: TrackOwner) {
    const entry = this.entries.get(this.key(owner));
    return entry
      ? {
          dirty: entry.dirty,
          terminal: entry.terminal,
          lastVerifiedAt: entry.lastVerifiedAt,
          bindings: entry.bindings.map((binding) => ({ ...binding })),
        }
      : null;
  }

  getTrackFingerprint(
    receiver: { matchId: string; mediaInstanceId: string; mediaRoomName: string },
    trackSid: string,
  ): string | null {
    for (const entry of this.entries.values()) {
      if (
        entry.terminal ||
        entry.owner.matchId !== receiver.matchId ||
        entry.owner.mediaInstanceId !== receiver.mediaInstanceId ||
        entry.owner.mediaRoomName !== receiver.mediaRoomName
      )
        continue;
      const track = entry.bindings.find((binding) => binding.trackSid === trackSid);
      if (track)
        return JSON.stringify([
          track.mediaInstanceId,
          track.mediaIdentity,
          track.publisherGeneration,
          track.participantSid,
          track.source,
          track.trackSid,
        ]);
    }
    return null;
  }

  private async reconcile(entry: RegistryEntry, revision: number): Promise<void> {
    try {
      const participant = await this.deps.getParticipant(entry.owner);
      if (entry.terminal) return;
      if (entry.dirtyRevision !== revision) {
        entry.dirty = true;
        return;
      }
      const previous = JSON.stringify(this.bindingFor(entry.owner));
      if (!participant) {
        entry.bindings = [];
        // Absence removes publications, not the generation's confirmed participant identity.
        // A later full reconnect must retire this generation instead of adopting a new SID.
      } else {
        const reason = this.invalidPublication(entry, participant);
        if (reason) {
          entry.terminal = true;
          entry.bindings = [];
          this.deps.onChanged(entry.owner);
          this.deps.onUnauthorized(entry.owner, reason);
          return;
        }
        entry.participantSid = participant.sid;
        entry.bindings = participant.tracks.map((track) => ({
          ...entry.owner,
          participantSid: participant.sid,
          trackSid: track.sid,
          source: track.source === TrackSource.CAMERA ? 'camera' : 'microphone',
          verifiedAt: this.deps.now(),
        }));
      }
      entry.lastVerifiedAt = this.deps.now();
      entry.dirty = entry.dirtyRevision !== revision;
      if (previous !== JSON.stringify(this.bindingFor(entry.owner)))
        this.deps.onChanged(entry.owner);
    } catch {
      // A failed query grants no new SID and preserves the last confirmed safe relationship.
      entry.dirty = true;
    } finally {
      entry.pending = null;
    }
  }
  private invalidPublication(entry: RegistryEntry, participant: RemoteParticipant): string | null {
    if (participant.identity !== entry.owner.mediaIdentity || !participant.sid)
      return 'PARTICIPANT_MISMATCH';
    if (entry.participantSid && entry.participantSid !== participant.sid)
      return 'PARTICIPANT_SID_CHANGED';
    const seen = new Set<string>();
    let cameras = 0;
    let microphones = 0;
    for (const track of participant.tracks) {
      if (!track.sid || seen.has(track.sid)) return 'DUPLICATE_TRACK_SID';
      seen.add(track.sid);
      if (track.source === TrackSource.CAMERA && track.type === TrackType.VIDEO) cameras++;
      else if (track.source === TrackSource.MICROPHONE && track.type === TrackType.AUDIO)
        microphones++;
      else return 'UNAUTHORIZED_TRACK_SOURCE';
    }
    return cameras > 1 || microphones > 1 ? 'TOO_MANY_PUBLICATIONS' : null;
  }
  private key(owner: TrackOwner): string {
    return JSON.stringify([
      owner.matchId,
      owner.mediaInstanceId,
      owner.mediaRoomName,
      owner.playerId,
      owner.mediaIdentity,
      owner.publisherGeneration,
    ]);
  }
}

import type { AudibilityFrame } from './AudibilityPolicy.js';
import type { AudioPolicy, MediaBindings, MediaScope } from './types.js';

export class AudioProjection {
  private readonly state = new Map<string, { revision: number; fingerprint: string }>();

  project(frame: AudibilityFrame, playerId: string, bindings: MediaBindings): AudioPolicy | null {
    if (bindings.matchId !== frame.matchId || bindings.mediaInstanceId !== frame.mediaInstanceId)
      return null;
    const receiver = frame.receivers.find((entry) => entry.playerId === playerId);
    if (!receiver) return null;
    const voices: AudioPolicy['voices'][number][] = [];
    for (const voice of receiver.voices) {
      const binding = bindings.participants.find((entry) => entry.playerId === voice.playerId);
      if (binding?.audioTrackSid) voices.push({ ...voice, trackSid: binding.audioTrackSid });
    }
    const fingerprint = JSON.stringify([bindings.bindingRevision, voices, receiver.effects]);
    const key = this.key(bindings, playerId);
    const previous = this.state.get(key);
    if (previous?.fingerprint === fingerprint) return null;
    const revision = (previous?.revision ?? 0) + 1;
    this.state.set(key, { revision, fingerprint });
    return {
      matchId: frame.matchId,
      mediaInstanceId: frame.mediaInstanceId,
      receiverGeneration: bindings.receiverGeneration,
      policyRevision: revision,
      bindingRevision: bindings.bindingRevision,
      stateVersion: frame.stateVersion,
      voices,
      effects: receiver.effects,
    };
  }

  forget(scope: MediaScope, playerId: string): void {
    this.state.delete(this.key(scope, playerId));
  }
  private key(scope: MediaScope, playerId: string): string {
    return JSON.stringify([
      scope.matchId,
      scope.mediaInstanceId,
      playerId,
      scope.receiverGeneration,
    ]);
  }
}

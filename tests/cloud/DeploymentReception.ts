type Observation = {
  track: object;
  bytes: number;
  unmappedSince: number | null;
};

/** RTP counters belong to one subscribed track lifetime, not a reusable publication SID. */
export class DeploymentReception {
  private readonly observations = new Map<string, Observation>();
  private forbidden = 0;
  private readonly kinds = { video: 0, audio: 0 };
  private readonly reasons = { binding: 0, audioPolicy: 0 };

  observe(input: {
    sid: string;
    track: object;
    kind: 'video' | 'audio';
    bytes: number;
    now: number;
    bindingAllowed: boolean;
    allowed: boolean;
  }): boolean {
    const { sid, track, bytes, now, allowed } = input;
    let previous = this.observations.get(sid);
    if (previous?.track !== track) previous = undefined;
    const increased = !!previous && bytes > previous.bytes;
    const unmappedSince = allowed ? null : (previous?.unmappedSince ?? now);
    this.observations.set(sid, { track, bytes, unmappedSince });
    // Preserve the shared 2s mapping window and every confirmed violation until scope close.
    if (!allowed && increased && now - unmappedSince! > 2000) {
      this.forbidden++;
      this.kinds[input.kind]++;
      this.reasons[input.bindingAllowed ? 'audioPolicy' : 'binding']++;
    }
    return allowed && increased;
  }

  forget(sid: string): void {
    this.observations.delete(sid);
  }

  retain(active: ReadonlySet<string>): void {
    for (const sid of this.observations.keys()) if (!active.has(sid)) this.forget(sid);
  }

  snapshot() {
    return {
      forbiddenReceived: this.forbidden,
      forbiddenByKind: { ...this.kinds },
      forbiddenByReason: { ...this.reasons },
    };
  }

  reset(): void {
    this.observations.clear();
    this.forbidden = 0;
    this.kinds.video = this.kinds.audio = this.reasons.binding = this.reasons.audioPolicy = 0;
  }
}

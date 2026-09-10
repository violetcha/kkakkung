// F-02 / QA-01. Receiver-side accounting that decides "media really arrived" from markers and
// per-track RTC statistics, never from bytes alone. A new track SID or a new publisher
// generation resets the baseline; a same-SID replaceTrack keeps the accumulated counters and
// separates markers seen before and after the replacement. Buffered playback that continues
// after a deny is distinguished from newly transmitted markers by the marker's own serial.
// Pure state; the browser harness feeds it stats snapshots and detected markers.
export type TrackKey = Readonly<{
  mediaInstanceId: string;
  receiverGeneration: number;
  publisherGeneration: number;
  trackSid: string;
}>;

export type StatsSnapshot = Readonly<{
  atMs: number;
  bytesReceived: number;
  packetsReceived: number;
  framesDecoded?: number;
}>;

export type Marker = Readonly<{
  /** frameSerial of the synthetic face or the sequence of the synthetic tone. */
  serial: number;
  atMs: number;
}>;

type TrackState = {
  key: TrackKey;
  bindingRevision: number;
  baseline: StatsSnapshot | null;
  latest: StatsSnapshot | null;
  markers: Marker[];
  /** Marker serial at which the most recent same-SID replacement happened, or null. */
  replacedAtSerial: number | null;
  replacedAtMs: number | null;
};

const keyOf = (k: TrackKey) =>
  `${k.mediaInstanceId}|${k.receiverGeneration}|${k.publisherGeneration}|${k.trackSid}`;

export class MediaObserver {
  private readonly tracks = new Map<string, TrackState>();

  /** New SID or new generation: fresh baseline. Same key again: no-op. */
  track(key: TrackKey, bindingRevision: number): void {
    const id = keyOf(key);
    if (this.tracks.has(id)) return;
    this.tracks.set(id, {
      key,
      bindingRevision,
      baseline: null,
      latest: null,
      markers: [],
      replacedAtSerial: null,
      replacedAtMs: null,
    });
  }

  /** Same SID, new MediaStreamTrack behind it: counters stay, marker history is split here. */
  replaced(key: TrackKey, atMs: number, lastSerialBefore: number): void {
    const state = this.tracks.get(keyOf(key));
    if (!state) return;
    state.replacedAtSerial = lastSerialBefore;
    state.replacedAtMs = atMs;
  }

  stats(key: TrackKey, snapshot: StatsSnapshot): void {
    const state = this.tracks.get(keyOf(key));
    if (!state) return;
    if (!state.baseline) state.baseline = snapshot;
    state.latest = snapshot;
  }

  marker(key: TrackKey, marker: Marker): void {
    this.tracks.get(keyOf(key))?.markers.push(marker);
  }

  /** Bytes since the baseline of this SID/generation only; other SIDs are never summed in. */
  bytesSinceBaseline(key: TrackKey): number | null {
    const s = this.tracks.get(keyOf(key));
    if (!s?.baseline || !s.latest) return null;
    return s.latest.bytesReceived - s.baseline.bytesReceived;
  }

  /** Allow evidence: the first marker generated after `afterMs` arrived (not buffered replay). */
  firstNewMarkerAfter(key: TrackKey, afterMs: number, minSerial: number): Marker | null {
    const s = this.tracks.get(keyOf(key));
    if (!s) return null;
    return s.markers.find((m) => m.atMs >= afterMs && m.serial > minSerial) ?? null;
  }

  /**
   * Deny evidence: after `cutoffMs` no marker with a serial above `cutoffSerial` arrives within
   * `windowMs` (older serials are buffered replay), and the stats stop growing.
   */
  sustainedSilence(
    key: TrackKey,
    cutoffMs: number,
    cutoffSerial: number,
    windowMs: number,
  ): Readonly<{ silent: boolean; newMarkers: number; bytesAfterCutoff: number | null }> {
    const s = this.tracks.get(keyOf(key));
    if (!s) return { silent: false, newMarkers: 0, bytesAfterCutoff: null };
    const newMarkers = s.markers.filter(
      (m) => m.atMs >= cutoffMs && m.atMs <= cutoffMs + windowMs && m.serial > cutoffSerial,
    ).length;
    const bytesAfterCutoff =
      s.latest && s.baseline ? s.latest.bytesReceived - s.baseline.bytesReceived : null;
    return { silent: newMarkers === 0, newMarkers, bytesAfterCutoff };
  }

  /** Markers seen before and after a same-SID replacement, kept apart. */
  markersAroundReplacement(key: TrackKey): Readonly<{ before: number; after: number }> | null {
    const s = this.tracks.get(keyOf(key));
    if (!s || s.replacedAtSerial === null) return null;
    const before = s.markers.filter((m) => m.serial <= s.replacedAtSerial!).length;
    return { before, after: s.markers.length - before };
  }

  bindingRevision(key: TrackKey): number | null {
    return this.tracks.get(keyOf(key))?.bindingRevision ?? null;
  }
}

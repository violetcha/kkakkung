// F-02 / QA-01. The contract between the load probe page (tests/cloud/load-probe.ts) and its Node
// driver (tests/cloud/LoadProbePool.ts). Kept free of browser and Playwright imports so both sides
// and the Node tests can use it.
//
// Everything crossing this boundary is a number, a flag or an identifier. Grants go in, nothing
// that could carry a token, a frame or an audio sample comes back.
import type { AudioPolicy } from '../../apps/web/src/features/media/audio-policy';
import type { MediaBindings } from '../../apps/web/src/features/media/media-bindings';
import type { MediaEvidence } from '../../apps/web/src/features/media/media-evidence';
import type { MediaGrant } from '../../apps/web/src/features/media/media-types';

/** Publisher-side position of the synthetic markers at the moment of the reading. */
export type OutgoingMarkers = Readonly<{ frameSerial: number; toneSequence: number }>;

/** The point a policy decision is pinned to: later markers are new, earlier ones are replay. */
export type MarkerCutoff = Readonly<{ atMs: number; serial: number }>;

export type RemoteTrackReading = Readonly<{
  identity: string;
  trackSid: string;
  kind: 'video' | 'audio';
  subscribed: boolean;
  /** The server-verified binding names this track as this participant's. */
  bindingAllowed: boolean;
  /** Audio only: the applied policy resolves a voice with a gain above zero. */
  audible: boolean;
  /** Received bytes since this SID and generation were first seen, never summed across tracks. */
  bytesSinceBaseline: number | null;
  /** Latest decoded publisher marker, or null when nothing decodable has arrived yet. */
  lastMarker: MarkerCutoff | null;
  /** Markers decoded from this track since it was first seen. */
  markerCount: number;
  /**
   * A marker reader is attached to this track. For a face this is what the product calls an
   * attached remote face, and for audio it is what the product calls a routed voice: in both
   * cases the track reached a consumer instead of stopping at the SDK.
   */
  readerOpen: boolean;
}>;

export type LoadProbeSnapshot = Readonly<{
  connected: boolean;
  /** Browser clock at the reading, for the round-trip clock offset the evidence writer needs. */
  atMs: number;
  publishedTracks: readonly Readonly<{ sid: string; kind: 'video' | 'audio' }>[];
  outgoing: OutgoingMarkers;
  remote: readonly RemoteTrackReading[];
}>;

export type SilenceReading = Readonly<{
  silent: boolean;
  newMarkers: number;
  bytesAfterCutoff: number | null;
}>;

export interface LoadProbe {
  connect(grant: MediaGrant): Promise<void>;
  publish(): Promise<void>;
  applyBindings(bindings: MediaBindings): Promise<void>;
  applyAudioPolicy(policy: AudioPolicy): Promise<void>;
  /** Samples every received track once and returns the reading. The driver owns the cadence. */
  poll(): Promise<LoadProbeSnapshot>;
  /**
   * The product's own `MediaEvidence` for this participant (REQ-D-13). Built by the web app's
   * `composeMediaEvidence` from the same binding and policy stores the product uses, so a Cloud
   * runner reads the shape D defined rather than a probe-specific summary. It states facts and
   * never declares a gate passed: judging them is the caller's step.
   */
  evidence(): Promise<MediaEvidence>;
  /** Pins the current marker position of a track, to be passed back as a decision cutoff. */
  cutoff(trackSid: string): Promise<MarkerCutoff | null>;
  /** Allow evidence: the first marker produced after the cutoff, or null while none has arrived. */
  allowEffect(trackSid: string, cutoff: MarkerCutoff): Promise<MarkerCutoff | null>;
  /** Deny evidence: whether no new marker arrived within `windowMs` after the cutoff. */
  denyEffect(trackSid: string, cutoff: MarkerCutoff, windowMs: number): Promise<SilenceReading>;
  /** Browser wall clock, used to estimate the offset against the driver's clock. */
  now(): Promise<number>;
  close(): Promise<void>;
}

/** Failures the driver may see. Playwright and SDK messages never cross: they can embed grants. */
export type LoadProbeFailure =
  | 'LOAD_PROBE_POOL_CLOSED'
  | 'LOAD_PROBE_LIMIT'
  | 'LOAD_PROBE_TIMEOUT'
  | 'LOAD_PROBE_OPERATION_FAILED'
  | 'LOAD_PROBE_INITIALIZATION_FAILED'
  | 'LOAD_PROBE_CLEANUP_FAILED';

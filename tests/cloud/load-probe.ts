// F-02 / QA-01. Browser side of the staged media load (QA-11) and the ten-room run (QA-12), and
// the exposure point REQ-D-13 asked for: the page runs the product's own binding and audio-policy
// stores, so what it reports is what a real participant would have been allowed to receive.
//
// The difference from the DP-06 probe (deployment-probe.ts) is measurement. DP-06 answers "did
// bytes arrive on a track that was allowed", which is enough for a smoke test. A load stage has to
// answer "how long after the policy decision did newly transmitted media appear", and bytes cannot
// tell new media from buffered playback. So this page publishes the marked synthetic tracks from
// SyntheticMedia, decodes the markers back out of every received track with MarkerDetector, and
// feeds both into MediaObserver, which owns the allow/deny rules.
//
// Grants stay in memory. No console, trace or capture listeners are installed, and nothing that
// leaves this page carries a token, a frame or an audio sample.
import {
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  setLogLevel,
} from 'livekit-client';
import {
  createBindingStore,
  isSelfPublishConfirmed,
} from '../../apps/web/src/features/media/media-bindings';
import { createPolicyStore } from '../../apps/web/src/features/media/audio-policy';
import { composeMediaEvidence } from '../../apps/web/src/features/media/media-evidence';
import { MediaObserver, type TrackKey } from './MediaObserver.ts';
import { createFaceReader, createToneReader, type MarkerReader } from './MarkerDetector.ts';
import { createSyntheticTracks, type SyntheticTracks } from './SyntheticMedia.ts';
import type {
  LoadProbe,
  LoadProbeSnapshot,
  MarkerCutoff,
  RemoteTrackReading,
  SilenceReading,
} from './LoadProbeTypes.ts';

setLogLevel('silent');

/** Faces are sampled at the publisher's frame rate; the tone steps four times a second. */
const FACE_FPS = 10;
const TONE_STEPS_PER_SECOND = 4;

type Tracked = {
  key: TrackKey;
  reader: MarkerReader | null;
  /** Set while `createFaceReader` / `createToneReader` is still resolving for this SID. */
  opening: boolean;
  markerCount: number;
  lastMarker: MarkerCutoff | null;
};

let playerId = '';
/** Five in a match, two in practice (D remote-faces). The driver states which stage it runs. */
let remoteFaceLimit = 5;
let room: Room | null = null;
let synthetic: SyntheticTracks | null = null;
let audioContext: AudioContext | null = null;
let epoch = 0;
let tail: Promise<unknown> = Promise.resolve();
let closing: Promise<void> | null = null;
/** The last poll's readings, so `evidence()` describes the same instant without re-sampling. */
let lastRemote: readonly RemoteTrackReading[] = [];
const bindings = createBindingStore();
const policy = createPolicyStore(bindings);
const observer = new MediaObserver();
const tracked = new Map<string, Tracked>();

const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
  const result = tail.then(work);
  tail = result.catch(() => {});
  return result;
};

const emptySnapshot = (): LoadProbeSnapshot => ({
  connected: false,
  atMs: performance.timeOrigin + performance.now(),
  publishedTracks: [],
  outgoing: { frameSerial: 0, toneSequence: 0 },
  remote: [],
});

function forget(trackSid: string) {
  const entry = tracked.get(trackSid);
  entry?.reader?.stop();
  tracked.delete(trackSid);
}

async function closeResources() {
  const current = room;
  room = null;
  const tracks = synthetic;
  synthetic = null;
  const audio = audioContext;
  audioContext = null;
  let failed = false;
  lastRemote = [];
  for (const sid of [...tracked.keys()]) forget(sid);
  if (current) {
    await Promise.resolve()
      .then(async () => {
        current.removeAllListeners();
        await current.disconnect(true);
      })
      .catch(() => {
        room = current;
        failed = true;
      });
  }
  try {
    tracks?.stop();
  } catch {
    synthetic = tracks;
    failed = true;
  }
  try {
    await audio?.close();
  } catch {
    failed = true;
  }
  bindings.reset();
  policy.reset();
  if (failed) throw new Error('LOAD_PROBE_CLOSE_FAILED');
}

/** The observer key of a received track: SID alone is not a key across generations. */
function keyFor(trackSid: string, publisherGeneration: number): TrackKey | null {
  const scope = bindings.getScope();
  if (!scope) return null;
  return {
    mediaInstanceId: scope.mediaInstanceId,
    receiverGeneration: scope.receiverGeneration,
    publisherGeneration,
    trackSid,
  };
}

const probe: LoadProbe = {
  connect(grant) {
    const requested = ++epoch;
    closing = null;
    return enqueue(async () => {
      try {
        await closeResources();
        if (requested !== epoch) throw new Error('LOAD_PROBE_CONNECT_SUPERSEDED');
        bindings.beginScope(grant);
        const next = new Room({ adaptiveStream: false, dynacast: false });
        next.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
          if (room === next) forget(publication.trackSid);
        });
        room = next;
        await next.connect(grant.url, grant.token, { autoSubscribe: false });
        if (requested !== epoch || room !== next || next.state !== 'connected')
          throw new Error('LOAD_PROBE_CONNECT_FAILED');
        audioContext = new AudioContext();
        await audioContext.resume();
      } catch {
        await closeResources().catch(() => {});
        throw new Error('LOAD_PROBE_CONNECT_FAILED');
      }
    });
  },

  publish() {
    const requested = epoch;
    return enqueue(async () => {
      const current = room;
      if (requested !== epoch || !current || current.state !== 'connected')
        throw new Error('LOAD_PROBE_NOT_CONNECTED');
      if (synthetic) return; // one marked pair per generation
      try {
        const tracks = createSyntheticTracks(FACE_FPS);
        synthetic = tracks;
        if (requested !== epoch) throw new Error('LOAD_PROBE_PUBLICATION_SUPERSEDED');
        await current.localParticipant.publishTrack(new LocalVideoTrack(tracks.video), {
          source: Track.Source.Camera,
          videoCodec: 'vp8',
          simulcast: false,
          backupCodec: false,
          // The hue carries the serial, so the encoder must not be free to drop the frame rate.
          videoEncoding: { maxBitrate: 300_000, maxFramerate: FACE_FPS },
          degradationPreference: 'maintain-framerate',
        });
        if (requested !== epoch) throw new Error('LOAD_PROBE_PUBLICATION_SUPERSEDED');
        await current.localParticipant.publishTrack(new LocalAudioTrack(tracks.audio), {
          source: Track.Source.Microphone,
          // DTX would stop sending during a steady tone and look like a deny.
          dtx: false,
          red: false,
        });
        if (requested !== epoch || room !== current)
          throw new Error('LOAD_PROBE_PUBLICATION_SUPERSEDED');
      } catch {
        await closeResources().catch(() => {});
        throw new Error('LOAD_PROBE_PUBLISH_FAILED');
      }
    });
  },

  applyBindings(message) {
    const requested = epoch;
    return enqueue(async () => {
      if (requested === epoch && bindings.apply(message, playerId).status === 'applied')
        policy.revisit(performance.now());
    });
  },

  applyAudioPolicy(message) {
    const requested = epoch;
    return enqueue(async () => {
      if (requested === epoch) policy.apply(message);
    });
  },

  poll() {
    return enqueue(async () => {
      const current = room;
      if (!current) return emptySnapshot();
      const requested = epoch;
      const nowMs = performance.timeOrigin + performance.now();
      const voices = policy.resolveVoices().filter((voice) => voice.gain > 0);
      const remote: RemoteTrackReading[] = [];
      const live = new Set<string>();

      for (const participant of current.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          const track = publication.track;
          const kind = publication.kind;
          if (!track || (kind !== Track.Kind.Video && kind !== Track.Kind.Audio)) continue;
          const sid = publication.trackSid;
          live.add(sid);
          const binding =
            kind === Track.Kind.Video
              ? bindings.findByFaceTrack(sid)
              : bindings.findByAudioTrack(sid);
          const bindingAllowed =
            binding?.mediaIdentity === participant.identity &&
            binding.participantSid === participant.sid;
          const key = keyFor(sid, binding?.publisherGeneration ?? -1);
          let entry = tracked.get(sid);
          if (!entry && key) {
            entry = { key, reader: null, opening: false, markerCount: 0, lastMarker: null };
            tracked.set(sid, entry);
            observer.track(key, bindings.getRevision());
          }

          if (entry && !entry.reader && !entry.opening) {
            entry.opening = true;
            const media = track.mediaStreamTrack;
            const opening =
              kind === Track.Kind.Video
                ? createFaceReader(media, FACE_FPS)
                : audioContext
                  ? createToneReader(media, audioContext, TONE_STEPS_PER_SECOND)
                  : Promise.resolve(null);
            // Opening a reader waits on the element or the graph; the poll does not block on it.
            void opening
              .then((reader) => {
                const target = tracked.get(sid);
                if (!target || requested !== epoch) {
                  reader?.stop();
                  return;
                }
                target.reader = reader;
                target.opening = false;
              })
              .catch(() => {
                const target = tracked.get(sid);
                if (target) target.opening = false;
              });
          }

          if (entry?.reader) {
            const marker = entry.reader.sample(nowMs);
            if (marker) {
              observer.marker(entry.key, marker);
              entry.markerCount++;
              entry.lastMarker = marker;
            }
          }

          const report = await track.getRTCStatsReport();
          if (requested !== epoch || room !== current) return emptySnapshot();
          if (publication.track !== track) continue;
          let bytesReceived = 0;
          let packetsReceived = 0;
          let framesDecoded: number | undefined;
          report?.forEach((stat) => {
            if (stat.type !== 'inbound-rtp') return;
            if (typeof stat.bytesReceived === 'number') bytesReceived += stat.bytesReceived;
            if (typeof stat.packetsReceived === 'number') packetsReceived += stat.packetsReceived;
            if (typeof stat.framesDecoded === 'number')
              framesDecoded = (framesDecoded ?? 0) + stat.framesDecoded;
          });
          if (entry)
            observer.stats(entry.key, {
              atMs: nowMs,
              bytesReceived,
              packetsReceived,
              framesDecoded,
            });

          remote.push({
            identity: participant.identity,
            trackSid: sid,
            kind: kind === Track.Kind.Video ? 'video' : 'audio',
            subscribed: publication.isSubscribed,
            bindingAllowed,
            audible: kind === Track.Kind.Audio && voices.some((voice) => voice.trackSid === sid),
            bytesSinceBaseline: entry ? observer.bytesSinceBaseline(entry.key) : null,
            lastMarker: entry?.lastMarker ?? null,
            markerCount: entry?.markerCount ?? 0,
            readerOpen: entry?.reader !== null && entry?.reader !== undefined,
          });
        }
      }
      for (const sid of [...tracked.keys()]) if (!live.has(sid)) forget(sid);

      const publishedTracks: { sid: string; kind: 'video' | 'audio' }[] = [];
      for (const publication of current.localParticipant.trackPublications.values()) {
        if (publication.kind === Track.Kind.Video || publication.kind === Track.Kind.Audio)
          publishedTracks.push({ sid: publication.trackSid, kind: publication.kind });
      }
      lastRemote = remote;
      return {
        connected: current.state === 'connected',
        atMs: nowMs,
        publishedTracks,
        outgoing: synthetic?.current() ?? { frameSerial: 0, toneSequence: 0 },
        remote,
      };
    });
  },

  evidence() {
    return enqueue(async () => {
      const scope = bindings.getScope();
      const self = bindings.getSelf();
      const current = room;
      const localFace =
        [...(current?.localParticipant.trackPublications.values() ?? [])].find(
          (publication) => publication.kind === Track.Kind.Video,
        )?.trackSid ?? null;
      const localAudio =
        [...(current?.localParticipant.trackPublications.values() ?? [])].find(
          (publication) => publication.kind === Track.Kind.Audio,
        )?.trackSid ?? null;
      // The product's rule for a confirmed publication: the server's own binding names the SID in
      // this receiver generation. An SDK publish that the server has not confirmed is not evidence.
      const micConfirmed =
        self !== null &&
        scope !== null &&
        localAudio !== null &&
        self.publisherGeneration === scope.receiverGeneration &&
        self.audioTrackSid === localAudio;

      return composeMediaEvidence({
        scope,
        generationState: current && current.state === 'connected' ? 'live' : 'closed',
        published: [
          ...(localFace
            ? [
                {
                  source: 'face' as const,
                  trackSid: localFace,
                  serverConfirmed: isSelfPublishConfirmed(self, scope, localFace),
                },
              ]
            : []),
          ...(localAudio
            ? [
                {
                  source: 'microphone' as const,
                  trackSid: localAudio,
                  serverConfirmed: micConfirmed,
                },
              ]
            : []),
        ],
        subscriptions: lastRemote.map((entry) => ({
          trackSid: entry.trackSid,
          kind: entry.kind,
          subscribed: entry.subscribed,
        })),
        authorized: bindings.getRemote().flatMap((binding) => {
          const entries: { trackSid: string; playerId: string }[] = [];
          if (binding.faceTrackSid)
            entries.push({ trackSid: binding.faceTrackSid, playerId: binding.playerId });
          if (binding.audioTrackSid)
            entries.push({ trackSid: binding.audioTrackSid, playerId: binding.playerId });
          return entries;
        }),
        attachedFaces: lastRemote
          .filter((entry) => entry.kind === 'video' && entry.readerOpen && entry.bindingAllowed)
          .map((entry) => ({
            trackSid: entry.trackSid,
            playerId: bindings.findByFaceTrack(entry.trackSid)?.playerId ?? entry.identity,
          })),
        pendingSids: lastRemote
          .filter((entry) => !entry.bindingAllowed)
          .map((entry) => entry.trackSid),
        policyVoices: policy.resolveVoices(),
        routedSids: lastRemote
          .filter((entry) => entry.kind === 'audio' && entry.readerOpen)
          .map((entry) => entry.trackSid),
        // The probe never mutes: a zero effective gain here is always the server policy's doing.
        preferences: { volume: 1, muted: false, mutedPlayerIds: [] },
        remoteFaceLimit,
      });
    });
  },

  cutoff(trackSid) {
    return enqueue(async () => {
      const entry = tracked.get(trackSid);
      // Without a marker yet the cutoff is the current time and a serial nothing can be below.
      return entry?.lastMarker ?? { atMs: performance.timeOrigin + performance.now(), serial: -1 };
    });
  },

  allowEffect(trackSid, cutoff) {
    return enqueue(async () => {
      const entry = tracked.get(trackSid);
      if (!entry) return null;
      return observer.firstNewMarkerAfter(entry.key, cutoff.atMs, cutoff.serial);
    });
  },

  denyEffect(trackSid, cutoff, windowMs) {
    return enqueue(async (): Promise<SilenceReading> => {
      const entry = tracked.get(trackSid);
      if (!entry) return { silent: false, newMarkers: 0, bytesAfterCutoff: null };
      return observer.sustainedSilence(entry.key, cutoff.atMs, cutoff.serial, windowMs);
    });
  },

  now() {
    return Promise.resolve(performance.timeOrigin + performance.now());
  },

  close() {
    if (!closing) {
      ++epoch; // a late accepted connect/publish must not continue in this generation
      closing = enqueue(closeResources);
    }
    return closing;
  },
};

declare global {
  interface Window {
    kkakkungLoadProbe: LoadProbe;
    initializeLoadProbe(id: string, faceLimit?: number): void;
  }
}

window.initializeLoadProbe = (id, faceLimit) => {
  playerId = id;
  if (faceLimit !== undefined) remoteFaceLimit = faceLimit;
};
window.kkakkungLoadProbe = probe;

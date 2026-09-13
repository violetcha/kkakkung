// Browser-only synthetic transport probe. Grants stay in memory; no console, trace or capture.
// Received byte deltas are RTP diagnostics, not proof of rendered/played media or G1 acceptance.
import {
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  setLogLevel,
} from 'livekit-client';
import { createBindingStore } from '../../apps/web/src/features/media/media-bindings';
import { createPolicyStore } from '../../apps/web/src/features/media/audio-policy';
import { DEPLOYMENT_AUDIO_BITRATE, DEPLOYMENT_VIDEO_BITRATE } from './DeploymentSmokePlan.js';
import type { DeploymentMediaProbe, DeploymentProbeSnapshot } from './DeploymentInteraction.js';
import { DeploymentReception } from './DeploymentReception.js';

setLogLevel('silent');
let playerId = '';
let room: Room | null = null;
let stopSynthetic: (() => Promise<void>) | null = null;
let epoch = 0;
let tail: Promise<unknown> = Promise.resolve();
let closing: Promise<void> | null = null;
const bindings = createBindingStore();
const policy = createPolicyStore(bindings);
const reception = new DeploymentReception();

const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
  const result = tail.then(work);
  tail = result.catch(() => {});
  return result;
};
const emptySnapshot = (): DeploymentProbeSnapshot => ({
  connected: false,
  localTracks: [],
  allowedReceived: { video: 0, audio: 0 },
  forbiddenReceived: 0,
});

async function closeResources() {
  const current = room;
  room = null;
  const stop = stopSynthetic;
  stopSynthetic = null;
  let failed = false;
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
  if (stop)
    await stop().catch(() => {
      stopSynthetic = stop;
      failed = true;
    });
  bindings.reset();
  policy.reset();
  reception.reset();
  if (failed) throw new Error('DP06_CLOSE_FAILED');
}

async function syntheticTracks() {
  let timer: ReturnType<typeof setInterval> | undefined;
  let video: MediaStream | null = null;
  let audio: AudioContext | null = null;
  let oscillator: OscillatorNode | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  let stop: Promise<void> | null = null;
  const cleanup = () => {
    stop ??= (async () => {
      clearInterval(timer);
      const actions: (() => unknown)[] = [
        () => {
          if (oscillator) oscillator.stop();
        },
        () => video?.getTracks().forEach((track) => track.stop()),
        () => destination?.stream.getTracks().forEach((track) => track.stop()),
        () => audio?.close(),
      ];
      const results = await Promise.allSettled(
        actions.map((action) => Promise.resolve().then(action)),
      );
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('DP06_SYNTHETIC_CLOSE_FAILED');
    })();
    return stop;
  };
  stopSynthetic = cleanup;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('DP06_CANVAS_UNAVAILABLE');
    let frame = 0;
    timer = setInterval(() => {
      context.fillStyle = '#101010';
      context.fillRect(0, 0, 320, 240);
      context.fillStyle = '#eeeeee';
      context.fillRect((frame++ * 5) % 280, 100, 40, 40);
    }, 1000 / 15);
    video = canvas.captureStream(15);
    audio = new AudioContext();
    oscillator = audio.createOscillator();
    const gain = audio.createGain();
    destination = audio.createMediaStreamDestination();
    oscillator.frequency.value = 440;
    gain.gain.value = 0.01;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    const videoTrack = video.getVideoTracks()[0];
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (!videoTrack || !audioTrack) throw new Error('DP06_SYNTHETIC_TRACKS_UNAVAILABLE');
    await audio.resume();
    return { videoTrack, audioTrack, cleanup };
  } catch {
    await cleanup().catch(() => {});
    throw new Error('DP06_SYNTHETIC_TRACKS_UNAVAILABLE');
  }
}

const probe: DeploymentMediaProbe = {
  connect(grant) {
    const requested = ++epoch;
    closing = null;
    return enqueue(async () => {
      try {
        await closeResources();
        if (requested !== epoch) throw new Error('DP06_CONNECT_SUPERSEDED');
        bindings.beginScope(grant);
        const next = new Room({ adaptiveStream: false, dynacast: false });
        next.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
          if (room === next) reception.forget(publication.trackSid);
        });
        room = next;
        await next.connect(grant.url, grant.token, { autoSubscribe: false });
        if (requested !== epoch || room !== next || next.state !== 'connected')
          throw new Error('DP06_CONNECT_FAILED');
      } catch {
        await closeResources().catch(() => {});
        throw new Error('DP06_CONNECT_FAILED');
      }
    });
  },
  publish() {
    const requested = epoch;
    return enqueue(async () => {
      const current = room;
      if (requested !== epoch || !current || current.state !== 'connected')
        throw new Error('DP06_NOT_CONNECTED');
      if (stopSynthetic) return; // one pair per generation
      try {
        const tracks = await syntheticTracks();
        stopSynthetic = tracks.cleanup;
        if (requested !== epoch) throw new Error('DP06_PUBLICATION_SUPERSEDED');
        await current.localParticipant.publishTrack(new LocalVideoTrack(tracks.videoTrack), {
          source: Track.Source.Camera,
          videoCodec: 'vp8',
          simulcast: false,
          backupCodec: false,
          videoEncoding: { maxBitrate: DEPLOYMENT_VIDEO_BITRATE, maxFramerate: 15 },
        });
        if (requested !== epoch) throw new Error('DP06_PUBLICATION_SUPERSEDED');
        await current.localParticipant.publishTrack(new LocalAudioTrack(tracks.audioTrack), {
          source: Track.Source.Microphone,
          audioPreset: { maxBitrate: DEPLOYMENT_AUDIO_BITRATE },
          dtx: false,
          red: false,
        });
        if (requested !== epoch || room !== current) throw new Error('DP06_PUBLICATION_SUPERSEDED');
      } catch {
        await closeResources().catch(() => {});
        throw new Error('DP06_PUBLISH_FAILED');
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
  snapshot() {
    return enqueue(async () => {
      const current = room;
      if (!current) return emptySnapshot();
      const requested = epoch;
      const allowedReceived = { video: 0, audio: 0 };
      const localTracks: { sid: string; kind: 'video' | 'audio' }[] = [];
      for (const publication of current.localParticipant.trackPublications.values()) {
        if (publication.kind === Track.Kind.Video || publication.kind === Track.Kind.Audio)
          localTracks.push({ sid: publication.trackSid, kind: publication.kind });
      }
      const voices = policy.resolveVoices().filter((voice) => voice.gain > 0);
      const active = new Set<string>();
      for (const participant of current.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          const track = publication.track;
          if (!track || (publication.kind !== 'video' && publication.kind !== 'audio')) continue;
          const sid = publication.trackSid;
          const binding =
            publication.kind === Track.Kind.Video
              ? bindings.findByFaceTrack(sid)
              : bindings.findByAudioTrack(sid);
          const bindingAllowed =
            binding?.mediaIdentity === participant.identity &&
            binding.participantSid === participant.sid;
          const allowed =
            bindingAllowed &&
            (publication.kind === Track.Kind.Video ||
              voices.some((voice) => voice.trackSid === sid));
          const report = await track.getRTCStatsReport();
          if (requested !== epoch || room !== current) return emptySnapshot();
          if (publication.track !== track) continue;
          active.add(sid);
          let bytes = 0;
          report?.forEach((entry) => {
            if (entry.type === 'inbound-rtp' && typeof entry.bytesReceived === 'number')
              bytes += entry.bytesReceived;
          });
          if (
            reception.observe({
              sid,
              track: track.mediaStreamTrack,
              kind: publication.kind,
              bytes,
              now: performance.now(),
              bindingAllowed,
              allowed,
            })
          )
            allowedReceived[publication.kind]++;
        }
      }
      reception.retain(active);
      return {
        connected: current.state === 'connected',
        localTracks,
        allowedReceived,
        ...reception.snapshot(),
      };
    });
  },
  close() {
    if (!closing) {
      ++epoch; // prevent a late accepted connect/publish from continuing in this generation
      closing = enqueue(closeResources);
    }
    return closing;
  },
};

declare global {
  interface Window {
    deploymentProbe: DeploymentMediaProbe;
    initializeDeploymentProbe(id: string): void;
  }
}
window.initializeDeploymentProbe = (id) => {
  playerId = id;
};
window.deploymentProbe = probe;

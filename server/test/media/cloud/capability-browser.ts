import {
  ConnectionError,
  ConnectionErrorReason,
  EngineEvent,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  setLogLevel,
  LogLevel,
  type RemoteTrack,
} from 'livekit-client';

// QA only, no real devices. No tokens, URLs, raw SDK errors, traces or media are persisted.
setLogLevel(LogLevel.silent);
export type Marker = 1 | 2 | 3;
export type Measurement = {
  connected: boolean;
  refreshReceived: boolean;
  publications: number;
  subscribed: number;
  marker: Marker | null;
  frequency: number | null;
  bytesReceived: number;
};
export type ConnectionResult = {
  outcome: 'connected' | 'denied' | 'unconfirmed';
  status: number | null;
};
const colors = { 1: [0, 255, 0], 2: [0, 0, 255], 3: [255, 255, 0] } as const;
export const frequencies = { 1: 660, 2: 880, 3: 1100 } as const;
let room: Room | null = null;
let initialToken = '';
let refreshedToken = '';
let endpoint = '';
let marker: Marker = 1;
let stopSynthetic: (() => void) | undefined;
const received = new Map<
  string,
  {
    track: RemoteTrack;
    video?: HTMLVideoElement;
    analyser?: AnalyserNode;
    source?: MediaStreamAudioSourceNode;
  }
>();
const audio = new AudioContext();

function attach(track: RemoteTrack) {
  if (track.kind === Track.Kind.Video) {
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    track.attach(video);
    document.body.append(video);
    void video.play().catch(() => {});
    received.set(track.sid!, { track, video });
  } else if (track.kind === Track.Kind.Audio) {
    const source = audio.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    received.set(track.sid!, { track, source, analyser });
  }
}
function detach(sid: string) {
  const entry = received.get(sid);
  entry?.track.detach();
  entry?.video?.remove();
  entry?.source?.disconnect();
  received.delete(sid);
}
async function disconnect() {
  stopSynthetic?.();
  stopSynthetic = undefined;
  if (room) await room.disconnect();
  room = null;
  for (const sid of received.keys()) detach(sid);
}
async function connect(url: string, token: string): Promise<ConnectionResult> {
  await disconnect();
  endpoint = url;
  initialToken = token;
  refreshedToken = '';
  room = new Room({
    adaptiveStream: false,
    dynacast: false,
    reconnectPolicy: { nextRetryDelayInMs: () => null },
  });
  room
    .on(RoomEvent.TrackSubscribed, attach)
    .on(RoomEvent.TrackUnsubscribed, (track) => detach(track.sid!));
  // Pinned livekit-client 2.22.2 test instrumentation; never used by product code.
  // Keep SDK-refreshed credentials only in page memory and never return them to the runner.
  room.engine.on(EngineEvent.TokenRefreshed, (value) => {
    refreshedToken = value;
  });
  try {
    await audio.resume();
    await room.connect(url, token, {
      autoSubscribe: false,
      maxRetries: 0,
      peerConnectionTimeout: 8000,
      websocketTimeout: 8000,
    });
    return { outcome: 'connected', status: null };
  } catch (error) {
    const denied =
      error instanceof ConnectionError &&
      error.reason === ConnectionErrorReason.NotAllowed &&
      (error.status === 401 || error.status === 403);
    return { outcome: denied ? 'denied' : 'unconfirmed', status: denied ? error.status : null };
  }
}
async function reconnect(kind: 'original' | 'refreshed') {
  const token = kind === 'refreshed' ? refreshedToken : initialToken;
  if (!token) return { outcome: 'unconfirmed', status: null } as const;
  // Expiration is not revocation evidence. Retry only credentials valid for >=10s.
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now() + 10_000)
      return { outcome: 'unconfirmed', status: null } as const;
  } catch {
    return { outcome: 'unconfirmed', status: null } as const;
  }
  return connect(endpoint, token);
}
async function publish() {
  if (!room) throw new Error('MC01_NOT_CONNECTED');
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const drawing = canvas.getContext('2d')!;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0.1;
  const destination = audio.createMediaStreamDestination();
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  const draw = () => {
    drawing.fillStyle = `rgb(${colors[marker].join(',')})`;
    drawing.fillRect(0, 0, 64, 64);
    oscillator.frequency.value = frequencies[marker];
  };
  draw();
  const timer = setInterval(draw, 100);
  const stream = canvas.captureStream(10);
  const video = new LocalVideoTrack(stream.getVideoTracks()[0]!);
  const microphone = new LocalAudioTrack(destination.stream.getAudioTracks()[0]!);
  stopSynthetic = () => {
    clearInterval(timer);
    oscillator.stop();
    video.stop();
    microphone.stop();
  };
  const face = await room.localParticipant.publishTrack(video, {
    source: Track.Source.Camera,
    simulcast: false,
    videoEncoding: { maxBitrate: 150_000, maxFramerate: 10 },
  });
  const voice = await room.localParticipant.publishTrack(microphone, {
    source: Track.Source.Microphone,
    audioPreset: { maxBitrate: 32_000 },
  });
  return [face.trackSid, voice.trackSid];
}
function directSubscribe() {
  let count = 0;
  for (const participant of room?.remoteParticipants.values() ?? [])
    for (const publication of participant.trackPublications.values()) {
      publication.setSubscribed(true);
      count++;
    }
  return count;
}
async function measure(): Promise<Measurement> {
  let seen: Marker | null = null;
  let frequency: number | null = null;
  let bytesReceived = 0;
  for (const { track, video, analyser } of received.values()) {
    const stats = await track.getRTCStatsReport();
    stats?.forEach((stat) => {
      if (stat.type === 'inbound-rtp') bytesReceived += Number(stat.bytesReceived ?? 0);
    });
    if (video && video.readyState >= 2) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, 1, 1);
      const pixel = ctx.getImageData(0, 0, 1, 1).data;
      for (const code of [1, 2, 3] as const)
        if (colors[code].every((component, index) => Math.abs(component - pixel[index]!) < 45))
          seen = code;
    }
    if (analyser) {
      const spectrum = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(spectrum);
      let peak = 0;
      for (let i = 1; i < spectrum.length; i++) if (spectrum[i]! > spectrum[peak]!) peak = i;
      if (spectrum[peak]! > 80) frequency = (peak * audio.sampleRate) / analyser.fftSize;
    }
  }
  const publications = [...(room?.remoteParticipants.values() ?? [])].flatMap((p) => [
    ...p.trackPublications.values(),
  ]);
  return {
    connected: room?.state === 'connected',
    refreshReceived: !!refreshedToken,
    publications: publications.length,
    subscribed: publications.filter((p) => p.isSubscribed).length,
    marker: seen,
    frequency,
    bytesReceived,
  };
}
export const probe = {
  connect,
  reconnect,
  disconnect,
  publish,
  directSubscribe,
  measure,
  clearRefresh: () => {
    refreshedToken = '';
  },
  setMarker: (value: Marker) => {
    marker = value;
  },
};
declare global {
  interface Window {
    capabilityProbe: typeof probe;
  }
}
window.capabilityProbe = probe;

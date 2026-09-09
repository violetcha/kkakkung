// Owned by F (F-01 / DP-01). Minimal LiveKit Cloud probe for MC-01 (E-01).
//
// Bundled with Vite (tests/cloud/vite.config.ts) using the exact livekit-client pinned in the
// lockfile. It only offers: connect with a token kept in memory, publish one synthetic video
// and one synthetic audio track, toggle a direct setSubscribed on a remote track, and reconnect
// with the same in-memory token. No capture, no recording, no persistence. QA-01 adds the
// detailed instrumentation later; this is enough for E to confirm initial Cloud support.

import {
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from 'livekit-client';

type ProbeState = Readonly<{
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';
  room: string | null;
  identity: string | null;
  localTracks: readonly string[];
  remote: readonly { identity: string; trackSid: string; kind: string; subscribed: boolean }[];
  lastError: string | null;
  events: readonly string[];
}>;

const state: {
  room: Room | null;
  token: string | null;
  url: string | null;
  tracks: (LocalVideoTrack | LocalAudioTrack)[];
  events: string[];
  lastError: string | null;
  synthetic: { stop: () => void } | null;
} = {
  room: null,
  token: null,
  url: null,
  tracks: [],
  events: [],
  lastError: null,
  synthetic: null,
};

function log(line: string) {
  state.events.push(`${new Date().toISOString()} ${line}`);
  if (state.events.length > 200) state.events.shift();
  render();
}

/** Synthetic media: a moving marker on a canvas and a quiet tone. Nothing from real devices. */
function createSyntheticTracks() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  let frame = 0;
  const timer = setInterval(() => {
    frame++;
    ctx.fillStyle = '#101010';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect((frame * 7) % canvas.width, 100, 40, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px monospace';
    ctx.fillText(`synthetic ${frame}`, 8, 20);
  }, 50);
  const videoStream = canvas.captureStream(20);
  const videoTrack = videoStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('captureStream produced no video track');

  const audioCtx = new AudioContext();
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.02;
  oscillator.frequency.value = 440;
  const destination = audioCtx.createMediaStreamDestination();
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  const audioTrack = destination.stream.getAudioTracks()[0];
  if (!audioTrack) throw new Error('audio destination produced no track');

  const stop = () => {
    clearInterval(timer);
    oscillator.stop();
    void audioCtx.close();
    videoTrack.stop();
    audioTrack.stop();
  };
  return { video: new LocalVideoTrack(videoTrack), audio: new LocalAudioTrack(audioTrack), stop };
}

function attachRoomEvents(room: Room) {
  room
    .on(RoomEvent.Connected, () => log('connected'))
    .on(RoomEvent.Reconnecting, () => log('reconnecting'))
    .on(RoomEvent.Reconnected, () => log('reconnected'))
    .on(RoomEvent.Disconnected, (reason) => log(`disconnected reason=${String(reason)}`))
    .on(RoomEvent.TrackPublished, (pub, p) =>
      log(`remote published ${p.identity} ${pub.trackSid} ${pub.kind}`),
    )
    .on(RoomEvent.TrackSubscribed, (_t, pub, p) => log(`subscribed ${p.identity} ${pub.trackSid}`))
    .on(RoomEvent.TrackUnsubscribed, (_t, pub, p) =>
      log(`unsubscribed ${p.identity} ${pub.trackSid}`),
    )
    .on(RoomEvent.ParticipantConnected, (p) => log(`participant joined ${p.identity}`))
    .on(RoomEvent.ParticipantDisconnected, (p) => log(`participant left ${p.identity}`))
    .on(RoomEvent.TrackPublished, () => render())
    .on(RoomEvent.TrackSubscribed, () => render())
    .on(RoomEvent.TrackUnsubscribed, () => render());
}

export async function connect(url: string, token: string, publish: boolean) {
  await disconnect();
  state.url = url;
  state.token = token; // memory only; never written anywhere
  const room = new Room({ adaptiveStream: false, dynacast: false });
  attachRoomEvents(room);
  state.room = room;
  state.lastError = null;
  try {
    await room.connect(url, token, { autoSubscribe: false });
    if (publish) {
      const synthetic = createSyntheticTracks();
      state.synthetic = synthetic;
      await room.localParticipant.publishTrack(synthetic.video, {
        source: Track.Source.Camera,
        name: 'synthetic-video',
      });
      await room.localParticipant.publishTrack(synthetic.audio, {
        source: Track.Source.Microphone,
        name: 'synthetic-audio',
      });
      state.tracks = [synthetic.video, synthetic.audio];
      log('published synthetic video+audio');
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    log(`connect failed: ${state.lastError}`);
  }
  render();
}

export async function reconnect() {
  if (!state.url || !state.token) {
    log('reconnect: no in-memory token');
    return;
  }
  log('manual reconnect with the same in-memory token');
  await connect(state.url, state.token, state.tracks.length > 0);
}

export async function setSubscribed(trackSid: string, subscribed: boolean) {
  const room = state.room;
  if (!room) return;
  for (const participant of room.remoteParticipants.values()) {
    const pub = participant.trackPublications.get(trackSid);
    if (pub instanceof RemoteTrackPublication) {
      pub.setSubscribed(subscribed);
      log(`setSubscribed ${trackSid} ${subscribed}`);
      return;
    }
  }
  log(`setSubscribed: unknown trackSid ${trackSid}`);
}

export async function disconnect() {
  state.synthetic?.stop();
  state.synthetic = null;
  state.tracks = [];
  if (state.room) {
    await state.room.disconnect();
    state.room = null;
  }
  render();
}

export function snapshot(): ProbeState {
  const room = state.room;
  const remote: { identity: string; trackSid: string; kind: string; subscribed: boolean }[] = [];
  if (room)
    for (const p of room.remoteParticipants.values() as Iterable<RemoteParticipant>)
      for (const pub of p.trackPublications.values())
        remote.push({
          identity: p.identity,
          trackSid: pub.trackSid,
          kind: pub.kind,
          subscribed: pub.isSubscribed,
        });
  const connection = !room
    ? state.lastError
      ? 'failed'
      : 'idle'
    : room.state === 'connected'
      ? 'connected'
      : room.state === 'reconnecting'
        ? 'reconnecting'
        : room.state === 'connecting'
          ? 'connecting'
          : 'disconnected';
  return {
    connection,
    room: room?.name ?? null,
    identity: room?.localParticipant.identity ?? null,
    localTracks: state.tracks.map((t) => t.sid ?? t.kind),
    remote,
    lastError: state.lastError,
    events: state.events,
  };
}

function render() {
  const el = document.getElementById('state');
  if (el) el.textContent = JSON.stringify(snapshot(), null, 2);
}

function bindUi() {
  const $ = (id: string) =>
    document.getElementById(id) as HTMLInputElement | HTMLButtonElement | null;
  $('connect')?.addEventListener('click', () => {
    const url = ($('url') as HTMLInputElement).value.trim();
    const token = ($('token') as HTMLInputElement).value.trim();
    const publish = ($('publish') as HTMLInputElement).checked;
    void connect(url, token, publish);
  });
  $('reconnect')?.addEventListener('click', () => void reconnect());
  $('disconnect')?.addEventListener('click', () => void disconnect());
  $('subscribe')?.addEventListener('click', () => {
    const sid = ($('sid') as HTMLInputElement).value.trim();
    void setSubscribed(sid, true);
  });
  $('unsubscribe')?.addEventListener('click', () => {
    const sid = ($('sid') as HTMLInputElement).value.trim();
    void setSubscribed(sid, false);
  });
  render();
}

declare global {
  interface Window {
    kkakkungProbe: {
      connect: typeof connect;
      reconnect: typeof reconnect;
      setSubscribed: typeof setSubscribed;
      disconnect: typeof disconnect;
      snapshot: typeof snapshot;
    };
  }
}
window.kkakkungProbe = { connect, reconnect, setSubscribed, disconnect, snapshot };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
else bindUi();

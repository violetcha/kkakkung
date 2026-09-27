import type {
  LiveKitAdapterHooks,
  LiveKitModule,
  SdkLocalTrackPublication,
  SdkRemoteTrack,
  SdkRemoteTrackPublication,
} from './livekit-adapter';
import { ROOM_EVENTS, type MediaGrant, type MediaRoomPort } from './media-types';
import type { RemoteTrack } from './remote-faces';
import type { PublisherPort } from './track-publisher';

type Publication = { leg: number; track: MediaStreamTrack; publication: SdkLocalTrackPublication };
type Received = {
  track: SdkRemoteTrack;
  publication: SdkRemoteTrackPublication;
  participantSid: string;
};

/** One generation owns both SDK rooms. Only the private receiver contains forwarded tracks. */
export function createSplitLiveKitConnection(
  sdk: LiveKitModule,
  hooks: LiveKitAdapterHooks,
  grant: MediaGrant,
) {
  const face = grant.facePublication;
  if (grant.subscriptionMode !== 'server-forwarding' || !face)
    throw new Error('INVALID_SPLIT_MEDIA_GRANT');
  // S15P21C204-408. 서버가 내보낸 연결이 로컬 트랙을 stop() 하지 않게 한다(livekit-adapter 와 같다).
  const options = { stopLocalTrackOnUnpublish: false } as const;
  const rooms = [new sdk.Room(options), new sdk.Room(options)];
  const connected = [false, false];
  const settled = [false, false];
  const recovering = [false, false];
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const publications = new Map<string, Publication>();
  const received = new Map<string, Received>();
  const announced = new Set<string>();
  let terminal = false;
  let detached = false;
  let started = false;
  let closing: Promise<void> | null = null;
  const usable = () => !terminal && !detached && connected.every(Boolean) && settled.every(Boolean);
  const emit = (event: string) => {
    if (!detached) for (const listener of listeners.get(event) ?? []) listener();
  };
  const announce = (sid: string, entry: Received) => {
    if (!usable() || announced.has(sid)) return;
    announced.add(sid);
    hooks.onRemoteTrack({
      trackSid: sid,
      kind: entry.track.kind === 'audio' ? 'audio' : 'video',
      participantSid: entry.participantSid,
      attach: (element) => entry.track.attach(element),
      detach: (element) => (element ? entry.track.detach(element) : entry.track.detach()),
    });
  };
  const flushReceived = () => {
    for (const [sid, entry] of received) announce(sid, entry);
  };
  const clearReceived = () => {
    for (const sid of announced) if (!detached) hooks.onRemoteTrackRemoved(sid);
    announced.clear();
    received.clear();
  };
  const close = (): Promise<void> => {
    terminal = true;
    connected.fill(false);
    clearReceived();
    closing ??= Promise.resolve().then(async () => {
      const results = await Promise.allSettled(rooms.map((room) => room.disconnect(false)));
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('SPLIT_MEDIA_CLOSE_UNCONFIRMED');
    });
    return closing;
  };
  rooms.forEach((room, leg) => {
    room.on(ROOM_EVENTS.connected, () => {
      if (!terminal && !detached) connected[leg] = true;
    });
    for (const event of [ROOM_EVENTS.reconnecting, ROOM_EVENTS.signalReconnecting]) {
      room.on(event, () => {
        if (terminal || detached) return;
        connected[leg] = false;
        recovering[leg] = true;
        emit(event);
      });
    }
    room.on(ROOM_EVENTS.reconnected, () => {
      if (terminal || detached) return;
      recovering[leg] = false;
      connected[leg] = true;
      if (usable()) {
        emit(ROOM_EVENTS.reconnected);
        flushReceived();
      }
    });
    room.on(ROOM_EVENTS.disconnected, () => {
      if (terminal || detached) return;
      // Do not leave the healthy leg publishing after its sibling has terminated.
      const pendingClose = close();
      emit(ROOM_EVENTS.disconnected);
      void pendingClose.catch(() => {});
    });
  });
  rooms[0]!.on(ROOM_EVENTS.trackSubscribed, ((
    track: SdkRemoteTrack,
    publication: SdkRemoteTrackPublication,
    participant: { sid: string },
  ) => {
    if (terminal || detached) return;
    const entry = { track, publication, participantSid: participant.sid };
    received.set(publication.trackSid, entry);
    announce(publication.trackSid, entry);
  }) as (...args: never[]) => void);
  rooms[0]!.on(ROOM_EVENTS.trackUnsubscribed, ((
    _track: SdkRemoteTrack,
    publication: SdkRemoteTrackPublication,
  ) => {
    received.delete(publication.trackSid);
    if (announced.delete(publication.trackSid) && !detached)
      hooks.onRemoteTrackRemoved(publication.trackSid);
  }) as (...args: never[]) => void);

  const publisher: PublisherPort = {
    async publishTrack(track, options) {
      if (!usable()) throw new Error('SPLIT_MEDIA_NOT_CONNECTED');
      const leg = options.source === 'camera' ? 1 : 0;
      if (track.kind !== (leg === 1 ? 'video' : 'audio'))
        throw new Error('SPLIT_MEDIA_SOURCE_MISMATCH');
      const participant = rooms[leg]!.localParticipant;
      const publication = await participant.publishTrack(track, {
        source: leg === 1 ? sdk.Track.Source.Camera : sdk.Track.Source.Microphone,
        simulcast: options.simulcast,
        ...(options.videoEncoding ? { videoEncoding: options.videoEncoding } : {}),
      });
      if (!usable()) {
        await participant.unpublishTrack(track, false);
        throw new Error('SPLIT_MEDIA_PUBLICATION_CANCELED');
      }
      publications.set(publication.trackSid, { leg, track, publication });
      return { trackSid: publication.trackSid };
    },
    async unpublishTrack(track) {
      for (const [sid, entry] of publications) {
        if (entry.track !== track) continue;
        await rooms[entry.leg]!.localParticipant.unpublishTrack(track, false);
        publications.delete(sid);
      }
    },
    async replaceTrack(currentTrack, next) {
      if (!usable()) throw new Error('SPLIT_MEDIA_NOT_CONNECTED');
      const entry = [...publications.values()].find((value) => value.track === currentTrack);
      if (!entry?.publication.track || currentTrack.kind !== next.kind)
        throw new Error('SPLIT_MEDIA_PUBLICATION_MISMATCH');
      await entry.publication.track.replaceTrack(next, true);
      entry.track = next;
      if (!usable()) {
        await rooms[entry.leg]!.localParticipant.unpublishTrack(next, false);
        throw new Error('SPLIT_MEDIA_PUBLICATION_CANCELED');
      }
    },
    async getOutboundBytes(sid) {
      if (!usable()) return null;
      const report = await publications.get(sid)?.publication.track?.getRTCStatsReport();
      let total: number | null = null;
      report?.forEach((value: unknown) => {
        const stat = value as { type?: string; bytesSent?: number };
        if (stat.type === 'outbound-rtp' && typeof stat.bytesSent === 'number')
          total = (total ?? 0) + stat.bytesSent;
      });
      return total;
    },
  };
  const port: MediaRoomPort = {
    async connect(url, token, options) {
      if (
        started ||
        terminal ||
        detached ||
        url !== grant.url ||
        token !== grant.token ||
        options.subscriptionMode !== 'server-forwarding' ||
        !options.autoSubscribe
      )
        throw new Error('INVALID_SPLIT_MEDIA_CONNECT');
      started = true;
      const connectLeg = async (leg: number) => {
        const room = rooms[leg]!;
        await room.connect(leg === 0 ? url : face.url, leg === 0 ? token : face.token, {
          autoSubscribe: leg === 0,
        });
        if (terminal || detached) {
          // The earlier disconnect may have completed before this late SDK connection did.
          await room.disconnect(false);
          throw new Error('SPLIT_MEDIA_CONNECT_CANCELED');
        }
        settled[leg] = true;
        connected[leg] = !recovering[leg];
      };
      try {
        await Promise.all([connectLeg(0), connectLeg(1)]);
        if (!usable()) throw new Error('SPLIT_MEDIA_NOT_CONNECTED');
        emit(ROOM_EVENTS.connected);
        flushReceived();
      } catch {
        await close();
        throw new Error('SPLIT_MEDIA_CONNECT_FAILED');
      }
    },
    disconnect: close,
    on(event, listener) {
      if (!detached) listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    removeAllListeners() {
      detached = true;
      listeners.clear();
      rooms.forEach((room) => room.removeAllListeners());
      clearReceived();
    },
  };
  return {
    port,
    getPublisher: () => (usable() ? publisher : null),
    unsubscribeTrack: (track: RemoteTrack) =>
      received.get(track.trackSid)?.publication.setSubscribed(false),
    getAudioTrack: (sid: string) => {
      if (!usable()) return null;
      const track = received.get(sid)?.track;
      return track?.kind === 'audio' ? track.mediaStreamTrack : null;
    },
    /** S15P21C204-246. 증거에 싣는 실제 구독 상태. 모르면 구독 중으로 적는다. */
    getSubscriptions: () =>
      [...received.entries()].map(([trackSid, entry]) => ({
        trackSid,
        kind: entry.track?.kind === 'audio' ? ('audio' as const) : ('video' as const),
        subscribed: entry.publication.isSubscribed ?? true,
      })),
  };
}

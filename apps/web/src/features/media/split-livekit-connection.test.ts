import { describe, expect, it, vi } from 'vitest';
import {
  createLiveKitAdapter,
  type LiveKitModule,
  type SdkLocalTrackPublication,
} from './livekit-adapter';
import { createMediaSession } from './media-session';
import { ROOM_EVENTS, type MediaGrant, type MediaStatus } from './media-types';
import type { RemoteTrack } from './remote-faces';

const grant: MediaGrant = {
  matchId: 'match',
  mediaInstanceId: 'instance',
  receiverGeneration: 1,
  subscriptionMode: 'server-forwarding',
  url: 'wss://media.example',
  token: 'receiver-token',
  roomName: 'private-receiver',
  mediaIdentity: 'microphone-identity',
  expiresAt: 300,
  facePublication: {
    url: 'wss://media.example',
    token: 'face-token',
    roomName: 'face-source',
    mediaIdentity: 'face-identity',
  },
};
const options = { source: 'camera' as const, simulcast: false as const };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function track(id: string, kind = 'video') {
  return { id, kind, stop: vi.fn() } as unknown as MediaStreamTrack;
}
function localPublication(source: MediaStreamTrack) {
  return {
    trackSid: `sid-${source.id}`,
    track: {
      mediaStreamTrack: source,
      replaceTrack: vi.fn(async () => undefined),
      getRTCStatsReport: vi.fn(
        async () =>
          new Map([
            ['out', { type: 'outbound-rtp', bytesSent: source.kind === 'video' ? 11 : 22 }],
            ['ignored', { type: 'inbound-rtp', bytesSent: 999 }],
          ]) as unknown as RTCStatsReport,
      ),
    },
  };
}
function fakeRoom() {
  const listeners = new Map<string, ((...args: never[]) => void)[]>();
  const room = {
    localParticipant: {
      setTrackSubscriptionPermissions: vi.fn(),
      publishTrack: vi.fn(async (source: MediaStreamTrack): Promise<SdkLocalTrackPublication> =>
        localPublication(source),
      ),
      unpublishTrack: vi.fn(async () => undefined),
    },
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    on: (event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return room;
    },
    removeAllListeners: vi.fn(() => {
      listeners.clear();
      return room;
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of [...(listeners.get(event) ?? [])])
        (listener as (...values: unknown[]) => void)(...args);
    },
    queued: (event: string, ...args: unknown[]) => {
      const captured = [...(listeners.get(event) ?? [])];
      return () => {
        for (const listener of captured) (listener as (...values: unknown[]) => void)(...args);
      };
    },
  };
  return room;
}
function harness() {
  const rooms: ReturnType<typeof fakeRoom>[] = [];
  const added: RemoteTrack[] = [];
  const statuses: MediaStatus[] = [];
  const sdk: LiveKitModule = {
    Room: function () {
      const room = fakeRoom();
      rooms.push(room);
      return room;
    } as unknown as LiveKitModule['Room'],
    Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
  };
  const adapter = createLiveKitAdapter(sdk, {
    onRemoteTrack: (value) => added.push(value),
    onRemoteTrackRemoved: vi.fn(),
  });
  const port = adapter.createRoom(grant);
  const createRoom = vi.fn(() => port);
  const session = createMediaSession({
    createRoom,
    onStatus: (value) => statuses.push(value),
    epochNowSeconds: () => 1,
    getPhase: () => 'GAME_LOADING',
  });
  return {
    adapter,
    port,
    rooms,
    added,
    statuses,
    session,
    createRoom,
    start: () => session.connect(grant),
  };
}

describe('product SDK split transport through the media session', () => {
  it('waits for both rooms, sends each credential only to its approved room and publishes each source on its own connection', async () => {
    const h = harness();
    const pending = deferred<void>();
    h.rooms[1]!.connect.mockImplementationOnce(() => pending.promise);
    const connecting = h.start();
    await vi.waitFor(() => expect(h.rooms[1]!.connect).toHaveBeenCalled());
    h.rooms[0]!.emit(ROOM_EVENTS.connected);
    expect(h.session.getStatus().state).toBe('connecting');
    expect(h.adapter.getPublisher()).toBeNull();
    pending.resolve();
    await connecting;
    expect(h.createRoom).toHaveBeenCalledWith(grant);
    expect(h.rooms[0]!.connect).toHaveBeenCalledWith(grant.url, grant.token, {
      autoSubscribe: true,
    });
    expect(h.rooms[1]!.connect).toHaveBeenCalledWith(
      grant.facePublication!.url,
      grant.facePublication!.token,
      { autoSubscribe: false },
    );
    const face = track('face');
    const mic = track('mic', 'audio');
    const publisher = h.adapter.getPublisher()!;
    await publisher.publishTrack(face, options);
    await publisher.publishTrack(mic, { source: 'microphone', simulcast: false });
    expect(h.rooms[1]!.localParticipant.publishTrack).toHaveBeenCalledWith(
      face,
      expect.objectContaining({ source: 'camera' }),
    );
    expect(h.rooms[0]!.localParticipant.publishTrack).toHaveBeenCalledWith(
      mic,
      expect.objectContaining({ source: 'microphone' }),
    );
    expect(
      h.rooms.every(
        (room) => room.localParticipant.setTrackSubscriptionPermissions.mock.calls.length === 0,
      ),
    ).toBe(true);
    await h.session.retire();
    for (const room of h.rooms) expect(room.disconnect).toHaveBeenCalledWith(false);
    expect(face.stop).not.toHaveBeenCalled();
    expect(mic.stop).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    'closes both rooms when leg %s fails and never reports a usable partial connection',
    async (leg) => {
      const h = harness();
      h.rooms[leg]!.connect.mockRejectedValueOnce(new Error('synthetic connection error'));
      await expect(h.start()).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
      expect(h.statuses.some((status) => status.state === 'connected')).toBe(false);
      expect(h.adapter.getPublisher()).toBeNull();
      for (const room of h.rooms) expect(room.disconnect).toHaveBeenCalledWith(false);
    },
  );

  it('cancels the sibling again if its successful connect arrives after the other leg failed', async () => {
    const h = harness();
    const late = deferred<void>();
    h.rooms[0]!.connect.mockRejectedValueOnce(new Error('synthetic failure'));
    h.rooms[1]!.connect.mockImplementationOnce(() => late.promise);
    await expect(h.start()).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    expect(h.rooms[1]!.disconnect).toHaveBeenCalledTimes(1);
    late.resolve();
    await vi.waitFor(() => expect(h.rooms[1]!.disconnect).toHaveBeenCalledTimes(2));
    expect(h.session.getStatus().state).toBe('failed');
    expect(h.adapter.getPublisher()).toBeNull();
  });

  it('retirement during connection invalidates the late success and preserves the retired status', async () => {
    const h = harness();
    const late = deferred<void>();
    h.rooms[1]!.connect.mockImplementationOnce(() => late.promise);
    const connecting = h.start();
    await vi.waitFor(() => expect(h.rooms[1]!.connect).toHaveBeenCalled());
    const retiring = h.session.retire();
    await vi.waitFor(() => expect(h.rooms[1]!.disconnect).toHaveBeenCalled());
    late.resolve();
    await Promise.all([connecting, retiring]);
    expect(h.statuses.some((status) => status.state === 'connected')).toBe(false);
    expect(h.session.getStatus()).toMatchObject({ state: 'closed', code: 'RETIRED' });
    expect(h.rooms[1]!.disconnect).toHaveBeenCalledTimes(2);
  });

  it('one disconnected leg closes its sibling and ignores later reconnected events', async () => {
    const h = harness();
    await h.start();
    h.rooms[1]!.emit(ROOM_EVENTS.disconnected);
    await vi.waitFor(() => expect(h.rooms[0]!.disconnect).toHaveBeenCalled());
    h.rooms[0]!.emit(ROOM_EVENTS.reconnected);
    expect(h.session.getStatus().state).toBe('closed');
    expect(h.adapter.getPublisher()).toBeNull();
  });

  it('keeps recovery pending until both legs have recovered', async () => {
    const h = harness();
    await h.start();
    h.rooms[1]!.emit(ROOM_EVENTS.reconnecting);
    h.rooms[0]!.emit(ROOM_EVENTS.reconnected);
    expect(h.session.getStatus().state).toBe('recovering');
    expect(h.adapter.getPublisher()).toBeNull();
    h.rooms[1]!.emit(ROOM_EVENTS.reconnected);
    expect(h.session.getStatus().state).toBe('connected');
    await h.session.retire();
  });

  it('buffers receiver tracks until both connections are usable and ignores tracks from the publish-only face room', async () => {
    const h = harness();
    const late = deferred<void>();
    h.rooms[1]!.connect.mockImplementationOnce(() => late.promise);
    const connecting = h.start();
    await vi.waitFor(() => expect(h.rooms[1]!.connect).toHaveBeenCalled());
    const remote = {
      kind: 'audio',
      mediaStreamTrack: track('remote', 'audio'),
      attach: vi.fn(),
      detach: vi.fn(),
    };
    const publication = { trackSid: 'forwarded-audio', setSubscribed: vi.fn() };
    h.rooms[0]!.emit(ROOM_EVENTS.trackSubscribed, remote, publication, {
      sid: 'verified-receiver-binding',
    });
    expect(h.added).toHaveLength(0);
    late.resolve();
    await connecting;
    expect(h.added).toHaveLength(1);
    expect(h.added[0]).toMatchObject({
      participantSid: 'verified-receiver-binding',
      trackSid: 'forwarded-audio',
    });
    expect(h.adapter.getAudioTrack('forwarded-audio')).toBe(remote.mediaStreamTrack);
    h.rooms[1]!.emit(
      ROOM_EVENTS.trackSubscribed,
      remote,
      { ...publication, trackSid: 'wrong-room' },
      { sid: 'untrusted' },
    );
    expect(h.added).toHaveLength(1);
    await h.session.retire();
    expect(h.adapter.getAudioTrack('forwarded-audio')).toBeNull();
  });

  it('routes replacement, unpublication and outbound accounting to the original publishing leg', async () => {
    const h = harness();
    await h.start();
    const face = track('face');
    const next = track('next');
    const mic = track('mic', 'audio');
    const facePublication = localPublication(face);
    h.rooms[1]!.localParticipant.publishTrack.mockResolvedValueOnce(facePublication);
    const publisher = h.adapter.getPublisher()!;
    await publisher.publishTrack(face, options);
    await publisher.publishTrack(mic, { source: 'microphone', simulcast: false });
    expect(await publisher.getOutboundBytes!('sid-face')).toBe(11);
    expect(await publisher.getOutboundBytes!('sid-mic')).toBe(22);
    await publisher.replaceTrack!(face, next);
    expect(facePublication.track.replaceTrack).toHaveBeenCalledWith(next, true);
    await publisher.unpublishTrack(next);
    await publisher.unpublishTrack(mic);
    expect(h.rooms[1]!.localParticipant.unpublishTrack).toHaveBeenCalledWith(next, false);
    expect(h.rooms[0]!.localParticipant.unpublishTrack).toHaveBeenCalledWith(mic, false);
    await h.session.retire();
    expect(next.stop).not.toHaveBeenCalled();
  });

  it('unpublishes a publication that resolves after retirement without exposing it as current', async () => {
    const h = harness();
    await h.start();
    const late = deferred<SdkLocalTrackPublication>();
    h.rooms[1]!.localParticipant.publishTrack.mockImplementationOnce(() => late.promise);
    const face = track('face');
    const publishing = h.adapter.getPublisher()!.publishTrack(face, options);
    const checked = expect(publishing).rejects.toThrow('SPLIT_MEDIA_PUBLICATION_CANCELED');
    await h.session.retire();
    late.resolve(localPublication(face));
    await checked;
    expect(h.rooms[1]!.localParticipant.unpublishTrack).toHaveBeenCalledWith(face, false);
    expect(h.adapter.getPublisher()).toBeNull();
  });

  it('isolates queued events from a replaced generation', async () => {
    const h = harness();
    await h.start();
    const oldEvent = h.rooms[0]!.queued(
      ROOM_EVENTS.trackSubscribed,
      { kind: 'audio', mediaStreamTrack: track('old', 'audio'), attach: vi.fn(), detach: vi.fn() },
      { trackSid: 'old', setSubscribed: vi.fn() },
      { sid: 'old-publisher' },
    );
    h.adapter.createRoom({ ...grant, receiverGeneration: 2 });
    oldEvent();
    expect(h.added).toHaveLength(0);
    await vi.waitFor(() => expect(h.rooms[0]!.disconnect).toHaveBeenCalled());
  });
});

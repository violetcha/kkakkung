import { describe, expect, it, vi } from 'vitest';
// 타입 전용 import다. 런타임에 브라우저 전용 SDK를 적재하지 않는다.
import type { LocalParticipant, RemoteTrackPublication, Room, Track } from 'livekit-client';

import {
  createLiveKitAdapter,
  type LiveKitAdapterHooks,
  type LiveKitModule,
  type SdkLocalParticipant,
  type SdkRemoteTrackPublication,
  type SdkRoom,
  type SdkTrackSourceEnum,
} from './livekit-adapter';
import { ROOM_EVENTS } from './media-types';
import type { RemoteTrack } from './remote-faces';

/**
 * 실제 SDK 표면과 어댑터가 적는 구조 타입이 어긋나면 여기서 컴파일이 깨진다.
 * loadLiveKit()의 cast를 이 검사로 뒷받침한다.
 */
type AssertAssignable<Actual extends Expected, Expected> = [Actual, Expected];
export type RoomIsCompatible = AssertAssignable<Room, SdkRoom>;
export type ParticipantIsCompatible = AssertAssignable<LocalParticipant, SdkLocalParticipant>;
export type PublicationIsCompatible = AssertAssignable<
  RemoteTrackPublication,
  SdkRemoteTrackPublication
>;
export type SourceIsCompatible = AssertAssignable<typeof Track.Source, SdkTrackSourceEnum>;

const SOURCE: SdkTrackSourceEnum = { Camera: 'camera', Microphone: 'microphone' };

function mediaTrack(label: string): MediaStreamTrack {
  return { id: label, kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
}

function statsReport(entries: readonly { type: string; bytesSent?: number }[]): RTCStatsReport {
  return new Map(entries.map((entry, index) => [`s${index}`, entry])) as unknown as RTCStatsReport;
}

function fakeLocalTrack(source: MediaStreamTrack, report?: RTCStatsReport) {
  return {
    mediaStreamTrack: source,
    replaceTrack: vi.fn(async () => undefined),
    getRTCStatsReport: vi.fn(async () => report),
  };
}

type FakeLocalTrack = ReturnType<typeof fakeLocalTrack>;
type FakePublication = { trackSid: string; track?: FakeLocalTrack };

function fakeRoom() {
  const listeners = new Map<string, ((...args: never[]) => void)[]>();
  const publishTrack = vi.fn(async (track: MediaStreamTrack): Promise<FakePublication> => ({
    trackSid: `local-${(track as unknown as { id: string }).id}`,
  }));
  const room = {
    localParticipant: {
      setTrackSubscriptionPermissions: vi.fn(),
      publishTrack,
      unpublishTrack: vi.fn(async () => undefined),
    },
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return room;
    }),
    removeAllListeners: vi.fn(() => {
      listeners.clear();
      return room;
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of [...(listeners.get(event) ?? [])])
        (listener as (...rest: unknown[]) => void)(...args);
    },
  };
  return room;
}

function remoteTrack(kind: 'audio' | 'video', source = mediaTrack(`${kind}-source`)) {
  return {
    kind,
    mediaStreamTrack: source,
    attach: vi.fn(() => undefined),
    detach: vi.fn(() => undefined),
  };
}

function publication(trackSid: string) {
  return { trackSid, setSubscribed: vi.fn() };
}

function harness() {
  const rooms: ReturnType<typeof fakeRoom>[] = [];
  const added: RemoteTrack[] = [];
  const removed: string[] = [];
  const sdk: LiveKitModule = {
    Room: function Room(this: unknown) {
      const room = fakeRoom();
      rooms.push(room);
      return room as unknown as SdkRoom;
    } as unknown as LiveKitModule['Room'],
    Track: { Source: SOURCE },
  };
  const hooks: LiveKitAdapterHooks = {
    onRemoteTrack: (track) => added.push(track),
    onRemoteTrackRemoved: (trackSid) => removed.push(trackSid),
  };
  return { adapter: createLiveKitAdapter(sdk, hooks), rooms, added, removed };
}

describe('livekit adapter · 연결 수명', () => {
  it('connect는 승인 URL·token과 autoSubscribe 설정을 그대로 넘긴다', async () => {
    const { adapter, rooms } = harness();
    const port = adapter.createRoom();

    await port.connect('wss://media.example', 'grant-token', { autoSubscribe: false });

    expect(rooms[0]?.connect).toHaveBeenCalledWith('wss://media.example', 'grant-token', {
      autoSubscribe: false,
    });
  });

  it('disconnect는 stopTracks=false로 부른다. 세대 종료가 원본 장치를 끄면 안 된다', async () => {
    const { adapter, rooms } = harness();
    const port = adapter.createRoom();

    await port.disconnect();

    expect(rooms[0]?.disconnect).toHaveBeenCalledWith(false);
  });

  it('on은 media-session의 수명 listener를 실제 Room에 붙인다', () => {
    const { adapter, rooms } = harness();
    const port = adapter.createRoom();
    const listener = vi.fn();

    port.on(ROOM_EVENTS.connected, listener);
    rooms[0]?.emit(ROOM_EVENTS.connected);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners는 Room listener를 떼고 어댑터 상태도 비운다', () => {
    const { adapter, rooms } = harness();
    const port = adapter.createRoom();
    rooms[0]?.emit(ROOM_EVENTS.trackSubscribed, remoteTrack('audio'), publication('t1'), {
      sid: 'p1',
    });
    expect(adapter.getAudioTrack('t1')).not.toBeNull();

    port.removeAllListeners();

    expect(rooms[0]?.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(adapter.getAudioTrack('t1')).toBeNull();
    expect(adapter.getPublisher()).toBeNull();
  });

  it('버려진 Room의 늦은 구독 사건은 현재 세대를 건드리지 않는다', () => {
    const { adapter, rooms, added } = harness();
    adapter.createRoom();
    adapter.createRoom();

    rooms[0]?.emit(ROOM_EVENTS.trackSubscribed, remoteTrack('video'), publication('old'), {
      sid: 'p-old',
    });

    expect(added).toHaveLength(0);
    expect(adapter.getAudioTrack('old')).toBeNull();
  });
});

describe('livekit adapter · 원격 구독', () => {
  it('TrackSubscribed를 D의 RemoteTrack 모양으로 넘긴다', () => {
    const { adapter, rooms, added } = harness();
    adapter.createRoom();
    const track = remoteTrack('video');

    rooms[0]?.emit(ROOM_EVENTS.trackSubscribed, track, publication('face-1'), { sid: 'sid-p2' });

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      trackSid: 'face-1',
      kind: 'video',
      participantSid: 'sid-p2',
    });
  });

  it('attach·detach는 SDK 트랙에 위임한다. 어댑터가 검증을 대신하지 않는다', () => {
    const { adapter, rooms, added } = harness();
    adapter.createRoom();
    const track = remoteTrack('video');
    const element = {} as HTMLVideoElement;
    rooms[0]?.emit(ROOM_EVENTS.trackSubscribed, track, publication('face-1'), { sid: 'p' });

    added[0]?.attach(element);
    added[0]?.detach(element);
    added[0]?.detach();

    expect(track.attach).toHaveBeenCalledWith(element);
    expect(track.detach).toHaveBeenNthCalledWith(1, element);
    expect(track.detach).toHaveBeenNthCalledWith(2);
  });

  it('TrackUnsubscribed는 제거를 알리고 조회 대상에서 뺀다', () => {
    const { adapter, rooms, removed } = harness();
    adapter.createRoom();
    const track = remoteTrack('audio');
    const pub = publication('voice-1');
    rooms[0]?.emit(ROOM_EVENTS.trackSubscribed, track, pub, { sid: 'p' });

    rooms[0]?.emit(ROOM_EVENTS.trackUnsubscribed, track, pub);

    expect(removed).toEqual(['voice-1']);
    expect(adapter.getAudioTrack('voice-1')).toBeNull();
    adapter.unsubscribeTrack({ trackSid: 'voice-1' } as RemoteTrack);
    expect(pub.setSubscribed).not.toHaveBeenCalled();
  });

  it('검증되지 않은 트랙은 setSubscribed(false)로 실제 구독을 멈춘다', () => {
    const { adapter, rooms, added } = harness();
    adapter.createRoom();
    const pub = publication('face-9');
    rooms[0]?.emit(ROOM_EVENTS.trackSubscribed, remoteTrack('video'), pub, { sid: 'p' });

    adapter.unsubscribeTrack(added[0] as RemoteTrack);

    expect(pub.setSubscribed).toHaveBeenCalledWith(false);
  });

  it('모르는 SID의 구독 해제와 조회는 조용히 끝난다', () => {
    const { adapter } = harness();
    adapter.createRoom();

    expect(() => adapter.unsubscribeTrack({ trackSid: 'nope' } as RemoteTrack)).not.toThrow();
    expect(adapter.getAudioTrack('nope')).toBeNull();
  });

  it('getAudioTrack은 오디오 트랙만 돌려준다. 얼굴 트랙은 오디오가 아니다', () => {
    const { adapter, rooms } = harness();
    adapter.createRoom();
    const voice = remoteTrack('audio');
    rooms[0]?.emit(ROOM_EVENTS.trackSubscribed, voice, publication('voice-1'), { sid: 'p1' });
    rooms[0]?.emit(ROOM_EVENTS.trackSubscribed, remoteTrack('video'), publication('face-1'), {
      sid: 'p2',
    });

    expect(adapter.getAudioTrack('voice-1')).toBe(voice.mediaStreamTrack);
    expect(adapter.getAudioTrack('face-1')).toBeNull();
  });
});

describe('livekit adapter · 게시', () => {
  it('Room이 없으면 게시 port를 만들지 않는다', () => {
    const { adapter } = harness();

    expect(adapter.getPublisher()).toBeNull();
  });

  it('가공 얼굴은 camera source·simulcast 해제·지정 인코딩으로 게시한다', async () => {
    const { adapter, rooms } = harness();
    adapter.createRoom();
    const face = mediaTrack('face');

    const result = await adapter.getPublisher()?.publishTrack(face, {
      source: 'camera',
      simulcast: false,
      videoEncoding: { maxBitrate: 100_000, maxFramerate: 10 },
    });

    expect(rooms[0]?.localParticipant.publishTrack).toHaveBeenCalledWith(face, {
      source: SOURCE.Camera,
      simulcast: false,
      videoEncoding: { maxBitrate: 100_000, maxFramerate: 10 },
    });
    expect(result).toEqual({ trackSid: 'local-face' });
  });

  it('마이크는 microphone source로 게시하고 videoEncoding 항목을 붙이지 않는다', async () => {
    const { adapter, rooms } = harness();
    adapter.createRoom();
    const microphone = mediaTrack('mic');

    await adapter.getPublisher()?.publishTrack(microphone, {
      source: 'microphone',
      simulcast: false,
    });

    expect(rooms[0]?.localParticipant.publishTrack).toHaveBeenCalledWith(microphone, {
      source: SOURCE.Microphone,
      simulcast: false,
    });
  });

  it('unpublish는 stopOnUnpublish=false로 부른다. 원본 마이크를 D가 계속 소유한다', async () => {
    const { adapter, rooms } = harness();
    adapter.createRoom();
    const microphone = mediaTrack('mic');
    const publisher = adapter.getPublisher();
    await publisher?.publishTrack(microphone, { source: 'microphone', simulcast: false });

    await publisher?.unpublishTrack(microphone);

    expect(rooms[0]?.localParticipant.unpublishTrack).toHaveBeenCalledWith(microphone, false);
    expect(microphone.stop).not.toHaveBeenCalled();
  });
});

describe('livekit adapter · 소스 교체와 통계', () => {
  function publishedHarness(report?: RTCStatsReport) {
    const context = harness();
    context.adapter.createRoom();
    const source = mediaTrack('face');
    const local = fakeLocalTrack(source, report);
    context.rooms[0]!.localParticipant.publishTrack = vi.fn(async (): Promise<FakePublication> => ({
      trackSid: 'local-face',
      track: local,
    }));
    return { ...context, source, local };
  }

  it('replaceTrack은 같은 publication의 소스만 바꾸고 D의 track을 stop하지 않는다', async () => {
    const { adapter, source, local } = publishedHarness();
    const publisher = adapter.getPublisher();
    await publisher?.publishTrack(source, { source: 'camera', simulcast: false });
    const next = mediaTrack('face-safe');

    await publisher?.replaceTrack?.(source, next);

    expect(local.replaceTrack).toHaveBeenCalledWith(next, true);
    expect(source.stop).not.toHaveBeenCalled();
  });

  it('일치하는 publication이 없으면 교체를 시도하지 않는다', async () => {
    const { adapter, source, local } = publishedHarness();
    const publisher = adapter.getPublisher();
    await publisher?.publishTrack(source, { source: 'camera', simulcast: false });

    await publisher?.replaceTrack?.(mediaTrack('other'), mediaTrack('next'));

    expect(local.replaceTrack).not.toHaveBeenCalled();
  });

  it('getOutboundBytes는 outbound-rtp의 bytesSent만 더한다', async () => {
    const report = statsReport([
      { type: 'outbound-rtp', bytesSent: 1_200 },
      { type: 'outbound-rtp', bytesSent: 800 },
      { type: 'inbound-rtp', bytesSent: 9_999 },
      { type: 'candidate-pair' },
    ]);
    const { adapter, source } = publishedHarness(report);
    const publisher = adapter.getPublisher();
    await publisher?.publishTrack(source, { source: 'camera', simulcast: false });

    await expect(publisher?.getOutboundBytes?.('local-face')).resolves.toBe(2_000);
  });

  it('통계를 못 읽거나 모르는 SID면 null이다. 0으로 위조하지 않는다', async () => {
    const { adapter, source } = publishedHarness(undefined);
    const publisher = adapter.getPublisher();
    await publisher?.publishTrack(source, { source: 'camera', simulcast: false });

    await expect(publisher?.getOutboundBytes?.('local-face')).resolves.toBeNull();
    await expect(publisher?.getOutboundBytes?.('unknown')).resolves.toBeNull();
  });

  it('unpublish 뒤에는 같은 SID의 통계를 돌려주지 않는다', async () => {
    const { adapter, source } = publishedHarness(
      statsReport([{ type: 'outbound-rtp', bytesSent: 5 }]),
    );
    const publisher = adapter.getPublisher();
    await publisher?.publishTrack(source, { source: 'camera', simulcast: false });

    await publisher?.unpublishTrack(source);

    await expect(publisher?.getOutboundBytes?.('local-face')).resolves.toBeNull();
  });
});

describe('internal publisher permissions', () => {
  const policy = (revision: number) => ({
    matchId: 'm',
    mediaInstanceId: 'i',
    receiverGeneration: 1,
    policyRevision: revision,
    bindingRevision: 1,
    stateVersion: revision,
    voices: [],
    effects: [],
    publisherPermissions: [
      { participantIdentity: 'receiver', allowedTrackSids: ['local-camera', 'foreign-track'] },
    ],
  });
  it('denies before connect and permits only known local tracks, including a late publication', async () => {
    const { adapter, rooms } = harness();
    const port = adapter.createRoom();
    await port.connect('wss://media.example', 'token', {
      autoSubscribe: false,
      subscriptionMode: 'publisher-permissions',
    });
    const room = rooms[0]!;
    const permission = room.localParticipant.setTrackSubscriptionPermissions;
    expect(permission).toHaveBeenCalledWith(false, []);
    expect(permission.mock.invocationCallOrder[0]).toBeLessThan(
      room.connect.mock.invocationCallOrder[0]!,
    );
    adapter.applyPublisherPermissions(policy(1));
    expect(permission).toHaveBeenCalledTimes(1);
    await adapter
      .getPublisher()!
      .publishTrack(mediaTrack('camera'), { source: 'camera', simulcast: false });
    expect(permission).toHaveBeenLastCalledWith(false, [
      { participantIdentity: 'receiver', allowAll: false, allowedTrackSids: ['local-camera'] },
    ]);
    await port.disconnect();
    expect(permission).toHaveBeenLastCalledWith(false, []);
  });
  it('fresh revisions renew the lease without SDK churn; duplicates cannot keep permission alive', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, rooms } = harness();
      const port = adapter.createRoom();
      await port.connect('wss://media.example', 'token', {
        autoSubscribe: false,
        subscriptionMode: 'publisher-permissions',
      });
      await adapter
        .getPublisher()!
        .publishTrack(mediaTrack('camera'), { source: 'camera', simulcast: false });
      const permission = rooms[0]!.localParticipant.setTrackSubscriptionPermissions;
      adapter.applyPublisherPermissions(policy(1));
      vi.advanceTimersByTime(1000);
      adapter.applyPublisherPermissions(policy(2));
      expect(permission).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1000);
      adapter.applyPublisherPermissions(policy(2));
      vi.advanceTimersByTime(501);
      expect(permission).toHaveBeenLastCalledWith(false, []);
      await port.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
  it('reconnecting clears permissions; an old room event cannot clear the next generation', async () => {
    const { adapter, rooms } = harness();
    const old = adapter.createRoom();
    await old.connect('wss://media.example', 'token', {
      autoSubscribe: false,
      subscriptionMode: 'publisher-permissions',
    });
    await adapter
      .getPublisher()!
      .publishTrack(mediaTrack('camera'), { source: 'camera', simulcast: false });
    adapter.applyPublisherPermissions(policy(1));
    rooms[0]!.emit(ROOM_EVENTS.reconnecting);
    expect(rooms[0]!.localParticipant.setTrackSubscriptionPermissions).toHaveBeenLastCalledWith(
      false,
      [],
    );
    const next = adapter.createRoom();
    await next.connect('wss://media.example', 'token', {
      autoSubscribe: false,
      subscriptionMode: 'publisher-permissions',
    });
    await adapter
      .getPublisher()!
      .publishTrack(mediaTrack('camera'), { source: 'camera', simulcast: false });
    adapter.applyPublisherPermissions(policy(1));
    rooms[0]!.emit(ROOM_EVENTS.disconnected);
    expect(rooms[1]!.localParticipant.setTrackSubscriptionPermissions).toHaveBeenLastCalledWith(
      false,
      [{ participantIdentity: 'receiver', allowAll: false, allowedTrackSids: ['local-camera'] }],
    );
    next.removeAllListeners();
    expect(rooms[1]!.localParticipant.setTrackSubscriptionPermissions).toHaveBeenLastCalledWith(
      false,
      [],
    );
  });
});

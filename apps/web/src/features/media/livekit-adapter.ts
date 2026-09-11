// D-13~D-16 후속. 실제 livekit-client 2.22.2 어댑터.
// 지금까지 미디어 경로는 주입 port로만 검증했고 제품 경로에는 SDK 구현이 없었다.
// 이 파일이 그 빈자리를 채운다. media-session·track-publisher·remote-faces·audio-graph가
// 요구하는 네 port를 하나의 Room 위에서 만든다.
//
// SDK 모듈은 정적 import하지 않고 주입한다. 제품 경로는 loadLiveKit()의 동적 import 결과를
// 넘기고 시험은 같은 모양의 가짜 모듈을 넘긴다. 덕분에 Node 시험이 브라우저 전용 SDK를
// 적재하지 않고 번들에서도 SDK가 별도 청크로 떨어진다.
//
// 소유권 주의: 원본 카메라·마이크 track과 가공 Canvas track은 D가 소유한다. SDK가 대신
// stop하지 않도록 disconnect·unpublish·replaceTrack의 stop 인수를 모두 D 소유 쪽으로 준다.
// retireMediaGeneration이 원본 장치를 살려 두는 계약이 여기에 걸려 있다.
import type { AudioPolicy } from './audio-policy';
import { ROOM_EVENTS, type MediaRoomPort } from './media-types';
import type { RemoteTrack } from './remote-faces';
import type { PublishOptions, PublisherPort } from './track-publisher';

/** SDK Track.Source 중 D가 쓰는 두 개. 문자열 리터럴을 만들지 않고 모듈 enum을 읽는다. */
export type SdkTrackSourceEnum = Readonly<{ Camera: string; Microphone: string }>;

export type SdkPublishOptions = Readonly<{
  source?: string;
  simulcast?: boolean;
  // SDK VideoEncoding의 maxFramerate는 선택이다. 여기서 필수로 좁히면 구조 대조가 깨진다.
  videoEncoding?: Readonly<{ maxBitrate: number; maxFramerate?: number }>;
}>;

export interface SdkLocalTrack {
  readonly mediaStreamTrack: MediaStreamTrack;
  replaceTrack(track: MediaStreamTrack, userProvidedTrack?: boolean): Promise<unknown>;
  getRTCStatsReport(): Promise<RTCStatsReport | undefined>;
}

export interface SdkLocalTrackPublication {
  readonly trackSid: string;
  readonly track?: SdkLocalTrack | undefined;
}

export interface SdkLocalParticipant {
  setTrackSubscriptionPermissions(
    allParticipantsAllowed: boolean,
    permissions: {
      participantIdentity?: string;
      allowAll?: boolean;
      allowedTrackSids?: string[];
    }[],
  ): void;
  publishTrack(
    track: MediaStreamTrack,
    options?: SdkPublishOptions,
  ): Promise<SdkLocalTrackPublication>;
  unpublishTrack(track: MediaStreamTrack, stopOnUnpublish?: boolean): Promise<unknown>;
}

export interface SdkRemoteTrack {
  readonly kind: string;
  readonly mediaStreamTrack: MediaStreamTrack;
  attach(element: HTMLMediaElement): unknown;
  detach(element?: HTMLMediaElement): unknown;
}

export interface SdkRemoteTrackPublication {
  readonly trackSid: string;
  setSubscribed(subscribed: boolean): void;
}

export interface SdkRemoteParticipant {
  readonly sid: string;
}

export interface SdkRoom {
  readonly localParticipant: SdkLocalParticipant;
  connect(url: string, token: string, options?: { autoSubscribe?: boolean }): Promise<void>;
  disconnect(stopTracks?: boolean): Promise<void>;
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
}

/** 어댑터가 실제로 쓰는 SDK 표면만 좁게 적는다. */
export type LiveKitModule = Readonly<{
  Room: new () => SdkRoom;
  Track: Readonly<{ Source: SdkTrackSourceEnum }>;
}>;

export type LiveKitAdapterHooks = Readonly<{
  /** SDK TrackSubscribed. 검증은 remote-faces가 하고 어댑터는 판단하지 않는다. */
  onRemoteTrack(track: RemoteTrack): void;
  onRemoteTrackRemoved(trackSid: string): void;
}>;

export interface LiveKitAdapter {
  applyPublisherPermissions(policy: AudioPolicy): void;
  clearPublisherPermissions(): void;
  /** media-session이 세대마다 부른다. 이 Room이 현재 세대의 유일한 Room이 된다. */
  createRoom(): MediaRoomPort;
  /** 현재 Room의 LocalParticipant 기반 게시 port. Room이 없으면 null이다. */
  getPublisher(): PublisherPort | null;
  /** 검증되지 않은 트랙의 구독을 실제로 멈춘다. */
  unsubscribeTrack(track: RemoteTrack): void;
  /** 구독 중인 오디오 트랙의 원본 MediaStreamTrack. */
  getAudioTrack(trackSid: string): MediaStreamTrack | null;
}

export const PUBLISHER_PERMISSION_LEASE_MS = 1500;
type RoomState = {
  publisherMode: boolean;
  revision: number;
  permissions: NonNullable<AudioPolicy['publisherPermissions']>;
  permissionFingerprint: string;
  lease: ReturnType<typeof setTimeout> | null;
  readonly room: SdkRoom;
  readonly remoteTracks: Map<string, SdkRemoteTrack>;
  readonly remotePublications: Map<string, SdkRemoteTrackPublication>;
  readonly localPublications: Map<string, SdkLocalTrackPublication>;
};

/** outbound-rtp의 bytesSent만 더한다. 다른 종류의 통계는 세지 않는다. */
function sumOutboundBytes(report: RTCStatsReport | undefined): number | null {
  if (!report) return null;
  let total: number | null = null;
  report.forEach((entry: unknown) => {
    const stat = entry as { type?: string; bytesSent?: number };
    if (stat.type !== 'outbound-rtp') return;
    if (typeof stat.bytesSent !== 'number') return;
    total = (total ?? 0) + stat.bytesSent;
  });
  return total;
}

export function createLiveKitAdapter(
  sdk: LiveKitModule,
  hooks: LiveKitAdapterHooks,
): LiveKitAdapter {
  let current: RoomState | null = null;

  const applyPermissions = (state: RoomState) => {
    if (!state.publisherMode) return;
    const permissions = state.permissions
      .map((entry) => ({
        participantIdentity: entry.participantIdentity,
        allowAll: false,
        allowedTrackSids: entry.allowedTrackSids.filter((sid) => state.localPublications.has(sid)),
      }))
      .filter((entry) => entry.allowedTrackSids.length > 0);
    const fingerprint = JSON.stringify(permissions);
    if (fingerprint === state.permissionFingerprint) return;
    state.room.localParticipant.setTrackSubscriptionPermissions(false, permissions);
    state.permissionFingerprint = fingerprint;
  };
  const clearPermissions = (state: RoomState) => {
    if (state.lease !== null) clearTimeout(state.lease);
    state.lease = null;
    state.permissions = [];
    applyPermissions(state);
  };
  const forget = (state: RoomState) => {
    clearPermissions(state);
    if (current !== state) return;
    state.remoteTracks.clear();
    state.remotePublications.clear();
    state.localPublications.clear();
    current = null;
  };

  const bindSubscriptions = (state: RoomState) => {
    const onSubscribed = (
      track: SdkRemoteTrack,
      publication: SdkRemoteTrackPublication,
      participant: SdkRemoteParticipant,
    ) => {
      // 버려진 Room의 늦은 사건은 현재 세대를 건드리지 않는다.
      if (current !== state) return;
      const trackSid = publication.trackSid;
      state.remoteTracks.set(trackSid, track);
      state.remotePublications.set(trackSid, publication);
      hooks.onRemoteTrack({
        trackSid,
        kind: track.kind === 'audio' ? 'audio' : 'video',
        participantSid: participant.sid,
        // 검증 전에는 remote-faces가 attach를 부르지 않는다. 어댑터는 수단만 준다.
        attach: (element) => {
          track.attach(element);
        },
        detach: (element) => {
          if (element) track.detach(element);
          else track.detach();
        },
      });
    };

    const onUnsubscribed = (_track: SdkRemoteTrack, publication: SdkRemoteTrackPublication) => {
      if (current !== state) return;
      const trackSid = publication.trackSid;
      state.remoteTracks.delete(trackSid);
      state.remotePublications.delete(trackSid);
      hooks.onRemoteTrackRemoved(trackSid);
    };

    for (const event of [
      ROOM_EVENTS.reconnecting,
      ROOM_EVENTS.signalReconnecting,
      ROOM_EVENTS.disconnected,
    ]) {
      state.room.on(event, () => clearPermissions(state));
    }
    state.room.on(ROOM_EVENTS.trackSubscribed, onSubscribed as (...args: never[]) => void);
    state.room.on(ROOM_EVENTS.trackUnsubscribed, onUnsubscribed as (...args: never[]) => void);
  };

  const createPublisher = (state: RoomState): PublisherPort => {
    const participant = state.room.localParticipant;
    return {
      async publishTrack(track: MediaStreamTrack, options: PublishOptions) {
        const publication = await participant.publishTrack(track, {
          source:
            options.source === 'camera' ? sdk.Track.Source.Camera : sdk.Track.Source.Microphone,
          simulcast: options.simulcast,
          ...(options.videoEncoding ? { videoEncoding: options.videoEncoding } : {}),
        });
        state.localPublications.set(publication.trackSid, publication);
        if (current === state) applyPermissions(state);
        return { trackSid: publication.trackSid };
      },
      async unpublishTrack(track: MediaStreamTrack) {
        // stopOnUnpublish=false. 원본 마이크와 가공 Canvas track은 D가 정리한다.
        await participant.unpublishTrack(track, false);
        for (const [sid, publication] of state.localPublications) {
          if (publication.track?.mediaStreamTrack === track) state.localPublications.delete(sid);
        }
      },
      async replaceTrack(currentTrack: MediaStreamTrack, next: MediaStreamTrack) {
        for (const publication of state.localPublications.values()) {
          const local = publication.track;
          if (!local || local.mediaStreamTrack !== currentTrack) continue;
          // userProvidedTrack=true. 교체 뒤에도 SDK가 D의 track을 stop하지 않는다.
          await local.replaceTrack(next, true);
          return;
        }
      },
      async getOutboundBytes(trackSid: string) {
        const local = state.localPublications.get(trackSid)?.track;
        if (!local) return null;
        return sumOutboundBytes(await local.getRTCStatsReport());
      },
    };
  };

  return {
    createRoom() {
      if (current) clearPermissions(current);
      const room = new sdk.Room();
      const state: RoomState = {
        room,
        publisherMode: false,
        revision: -1,
        permissions: [],
        permissionFingerprint: '',
        lease: null,
        remoteTracks: new Map(),
        remotePublications: new Map(),
        localPublications: new Map(),
      };
      current = state;
      bindSubscriptions(state);
      return {
        connect: (url, token, options) => {
          state.publisherMode = options.subscriptionMode === 'publisher-permissions';
          // Deny before connect or any publication; never inherit SDK default allow-all.
          applyPermissions(state);
          return room.connect(url, token, { autoSubscribe: false });
        },
        // stopTracks=false. 세대 종료가 원본 카메라·마이크를 끄면 안 된다.
        disconnect: async () => {
          clearPermissions(state);
          await room.disconnect(false);
        },
        on: (event, listener) => {
          room.on(event, listener as (...args: never[]) => void);
        },
        removeAllListeners: () => {
          // media-session의 수명 listener와 어댑터의 구독 listener를 함께 뗀다.
          // 이 Room은 버려지므로 어느 쪽도 남기지 않는다.
          room.removeAllListeners();
          forget(state);
        },
      };
    },

    applyPublisherPermissions(policy) {
      const state = current;
      if (
        !state?.publisherMode ||
        !policy.publisherPermissions ||
        policy.policyRevision <= state.revision
      )
        return;
      state.revision = policy.policyRevision;
      state.permissions = policy.publisherPermissions;
      applyPermissions(state);
      if (state.lease !== null) clearTimeout(state.lease);
      state.lease = setTimeout(() => clearPermissions(state), PUBLISHER_PERMISSION_LEASE_MS);
    },
    clearPublisherPermissions() {
      if (current) clearPermissions(current);
    },
    getPublisher() {
      if (!current) return null;
      return createPublisher(current);
    },

    unsubscribeTrack(track) {
      current?.remotePublications.get(track.trackSid)?.setSubscribed(false);
    },

    getAudioTrack(trackSid) {
      const track = current?.remoteTracks.get(trackSid);
      if (!track || track.kind !== 'audio') return null;
      return track.mediaStreamTrack;
    },
  };
}

/** 제품 경로의 SDK 적재. 동적 import라 초기 번들과 Node 시험에 SDK가 들어오지 않는다. */
let loading: Promise<LiveKitModule> | null = null;

export function loadLiveKit(): Promise<LiveKitModule> {
  // 세대마다 다시 내려받지 않는다.
  loading ??= import('livekit-client').then(
    (module) => ({ Room: module.Room, Track: module.Track }) as unknown as LiveKitModule,
  );
  return loading;
}

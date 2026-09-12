// D-14 / ME-04. 가공 얼굴과 선택 마이크만 게시한다.
// 원본 카메라·화면공유는 거절한다. LocalTrackPublished 성공은 서버 권한 승인이 아니다.
import { assertProcessedFace, isProcessedFaceHandle } from './face-compositor';
import type { MediaScope } from './media-types';

/** 얼굴 인코딩 설정 목표. 실측 bitrate는 오버헤드를 포함하므로 따로 구분한다. */
export const FACE_ENCODING = Object.freeze({
  maxBitrate: 100_000,
  maxFramerate: 10,
});

export const LOW_FACE_ENCODING = Object.freeze({
  maxBitrate: 50_000,
  maxFramerate: 8,
});

export type QualityPreset = 'medium' | 'low';

export type PublishSource = 'processed-face' | 'microphone';

export type PublishOptions = Readonly<{
  source: 'camera' | 'microphone';
  simulcast: false;
  videoEncoding?: Readonly<{ maxBitrate: number; maxFramerate: number }>;
}>;

/** SDK LocalParticipant의 최소 인터페이스. Node 시험에서 주입한다. */
export interface PublisherPort {
  publishTrack(track: MediaStreamTrack, options: PublishOptions): Promise<{ trackSid: string }>;
  unpublishTrack(track: MediaStreamTrack, stopOnUnpublish?: boolean): Promise<void>;
  /** 같은 publication/SID를 유지한 채 소스만 바꾼다. */
  replaceTrack?(current: MediaStreamTrack, next: MediaStreamTrack): Promise<void>;
  /** outbound 통계. bytesSent의 시간 차로 실측 bitrate를 낸다. */
  getOutboundBytes?(trackSid: string): Promise<number | null>;
}

export type PublicationRecord = Readonly<{
  source: PublishSource;
  trackSid: string;
  scope: MediaScope;
  /** B가 확인한 자기 바인딩을 받기 전에는 false다. SDK 성공만으로 true가 되지 않는다. */
  serverConfirmed: boolean;
}>;

export class PublishRejectedError extends Error {
  constructor(
    readonly code: 'RAW_TRACK_REJECTED' | 'SCREEN_SHARE_REJECTED' | 'NO_SCOPE' | 'RETIRED',
  ) {
    super(code);
    this.name = 'PublishRejectedError';
  }
}

export type TrackPublisherDeps = Readonly<{
  participant: PublisherPort;
  now(): number;
  onPublication?(records: readonly PublicationRecord[]): void;
}>;

export interface TrackPublisher {
  /** 가공 얼굴 handle만 받는다. 원본 track을 주면 거절한다. */
  publishFace(handle: unknown, scope: MediaScope, preset?: QualityPreset): Promise<string>;
  publishMicrophone(track: MediaStreamTrack, scope: MediaScope): Promise<string>;
  /** 마이크 off·장애. 해당 송출만 멈추고 얼굴·수신·게임 연결은 건드리지 않는다. */
  stopMicrophone(): Promise<void>;
  /** 같은 publication/SID를 유지한 소스 교체. 새 게시 사건을 요구하지 않는다. */
  replaceFaceSource(nextTrack: MediaStreamTrack): Promise<'replaced' | 'unsupported'>;
  /** B media-bindings에서 확인한 자기 SID만 승인으로 표시한다. */
  confirmFromBindings(scope: MediaScope, confirmedSids: readonly string[]): void;
  measureFaceBitrate(): Promise<{ measuredBps: number | null; configuredBps: number }>;
  getPublications(): readonly PublicationRecord[];
  /** 세대 교체·회수. 모든 publication을 정리한다. */
  unpublishAll(): Promise<void>;
}

export function createTrackPublisher(deps: TrackPublisherDeps): TrackPublisher {
  const records = new Map<PublishSource, PublicationRecord>();
  const tracks = new Map<PublishSource, MediaStreamTrack>();
  let configuredBps: number = FACE_ENCODING.maxBitrate;
  let lastBytes: { at: number; bytes: number } | null = null;
  let terminal = false;
  let tail: Promise<void> = Promise.resolve();
  let retiring: Promise<void> | null = null;
  let cleanupFailed = false;
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const assertLive = () => {
    if (terminal) throw new PublishRejectedError('RETIRED');
  };
  const unpublish = async (track: MediaStreamTrack) => {
    try {
      await deps.participant.unpublishTrack(track, false);
    } catch {
      cleanupFailed = true;
      throw new Error('LOCAL_RETIREMENT_UNCONFIRMED');
    }
  };
  const rejectLate = async (track: MediaStreamTrack) => {
    if (!terminal) return;
    await unpublish(track);
    throw new PublishRejectedError('RETIRED');
  };

  const publish = () => deps.onPublication?.([...records.values()]);

  const remove = async (source: PublishSource) => {
    const track = tracks.get(source);
    tracks.delete(source);
    records.delete(source);
    if (!track) return;
    // 게시 트랙 정리는 원본 장치 track을 stop하지 않는다.
    await unpublish(track);
  };

  return {
    publishFace(handle, scope, preset = 'medium') {
      return serialize(async () => {
        assertLive();
        if (!scope.mediaInstanceId) throw new PublishRejectedError('NO_SCOPE');
        // 원본 카메라 track이나 임의 객체는 여기서 막힌다.
        if (!isProcessedFaceHandle(handle)) throw new PublishRejectedError('RAW_TRACK_REJECTED');
        const processed = assertProcessedFace(handle);
        const encoding = preset === 'low' ? LOW_FACE_ENCODING : FACE_ENCODING;
        configuredBps = encoding.maxBitrate;
        // 새 SID 게시는 이전 publication을 먼저 정리한다.
        await remove('processed-face');
        assertLive();
        const { trackSid } = await deps.participant.publishTrack(processed.track, {
          source: 'camera',
          simulcast: false,
          videoEncoding: encoding,
        });
        if (terminal) await rejectLate(processed.track);
        tracks.set('processed-face', processed.track);
        // SDK 성공은 서버 권한 승인이 아니다. 바인딩 확인 전에는 serverConfirmed=false다.
        records.set('processed-face', {
          source: 'processed-face',
          trackSid,
          scope,
          serverConfirmed: false,
        });
        lastBytes = null;
        publish();
        return trackSid;
      });
    },

    publishMicrophone(track, scope) {
      return serialize(async () => {
        assertLive();
        if (!scope.mediaInstanceId) throw new PublishRejectedError('NO_SCOPE');
        if (track.kind !== 'audio') throw new PublishRejectedError('SCREEN_SHARE_REJECTED');
        if (track.readyState !== 'live') throw new Error('MICROPHONE_ENDED');
        const existing = records.get('microphone');
        if (
          tracks.get('microphone') === track &&
          existing &&
          existing.scope.matchId === scope.matchId &&
          existing.scope.mediaInstanceId === scope.mediaInstanceId &&
          existing.scope.receiverGeneration === scope.receiverGeneration
        )
          return existing.trackSid;
        await remove('microphone');
        assertLive();
        const { trackSid } = await deps.participant.publishTrack(track, {
          source: 'microphone',
          simulcast: false,
        });
        if (terminal) await rejectLate(track);
        tracks.set('microphone', track);
        records.set('microphone', {
          source: 'microphone',
          trackSid,
          scope,
          serverConfirmed: false,
        });
        publish();
        return trackSid;
      });
    },

    stopMicrophone() {
      return serialize(async () => {
        if (!records.has('microphone')) return;
        await remove('microphone');
        publish();
      });
    },

    replaceFaceSource(nextTrack) {
      return serialize(async () => {
        assertLive();
        const current = tracks.get('processed-face');
        const record = records.get('processed-face');
        if (!current || !record) return 'unsupported';
        if (!deps.participant.replaceTrack) return 'unsupported';
        await deps.participant.replaceTrack(current, nextTrack);
        if (terminal) await rejectLate(nextTrack);
        tracks.set('processed-face', nextTrack);
        // 같은 SID를 유지하므로 기존 권한과 불허 수신자 차단이 그대로다.
        // 새 webhook/SID를 기다리며 멈추지 않는다.
        publish();
        return 'replaced' as const;
      });
    },

    confirmFromBindings(scope, confirmedSids) {
      let changed = false;
      for (const [source, record] of records) {
        const sameScope =
          record.scope.matchId === scope.matchId &&
          record.scope.mediaInstanceId === scope.mediaInstanceId &&
          record.scope.receiverGeneration === scope.receiverGeneration;
        const confirmed = sameScope && confirmedSids.includes(record.trackSid);
        if (record.serverConfirmed === confirmed) continue;
        records.set(source, { ...record, serverConfirmed: confirmed });
        changed = true;
      }
      if (changed) publish();
    },

    async measureFaceBitrate() {
      const record = records.get('processed-face');
      if (!record || !deps.participant.getOutboundBytes)
        return { measuredBps: null, configuredBps };
      const bytes = await deps.participant.getOutboundBytes(record.trackSid).catch(() => null);
      const at = deps.now();
      if (bytes === null || !Number.isFinite(bytes)) return { measuredBps: null, configuredBps };
      const previous = lastBytes;
      lastBytes = { at, bytes };
      if (!previous || at <= previous.at) return { measuredBps: null, configuredBps };
      const seconds = (at - previous.at) / 1000;
      const measuredBps = ((bytes - previous.bytes) * 8) / seconds;
      // 설정 목표와 오버헤드를 포함한 실측은 다른 값이다.
      return { measuredBps: Number.isFinite(measuredBps) ? measuredBps : null, configuredBps };
    },

    getPublications: () => [...records.values()],

    unpublishAll() {
      terminal = true;
      retiring ??= serialize(async () => {
        const results = await Promise.allSettled([remove('processed-face'), remove('microphone')]);
        lastBytes = null;
        publish();
        if (cleanupFailed || results.some((result) => result.status === 'rejected'))
          throw new Error('LOCAL_RETIREMENT_UNCONFIRMED');
      });
      return retiring;
    },
  };
}

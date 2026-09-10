// D-15 / ME-05. 검증된 참가자 얼굴만 수신하고 교체를 처리한다.
// 트랙 레지스트리와 검증 바인딩을 따로 보관하고 어느 입력이 바뀌어도 reconcile한다.
// 검증 전 트랙은 attach도 play도 하지 않는다.
import { isSelfPublishConfirmed, type BindingStore, type MediaBinding } from './media-bindings';
import { isSameScope, type MediaScope } from './media-types';
import { createPendingTrackStore, type PendingTrackStore } from './pending-tracks';

/** 본 경기의 다른 활동자 최대 5명, 연습 같은 인스턴스 최대 2명. */
export const MAX_GAME_REMOTE_FACES = 5;
export const MAX_PRACTICE_REMOTE_FACES = 2;

export type InstancePurpose = 'practice' | 'game';

export function remoteFaceLimit(purpose: InstancePurpose): number {
  return purpose === 'practice' ? MAX_PRACTICE_REMOTE_FACES : MAX_GAME_REMOTE_FACES;
}

/** SDK가 준 원격 트랙. */
export type RemoteTrack = Readonly<{
  trackSid: string;
  kind: 'video' | 'audio';
  participantSid: string;
  attach(element: HTMLVideoElement): void;
  detach(element?: HTMLVideoElement): void;
}>;

export type FaceTrackEvent = MediaScope &
  Readonly<{
    playerId: string;
    publisherGeneration: number;
    trackSid: string;
    element: HTMLVideoElement | null;
  }>;

export type RemoteFacesDeps = Readonly<{
  bindings: BindingStore;
  /** D가 소유하는 원격 video element를 만든다. */
  createElement(): HTMLVideoElement;
  now(): number;
  /** C가 VideoTexture를 붙이거나 해제한다. null은 해제 신호다. */
  onFaceTrack(event: FaceTrackEvent): void;
  /** 검증되지 않은 트랙의 구독을 멈춘다. */
  unsubscribe(track: RemoteTrack): void;
  /** 보류 초과·만료에서 B의 현재 검증 목록 재전송을 요청한다. */
  requestBindingsRefresh(request: MediaScope & { lastBindingRevision: number }): void;
  getPurpose(): InstancePurpose;
  pending?: PendingTrackStore;
}>;

export interface RemoteFaces {
  /** TrackSubscribed. 검증 전에는 보류만 한다. */
  addTrack(track: RemoteTrack): void;
  /** 구독 해제·퇴장. 현재 붙어 있는 SID만 해제한다. */
  removeTrack(trackSid: string): void;
  /** 바인딩이 바뀌면 이미 받은 publication을 다시 대조한다. */
  reconcile(): void;
  /** 보류 만료 정리. 주기적 호출은 상위가 담당한다. */
  sweep(): void;
  getAttached(): readonly Readonly<{ playerId: string; trackSid: string }>[];
  /** scope 변경·종료. 모든 원격 자원을 해제한다. */
  clear(): void;
}

type Attached = {
  playerId: string;
  trackSid: string;
  publisherGeneration: number;
  element: HTMLVideoElement;
  track: RemoteTrack;
  scope: MediaScope;
};

export function createRemoteFaces(deps: RemoteFacesDeps): RemoteFaces {
  const pending = deps.pending ?? createPendingTrackStore();
  // 트랙 레지스트리와 바인딩은 서로 독립이다.
  const tracks = new Map<string, RemoteTrack>();
  const attached = new Map<string, Attached>();

  const askRefresh = () => {
    const scope = deps.bindings.getScope();
    if (!scope) return;
    deps.requestBindingsRefresh({
      ...scope,
      lastBindingRevision: Math.max(0, deps.bindings.getRevision()),
    });
  };

  const dropPending = (evicted: readonly { trackSid: string }[], needsRefresh: boolean) => {
    for (const item of evicted) {
      const track = tracks.get(item.trackSid);
      tracks.delete(item.trackSid);
      // 검증되지 않은 트랙은 detach 후 구독을 멈춘다.
      if (track) deps.unsubscribe(track);
    }
    if (needsRefresh) askRefresh();
  };

  const release = (entry: Attached, reason: 'replaced' | 'removed') => {
    attached.delete(entry.playerId);
    // C texture를 먼저 해제하고 D가 video를 정리한다.
    deps.onFaceTrack({
      ...entry.scope,
      playerId: entry.playerId,
      publisherGeneration: entry.publisherGeneration,
      trackSid: entry.trackSid,
      element: null,
    });
    try {
      entry.track.detach(entry.element);
    } catch {
      // 이미 분리된 트랙은 무시한다.
    }
    entry.element.srcObject = null;
    entry.element.remove?.();
    if (reason === 'removed') tracks.delete(entry.trackSid);
  };

  const attach = (binding: MediaBinding, track: RemoteTrack, scope: MediaScope) => {
    const element = deps.createElement();
    element.muted = true;
    element.playsInline = true;
    element.autoplay = true;
    track.attach(element);
    attached.set(binding.playerId, {
      playerId: binding.playerId,
      trackSid: track.trackSid,
      publisherGeneration: binding.publisherGeneration,
      element,
      track,
      scope,
    });
    deps.onFaceTrack({
      ...scope,
      playerId: binding.playerId,
      publisherGeneration: binding.publisherGeneration,
      trackSid: track.trackSid,
      element,
    });
  };

  const reconcile = () => {
    const scope = deps.bindings.getScope();
    if (!scope) {
      for (const entry of [...attached.values()]) release(entry, 'removed');
      return;
    }
    // 세대가 바뀐 기존 부착은 전부 해제한다.
    for (const entry of [...attached.values()])
      if (!isSameScope(entry.scope, scope)) release(entry, 'removed');

    const remote = deps.bindings.getRemote();
    const limit = remoteFaceLimit(deps.getPurpose());

    // 1) 더 이상 허용되지 않거나 SID/세대가 바뀐 부착을 정리한다.
    for (const entry of [...attached.values()]) {
      const binding = remote.find((item) => item.playerId === entry.playerId);
      if (!binding || !binding.faceTrackSid) {
        release(entry, 'removed');
        continue;
      }
      if (
        binding.faceTrackSid !== entry.trackSid ||
        binding.publisherGeneration !== entry.publisherGeneration
      ) {
        // 원격 한 명의 교체는 그 사람 자원만 바꾼다.
        release(entry, 'replaced');
      }
    }

    // 2) 검증된 바인딩과 실제 트랙이 모두 있는 것만 붙인다.
    for (const binding of remote) {
      if (!binding.faceTrackSid) continue;
      if (attached.has(binding.playerId)) continue;
      if (attached.size >= limit) break;
      const track = tracks.get(binding.faceTrackSid);
      if (!track || track.kind !== 'video') continue;
      // participantSid도 독립 대조한다.
      if (track.participantSid !== binding.participantSid) continue;
      pending.resolve(binding.faceTrackSid);
      attach(binding, track, scope);
    }

    // 3) 검증된 오디오 트랙도 보류에서 뺀다. 얼굴만 빼면 2초 뒤 음성 구독이 끊긴다.
    for (const binding of remote) {
      if (!binding.audioTrackSid) continue;
      const track = tracks.get(binding.audioTrackSid);
      if (!track || track.kind !== 'audio') continue;
      if (track.participantSid !== binding.participantSid) continue;
      pending.resolve(binding.audioTrackSid);
    }

    // 4) 여전히 검증되지 않은 보류는 만료 규칙을 따른다.
    const expired = pending.expire(deps.now());
    dropPending(expired.evicted, expired.needsRefresh);
  };

  return {
    addTrack(track) {
      tracks.set(track.trackSid, track);
      const scope = deps.bindings.getScope();
      const binding =
        track.kind === 'video'
          ? deps.bindings.findByFaceTrack(track.trackSid)
          : deps.bindings.findByAudioTrack(track.trackSid);
      if (scope && binding && binding.participantSid === track.participantSid) {
        reconcile();
        return;
      }
      // 검증 전에는 attach도 play도 하지 않고 보류만 한다.
      const overflow = pending.add({
        trackSid: track.trackSid,
        kind: track.kind,
        participantSid: track.participantSid,
        arrivedAtMs: deps.now(),
      });
      dropPending(overflow.evicted, overflow.needsRefresh);
    },

    removeTrack(trackSid) {
      pending.resolve(trackSid);
      const entry = [...attached.values()].find((item) => item.trackSid === trackSid);
      // 구 SID 사건은 새 SID의 element를 닫지 못한다.
      if (entry) release(entry, 'removed');
      tracks.delete(trackSid);
    },

    reconcile,

    sweep() {
      const expired = pending.expire(deps.now());
      dropPending(expired.evicted, expired.needsRefresh);
    },

    getAttached: () =>
      [...attached.values()].map((entry) => ({
        playerId: entry.playerId,
        trackSid: entry.trackSid,
      })),

    clear() {
      for (const entry of [...attached.values()]) release(entry, 'removed');
      const stale = pending.clear();
      for (const item of stale) {
        const track = tracks.get(item.trackSid);
        if (track) deps.unsubscribe(track);
      }
      tracks.clear();
    },
  };
}

export { isSelfPublishConfirmed };

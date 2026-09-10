// D-15 / ME-05. 개인 media-bindings 검증.
// 이 목록만이 신원 매핑의 유일한 근거다. nickname/metadata/attributes로 매핑을 추측하지 않는다.
import { isSameScope, type MediaScope } from './media-types';

export type MediaBinding = Readonly<{
  playerId: string;
  publisherGeneration: number;
  mediaIdentity: string;
  participantSid: string;
  faceTrackSid?: string;
  audioTrackSid?: string;
}>;

export type MediaBindings = MediaScope &
  Readonly<{ bindingRevision: number; participants: readonly MediaBinding[] }>;

export type BindingApplyResult =
  | Readonly<{ status: 'applied'; bindings: MediaBindings }>
  /** 다른 scope, 같거나 낮은 revision, 모양 오류는 적용하지 않는다. */
  | Readonly<{
      status: 'ignored';
      reason: 'WRONG_SCOPE' | 'STALE_REVISION' | 'MALFORMED';
    }>;

export interface BindingStore {
  /** Only an accepted grant can authorize a receiver scope change. */
  beginScope(scope: MediaScope): void;
  apply(bindings: MediaBindings, selfPlayerId: string): BindingApplyResult;
  /** 현재 세대의 검증된 원격 항목. 자기 entry는 제외한다. */
  getRemote(): readonly MediaBinding[];
  /** 자기 게시 검증용 entry. 원격 attach 대상이 아니다. */
  getSelf(): MediaBinding | null;
  /** trackSid가 현재 허용된 원격 얼굴인지. */
  findByFaceTrack(trackSid: string): MediaBinding | null;
  findByAudioTrack(trackSid: string): MediaBinding | null;
  getScope(): MediaScope | null;
  getRevision(): number;
  /** scope가 바뀌면 전부 비운다. */
  reset(): void;
}

function isBindingShape(value: unknown): value is MediaBinding {
  if (typeof value !== 'object' || value === null) return false;
  const binding = value as Record<string, unknown>;
  if (typeof binding.playerId !== 'string' || binding.playerId.length === 0) return false;
  if (typeof binding.mediaIdentity !== 'string' || binding.mediaIdentity.length === 0) return false;
  if (typeof binding.participantSid !== 'string' || binding.participantSid.length === 0)
    return false;
  if (!Number.isFinite(binding.publisherGeneration)) return false;
  if (binding.faceTrackSid !== undefined && typeof binding.faceTrackSid !== 'string') return false;
  if (binding.audioTrackSid !== undefined && typeof binding.audioTrackSid !== 'string')
    return false;
  return true;
}

export function createBindingStore(): BindingStore {
  let scope: MediaScope | null = null;
  let revision = -1;
  let remote: MediaBinding[] = [];
  let self: MediaBinding | null = null;

  return {
    beginScope(next) {
      if (scope && isSameScope(scope, next)) return;
      scope = { ...next };
      revision = -1;
      remote = [];
      self = null;
    },
    apply(bindings, selfPlayerId) {
      if (
        typeof bindings !== 'object' ||
        bindings === null ||
        !Number.isFinite(bindings.bindingRevision) ||
        !Array.isArray(bindings.participants) ||
        !bindings.participants.every(isBindingShape)
      )
        return { status: 'ignored', reason: 'MALFORMED' };

      const incoming: MediaScope = {
        matchId: bindings.matchId,
        mediaInstanceId: bindings.mediaInstanceId,
        receiverGeneration: bindings.receiverGeneration,
      };
      if (scope && !isSameScope(scope, incoming))
        return { status: 'ignored', reason: 'WRONG_SCOPE' };
      if (scope && bindings.bindingRevision <= revision)
        return { status: 'ignored', reason: 'STALE_REVISION' };

      scope = incoming;
      revision = bindings.bindingRevision;
      // 전체 허용 목록을 통째로 교체한다. 부분 병합하지 않는다.
      self = bindings.participants.find((entry) => entry.playerId === selfPlayerId) ?? null;
      remote = bindings.participants.filter((entry) => entry.playerId !== selfPlayerId);
      return { status: 'applied', bindings };
    },

    getRemote: () => remote,
    getSelf: () => self,

    findByFaceTrack(trackSid) {
      if (trackSid.length === 0) return null;
      return remote.find((entry) => entry.faceTrackSid === trackSid) ?? null;
    },

    findByAudioTrack(trackSid) {
      if (trackSid.length === 0) return null;
      return remote.find((entry) => entry.audioTrackSid === trackSid) ?? null;
    },

    getScope: () => scope,
    getRevision: () => revision,

    reset() {
      scope = null;
      revision = -1;
      remote = [];
      self = null;
    },
  };
}

/**
 * 자기 게시가 서버에서 확인됐는지.
 * 자기 항목은 publisherGeneration=receiverGeneration이어야 한다.
 */
export function isSelfPublishConfirmed(
  self: MediaBinding | null,
  scope: MediaScope | null,
  faceTrackSid: string | null,
): boolean {
  if (!self || !scope || !faceTrackSid) return false;
  if (self.publisherGeneration !== scope.receiverGeneration) return false;
  return self.faceTrackSid === faceTrackSid;
}

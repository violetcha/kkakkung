// D-15 / ME-05. 검증 전 트랙의 공통 보류 저장소.
// 영상·오디오 합산 최대 12개, 도착 후 2초까지만 보류한다. 무제한 큐나 polling을 만들지 않는다.
// D-16(ME-06)이 같은 저장소를 재사용한다.

/** 수신자 세대 전체에서의 보류 상한. */
export const PENDING_TRACK_LIMIT = 12;
export const PENDING_TRACK_TTL_MS = 2000;

export type PendingKind = 'video' | 'audio';

export type PendingTrack = Readonly<{
  trackSid: string;
  kind: PendingKind;
  participantSid: string;
  arrivedAtMs: number;
}>;

export type PendingOverflow = Readonly<{
  /** detach·구독 중지할 트랙. */
  evicted: readonly PendingTrack[];
  /** 상한 초과나 만료가 있었으면 bindings-refresh를 요청한다. */
  needsRefresh: boolean;
}>;

export interface PendingTrackStore {
  /** 검증 전 트랙을 보류한다. 상한을 넘으면 오래된 것부터 내보낸다. */
  add(track: PendingTrack): PendingOverflow;
  /** 만료분을 걷어낸다. */
  expire(nowMs: number): PendingOverflow;
  /** 검증되어 보류에서 빠진다. */
  resolve(trackSid: string): PendingTrack | null;
  has(trackSid: string): boolean;
  list(): readonly PendingTrack[];
  /** scope 변경. 보류와 실제 그래프를 함께 비운다. */
  clear(): readonly PendingTrack[];
  readonly size: number;
}

export function createPendingTrackStore(
  limit: number = PENDING_TRACK_LIMIT,
  ttlMs: number = PENDING_TRACK_TTL_MS,
): PendingTrackStore {
  // 삽입 순서를 유지해 오래된 것부터 내보낸다.
  const pending = new Map<string, PendingTrack>();

  const evictOverflow = (): PendingTrack[] => {
    const evicted: PendingTrack[] = [];
    while (pending.size > limit) {
      const oldest = pending.keys().next();
      if (oldest.done) break;
      const track = pending.get(oldest.value)!;
      pending.delete(oldest.value);
      evicted.push(track);
    }
    return evicted;
  };

  return {
    add(track) {
      // 같은 SID가 다시 오면 도착 시각만 갱신하고 개수를 늘리지 않는다.
      pending.delete(track.trackSid);
      pending.set(track.trackSid, track);
      const evicted = evictOverflow();
      return { evicted, needsRefresh: evicted.length > 0 };
    },

    expire(nowMs) {
      const evicted: PendingTrack[] = [];
      for (const [sid, track] of [...pending.entries()]) {
        if (nowMs - track.arrivedAtMs <= ttlMs) continue;
        pending.delete(sid);
        evicted.push(track);
      }
      return { evicted, needsRefresh: evicted.length > 0 };
    },

    resolve(trackSid) {
      const track = pending.get(trackSid) ?? null;
      if (track) pending.delete(trackSid);
      return track;
    },

    has: (trackSid) => pending.has(trackSid),
    list: () => [...pending.values()],

    clear() {
      const all = [...pending.values()];
      pending.clear();
      return all;
    },

    get size() {
      return pending.size;
    },
  };
}

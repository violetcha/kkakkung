import { describe, expect, it } from 'vitest';

import {
  createPendingTrackStore,
  PENDING_TRACK_LIMIT,
  PENDING_TRACK_TTL_MS,
  type PendingTrack,
} from './pending-tracks';

const track = (index: number, atMs = 1000, kind: 'video' | 'audio' = 'video'): PendingTrack => ({
  trackSid: `TR_${index}`,
  kind,
  participantSid: `PA_${index}`,
  arrivedAtMs: atMs,
});

describe('createPendingTrackStore', () => {
  it('pins the shared 12 track and 2 second limits', () => {
    expect(PENDING_TRACK_LIMIT).toBe(12);
    expect(PENDING_TRACK_TTL_MS).toBe(2000);
  });

  it('holds a track without evicting under the limit', () => {
    const store = createPendingTrackStore();

    for (let index = 0; index < PENDING_TRACK_LIMIT; index += 1) {
      const result = store.add(track(index));
      expect(result.evicted).toHaveLength(0);
      expect(result.needsRefresh).toBe(false);
    }
    expect(store.size).toBe(PENDING_TRACK_LIMIT);
  });

  it('evicts the oldest and asks for a refresh past the limit', () => {
    const store = createPendingTrackStore();
    for (let index = 0; index < PENDING_TRACK_LIMIT; index += 1) store.add(track(index));

    const result = store.add(track(99));

    expect(result.evicted.map((item) => item.trackSid)).toEqual(['TR_0']);
    expect(result.needsRefresh).toBe(true);
    expect(store.size).toBe(PENDING_TRACK_LIMIT);
    expect(store.has('TR_0')).toBe(false);
    expect(store.has('TR_99')).toBe(true);
  });

  it('counts video and audio in the same shared budget', () => {
    const store = createPendingTrackStore(3);
    store.add(track(1, 1000, 'video'));
    store.add(track(2, 1000, 'audio'));
    store.add(track(3, 1000, 'video'));

    const result = store.add(track(4, 1000, 'audio'));

    expect(result.evicted.map((item) => item.trackSid)).toEqual(['TR_1']);
    expect(store.size).toBe(3);
  });

  it('refreshes the arrival time of a repeated sid without growing the count', () => {
    const store = createPendingTrackStore();
    store.add(track(1, 1000));

    const result = store.add(track(1, 1500));

    expect(result.evicted).toHaveLength(0);
    expect(store.size).toBe(1);
    expect(store.list()[0]!.arrivedAtMs).toBe(1500);
  });

  it('expires only the tracks past the 2 second hold', () => {
    const store = createPendingTrackStore();
    store.add(track(1, 1000));
    store.add(track(2, 1500));

    const onBoundary = store.expire(1000 + PENDING_TRACK_TTL_MS);
    expect(onBoundary.evicted).toHaveLength(0);

    const result = store.expire(1000 + PENDING_TRACK_TTL_MS + 1);

    expect(result.evicted.map((item) => item.trackSid)).toEqual(['TR_1']);
    expect(result.needsRefresh).toBe(true);
    expect(store.has('TR_2')).toBe(true);
  });

  it('reports no refresh when nothing expired', () => {
    const store = createPendingTrackStore();
    store.add(track(1, 1000));

    expect(store.expire(1100)).toEqual({ evicted: [], needsRefresh: false });
  });

  it('removes a track from the hold once it is verified', () => {
    const store = createPendingTrackStore();
    store.add(track(1));

    expect(store.resolve('TR_1')?.trackSid).toBe('TR_1');
    expect(store.size).toBe(0);
    expect(store.resolve('TR_1')).toBeNull();
  });

  it('returns everything it held on clear', () => {
    const store = createPendingTrackStore();
    store.add(track(1));
    store.add(track(2));

    const cleared = store.clear();

    expect(cleared.map((item) => item.trackSid)).toEqual(['TR_1', 'TR_2']);
    expect(store.size).toBe(0);
  });

  it('never grows without bound', () => {
    const store = createPendingTrackStore();
    for (let index = 0; index < 200; index += 1) store.add(track(index));

    expect(store.size).toBe(PENDING_TRACK_LIMIT);
  });
});

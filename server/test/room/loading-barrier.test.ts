import { describe, expect, it } from 'vitest';
import { LoadingCoordinator } from '../../src/rooms/LoadingCoordinator.js';

const players = ['p1', 'p2', 'p3'];

describe('LoadingCoordinator', () => {
  it('passes only when every current report and self face confirmation matches the scope', () => {
    const loading = new LoadingCoordinator({ requireFace: true });
    loading.open({ loadId: 'load-1', mediaInstanceId: 'media-1', playerIds: players, nowMs: 0 });
    for (const [i, id] of players.entries()) loading.setReceiverGeneration(id, 'media-1', i + 1);
    expect(
      loading.applyLoadReady('p1', {
        loadId: 'load-1',
        mediaInstanceId: 'media-1',
        receiverGeneration: 1,
      }),
    ).toEqual({ result: 'applied', code: null });
    expect(
      loading.applyLoadReady('p2', {
        loadId: 'old',
        mediaInstanceId: 'media-1',
        receiverGeneration: 2,
      }),
    ).toEqual({ result: 'rejected', code: 'EXPIRED' });
    expect(
      loading.applyLoadReady('p2', {
        loadId: 'load-1',
        mediaInstanceId: 'other',
        receiverGeneration: 2,
      }),
    ).toEqual({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(
      loading.applyLoadReady('p2', {
        loadId: 'load-1',
        mediaInstanceId: 'media-1',
        receiverGeneration: 1,
      }),
    ).toEqual({ result: 'rejected', code: 'NOT_READY' });
    expect(
      loading.applyLoadReady('p2', {
        loadId: 'load-1',
        mediaInstanceId: 'media-1',
        receiverGeneration: 2,
      }),
    ).toEqual({ result: 'applied', code: null });
    expect(
      loading.applyLoadReady('p3', {
        loadId: 'load-1',
        mediaInstanceId: 'media-1',
        receiverGeneration: 3,
      }),
    ).toEqual({ result: 'applied', code: null });
    expect(loading.evaluate(1000)).toBe('waiting');
    expect(loading.confirmSelfFace('p1', 'media-1', 1, 'TR_face_1')).toBe(true);
    expect(loading.confirmSelfFace('p2', 'media-1', 1, 'TR_face_old')).toBe(false);
    expect(loading.confirmSelfFace('p2', 'media-1', 2, undefined)).toBe(false);
    expect(loading.confirmSelfFace('p2', 'media-1', 2, 'TR_face_2')).toBe(true);
    expect(loading.evaluate(1000)).toBe('waiting');
    expect(loading.confirmSelfFace('p3', 'media-1', 3, 'TR_face_3')).toBe(true);
    expect(loading.evaluate(1000)).toBe('complete');
    expect(loading.loadingView('p1', 40, 'assets-1')).toEqual({
      loadId: 'load-1',
      initialViewVersion: 40,
      mediaInstanceId: 'media-1',
      receiverGeneration: 1,
      assetVersion: 'assets-1',
    });
  });

  it('only one participant regenerating keeps the others intact and resets that participant', () => {
    const loading = new LoadingCoordinator({ requireFace: true });
    loading.open({ loadId: 'load-1', mediaInstanceId: 'media-1', playerIds: players, nowMs: 0 });
    for (const id of players) {
      loading.setReceiverGeneration(id, 'media-1', 1);
      loading.applyLoadReady(id, {
        loadId: 'load-1',
        mediaInstanceId: 'media-1',
        receiverGeneration: 1,
      });
      loading.confirmSelfFace(id, 'media-1', 1, `TR_${id}`);
    }
    expect(loading.evaluate(0)).toBe('complete');
    loading.setReceiverGeneration('p2', 'media-1', 2);
    expect(loading.receiverGeneration('p1')).toBe(1);
    expect(loading.receiverGeneration('p2')).toBe(2);
    expect(loading.evaluate(0)).toBe('waiting');
    expect(
      loading.applyLoadReady('p2', {
        loadId: 'load-1',
        mediaInstanceId: 'media-1',
        receiverGeneration: 1,
      }),
    ).toEqual({ result: 'rejected', code: 'NOT_READY' });
  });

  it('times out after 30 seconds and rejects late reports for an invalidated loadId', () => {
    const loading = new LoadingCoordinator({ requireFace: false });
    loading.open({ loadId: 'load-1', mediaInstanceId: 'media-1', playerIds: players, nowMs: 0 });
    for (const id of players) loading.setReceiverGeneration(id, 'media-1', 0);
    expect(loading.evaluate(29_999)).toBe('waiting');
    expect(loading.evaluate(30_000)).toBe('timeout');
    loading.invalidate();
    expect(
      loading.applyLoadReady('p1', {
        loadId: 'load-1',
        mediaInstanceId: 'media-1',
        receiverGeneration: 0,
      }),
    ).toEqual({ result: 'rejected', code: 'INVALID_PHASE' });
    expect(loading.loadingView('p1', 1, 'a')).toBeNull();
  });
});

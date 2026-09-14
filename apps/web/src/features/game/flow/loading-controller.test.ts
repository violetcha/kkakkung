import { expect, it, vi } from 'vitest';
import { createLoadingController, loadingDisplay } from './loading-controller';
import { roundFixture, viewFixture } from '../../room/product-fixture';
it('requires asset version, initial view, connected scope and verified self face before sending once', () => {
  const send = vi.fn();
  const loader = createLoadingController(send);
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw new Error();
  const loading = {
    loadId: 'l',
    initialViewVersion: 10,
    mediaInstanceId: 'media',
    receiverGeneration: 1,
    assetVersion: 'asset',
  };
  const loaded = { ...view, self: { ...view.self, loading } };
  const key = loader.update(roundFixture({ phase: 'GAME_LOADING' }), loaded);
  const media = {
    matchId: 'm',
    mediaInstanceId: 'media',
    receiverGeneration: 1,
    state: 'connected' as const,
    code: null,
  };
  const bindings = {
    matchId: 'm',
    mediaInstanceId: 'media',
    receiverGeneration: 1,
    bindingRevision: 1,
    participants: [
      {
        playerId: 'self',
        publisherGeneration: 1,
        faceTrackSid: 'face',
        mediaIdentity: 'identity',
        participantSid: 'sid',
      },
    ],
  };
  loader.assetsLoaded('old', 'asset');
  expect(loader.check(loaded, bindings, media)).toBe(false);
  loader.assetsLoaded(key, 'asset');
  expect(loader.check(loaded, { ...bindings, participants: [] }, media)).toBe(false);
  expect(loader.check(loaded, bindings, media)).toBe(true);
  expect(loader.check(loaded, bindings, media)).toBe(false);
  expect(send).toHaveBeenCalledOnce();
});
it('keeps countdown covered at local zero until authoritative PLAYING', () => {
  expect(loadingDisplay(roundFixture({ phase: 'COUNTDOWN', startAt: 3000 }), 4000)).toMatchObject({
    covered: true,
    countdown: 0,
  });
  expect(loadingDisplay(roundFixture(), 4000).covered).toBe(false);
});
it('lists what this client is still waiting for, and nothing once the report is sent', () => {
  const send = vi.fn();
  const loader = createLoadingController(send);
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw new Error();
  const loading = {
    loadId: 'l',
    initialViewVersion: 10,
    mediaInstanceId: 'media',
    receiverGeneration: 1,
    assetVersion: 'asset',
  };
  const loaded = { ...view, self: { ...view.self, loading } };
  const key = loader.update(roundFixture({ phase: 'GAME_LOADING' }), loaded);
  const media = {
    matchId: 'm',
    mediaInstanceId: 'media',
    receiverGeneration: 1,
    state: 'connected' as const,
    code: null,
  };
  const bindings = {
    matchId: 'm',
    mediaInstanceId: 'media',
    receiverGeneration: 1,
    bindingRevision: 1,
    participants: [
      {
        playerId: 'self',
        publisherGeneration: 1,
        faceTrackSid: 'face',
        mediaIdentity: 'identity',
        participantSid: 'sid',
      },
    ],
  };
  // Nothing loaded or connected yet: every gate is listed, in a fixed order. Device readiness
  // (camera/vision/calibration/audio) is deliberately not a gate: the server confirms the face.
  expect(loader.pending(loaded, null, null)).toEqual([
    '경기장 자산',
    '카메라 연결',
    '내 얼굴 게시 확인',
  ]);
  loader.assetsLoaded(key, 'asset');
  expect(loader.pending(loaded, bindings, { ...media, state: 'connecting' as const })).toEqual([
    '카메라 연결',
  ]);
  expect(loader.pending(loaded, { ...bindings, participants: [] }, media)).toEqual([
    '내 얼굴 게시 확인',
  ]);
  expect(loader.pending(loaded, bindings, media)).toEqual([]);
  expect(loader.check(loaded, bindings, media)).toBe(true);
  // Sent: the rest is other participants, so nothing is pending on this side.
  expect(loader.pending(loaded, null, null)).toEqual([]);
});

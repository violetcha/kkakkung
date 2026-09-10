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

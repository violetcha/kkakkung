import { expect, it, vi } from 'vitest';
import { createLoadingController, describePending, loadingDisplay } from './loading-controller';
import { createReadinessRecorder } from '../../devices/readiness-trace';
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
it('reports without camera or face when the room needs no media (operator demo room)', () => {
  const send = vi.fn();
  const loader = createLoadingController(send);
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw new Error();
  const loading = {
    loadId: 'l',
    initialViewVersion: 10,
    mediaInstanceId: 'media',
    receiverGeneration: 0,
    assetVersion: 'asset',
  };
  const loaded = { ...view, self: { ...view.self, loading } };
  const key = loader.update(roundFixture({ phase: 'GAME_LOADING' }), loaded);
  // 자산·초기 화면은 여전히 기다린다.
  expect(loader.pending(loaded, null, null, { mediaRequired: false })).toEqual(['경기장 자산']);
  expect(loader.check(loaded, null, null, { mediaRequired: false })).toBe(false);
  loader.assetsLoaded(key, 'asset');
  expect(loader.pending(loaded, null, null, { mediaRequired: false })).toEqual([]);
  expect(loader.check(loaded, null, null, { mediaRequired: false })).toBe(true);
  expect(send).toHaveBeenCalledExactlyOnceWith({
    loadId: 'l',
    mediaInstanceId: 'media',
    receiverGeneration: 0,
  });
  // 기본값은 여전히 미디어를 요구한다.
  const again = createLoadingController(vi.fn());
  const againKey = again.update(roundFixture({ phase: 'GAME_LOADING' }), loaded);
  again.assetsLoaded(againKey, 'asset');
  expect(again.check(loaded, null, null)).toBe(false);
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
it('annotates waiting items with the blocked client stage, cause and elapsed time', () => {
  const pending = ['경기장 자산', '카메라 연결', '내 얼굴 게시 확인'];
  const recorder = createReadinessRecorder();
  // No trace yet: the plain items stay, never an "all good" claim.
  expect(describePending(pending, null)).toEqual(pending);
  expect(describePending(pending, recorder.snapshot(0))).toEqual(pending);

  recorder.begin('permission', 0);
  expect(describePending(pending, recorder.snapshot(12_400))).toEqual([
    '경기장 자산',
    '카메라 연결(권한 확인 중 12초)',
    '내 얼굴 게시 확인',
  ]);
  recorder.fail('permission', 13_000, 'PERMISSION_DENIED');
  expect(describePending(pending, recorder.snapshot(14_000))[1]).toBe(
    '카메라 연결(권한 확인 실패 13초 · 카메라 권한이 거부됨)',
  );

  recorder.reset();
  recorder.begin('permission', 0);
  recorder.succeed('permission', 1_000);
  recorder.begin('device-open', 1_000);
  recorder.succeed('device-open', 2_000);
  recorder.begin('model-load', 2_000);
  // Past the 30 s budget a running model load is itself the cause.
  expect(describePending(pending, recorder.snapshot(33_000))).toEqual([
    '경기장 자산',
    '카메라 연결',
    '내 얼굴 게시 확인(인식 모델 준비 중 31초 · 예상보다 오래 걸림)',
  ]);
  recorder.succeed('model-load', 33_500);
  recorder.begin('first-publish', 33_500);
  recorder.succeed('first-publish', 34_000);
  // Every client stage finished: what remains is the server or connection, left unannotated.
  expect(describePending(pending, recorder.snapshot(40_000))).toEqual(pending);
});

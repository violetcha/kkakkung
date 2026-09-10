import { expect, it, vi } from 'vitest';
import { createFaceTextures } from './face-textures';
import type { FaceTrackEvent } from '../../input/InteractionRuntime';
const scope = { matchId: 'm', mediaInstanceId: 'media', receiverGeneration: 1 };
const event = (playerId: string, overrides: Partial<FaceTrackEvent> = {}): FaceTrackEvent => ({
  ...scope,
  playerId,
  publisherGeneration: 1,
  trackSid: `track-${playerId}`,
  element: {} as HTMLVideoElement,
  ...overrides,
});
it('creates one texture for five prefetched faces and releases it on visibility exit', () => {
  const factory = vi.fn(() => ({ dispose: vi.fn() }));
  const faces = createFaceTextures(factory);
  faces.setScope(scope);
  for (let i = 0; i < 5; i++) faces.receive(event(String(i)));
  expect(factory).not.toHaveBeenCalled();
  faces.visible(['2']);
  expect(faces.count).toBe(1);
  const texture = faces.get('2')!;
  faces.visible([]);
  expect(texture.dispose).toHaveBeenCalledTimes(1);
  faces.visible(['2']);
  expect(factory).toHaveBeenCalledTimes(2);
  faces.clear();
  expect(faces.count).toBe(0);
});
it('preserves new publications against stale removal and handles view-first delivery', () => {
  const faces = createFaceTextures(() => ({ dispose: vi.fn() }));
  faces.setScope(scope);
  faces.visible(['p']);
  const old = event('p');
  faces.receive(old);
  const texture = faces.get('p')!;
  faces.receive(event('p', { publisherGeneration: 2, trackSid: 'new' }));
  expect(texture.dispose).toHaveBeenCalledTimes(1);
  const latest = faces.get('p');
  faces.receive({ ...old, element: null });
  expect(faces.get('p')).toBe(latest);
  expect(faces.receive(event('p', { receiverGeneration: 0 }))).toBe(false);
  faces.setScope({ ...scope, receiverGeneration: 2 });
  expect(latest?.dispose).toHaveBeenCalledTimes(1);
  expect(faces.count).toBe(0);
});

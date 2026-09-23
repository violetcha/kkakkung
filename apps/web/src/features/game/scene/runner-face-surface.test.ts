import { expect, it, vi } from 'vitest';
import { Group, Texture } from 'three';
import { createFaceTextures } from './face-textures';
import {
  createRunnerFaceMaterial,
  findRunnerFaceSocket,
  selectRunnerFaceTexture,
  syncRunnerFaceMaterial,
} from './runner-face-surface';

it('selects a live face before a stand-in and falls back to no overlay', () => {
  const live = new Texture();
  const standIn = new Texture();
  const faces = { get: (id: string) => (id === 'live' ? live : null) };

  expect(selectRunnerFaceTexture('live', faces, standIn)).toBe(live);
  expect(selectRunnerFaceTexture('missing', faces, standIn)).toBe(standIn);
  expect(selectRunnerFaceTexture('missing', faces, null)).toBeNull();
});

it('finds FaceSocket for a runner but never exposes it for a tagger', () => {
  const scene = new Group();
  const socket = new Group();
  socket.name = 'FaceSocket';
  scene.add(socket);

  expect(findRunnerFaceSocket(scene, 'runner')).toBe(socket);
  expect(findRunnerFaceSocket(scene, 'tagger')).toBeNull();
  socket.removeFromParent();
  expect(findRunnerFaceSocket(scene, 'runner')).toBeNull();
});

it('keeps participant materials isolated and reports overlay visibility', () => {
  const first = createRunnerFaceMaterial();
  const second = createRunnerFaceMaterial();
  const texture = new Texture();

  expect(first).not.toBe(second);
  expect(syncRunnerFaceMaterial(first, texture)).toBe(true);
  expect(first.map).toBe(texture);
  expect(first.color.getHexString()).toBe('ffffff');
  expect(syncRunnerFaceMaterial(first, null)).toBe(false);
  expect(first.map).toBeNull();
});

it('uploads a live video face every frame even when the element never renders', () => {
  const material = createRunnerFaceMaterial();
  const video = new Texture() as Texture & { isVideoTexture: boolean };
  video.isVideoTexture = true;
  const still = new Texture();

  syncRunnerFaceMaterial(material, video);
  const first = video.version;
  syncRunnerFaceMaterial(material, video);
  expect(video.version).toBeGreaterThan(first);

  syncRunnerFaceMaterial(material, still);
  const settled = still.version;
  syncRunnerFaceMaterial(material, still);
  expect(still.version).toBe(settled);
});

it('disposes only the surface material when the live face leaves visibility', () => {
  const texture = { dispose: vi.fn() };
  const faces = createFaceTextures(() => texture);
  faces.setScope({ matchId: 'm', mediaInstanceId: 'media', receiverGeneration: 1 });
  faces.visible(['runner']);
  faces.receive({
    matchId: 'm',
    mediaInstanceId: 'media',
    receiverGeneration: 1,
    playerId: 'runner',
    publisherGeneration: 1,
    trackSid: 'track',
    element: {} as HTMLVideoElement,
  });
  const material = createRunnerFaceMaterial();
  let materialDisposals = 0;
  material.addEventListener('dispose', () => materialDisposals++);

  material.dispose();
  expect(materialDisposals).toBe(1);
  expect(texture.dispose).not.toHaveBeenCalled();
  faces.visible([]);
  expect(texture.dispose).toHaveBeenCalledTimes(1);
});

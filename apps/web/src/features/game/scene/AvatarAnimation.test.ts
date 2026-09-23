import { expect, it } from 'vitest';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { createAvatarInstance } from './avatar-instance';
import type { AvatarTemplate } from './avatar-loader';
import { applyAvatarAnimation, avatarAnimationSample } from './AvatarAnimation';

function instance() {
  const scene = new Group();
  const root = new Group();
  root.name = 'AvatarRoot';
  root.position.set(4, 0.2, -3);
  root.rotation.set(0, 1.1, 0);
  root.scale.set(1.2, 1.2, 1.2);
  scene.add(root);
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  mesh.material.name = 'BodyMaterial';
  root.add(mesh);
  const template: AvatarTemplate = {
    role: 'tagger',
    quality: 'low',
    version: 'v1',
    scene,
    animations: [new AnimationClip('idle', 1.2), new AnimationClip('walk', 0.8)],
    atlas: { color: new Texture() },
  };
  return createAvatarInstance(template);
}

it('maps one finite server move to one normalized walk cycle', () => {
  expect(avatarAnimationSample(0, 0.8)).toEqual({ clip: 'walk', time: 0 });
  expect(avatarAnimationSample(0.5, 0.8)).toEqual({ clip: 'walk', time: 0.4 });
  expect(avatarAnimationSample(1, 0.8)).toEqual({ clip: 'walk', time: 0.8 });
  expect(avatarAnimationSample(-1, 0.8)).toEqual({ clip: 'walk', time: 0 });
  expect(avatarAnimationSample(2, 0.8)).toEqual({ clip: 'walk', time: 0.8 });
});

it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
  'uses idle for non-moving stride %s',
  (stride) => expect(avatarAnimationSample(stride, 0.8)).toEqual({ clip: 'idle', time: 0 }),
);

it('samples walk time without changing the server-owned root transform', () => {
  const avatar = instance();
  const before = {
    position: avatar.root.position.toArray(),
    quaternion: avatar.root.quaternion.toArray(),
    scale: avatar.root.scale.toArray(),
  };

  applyAvatarAnimation(avatar, 0.5, 0.016);

  expect(avatar.actions.walk.time).toBeCloseTo(0.4);
  expect(avatar.actions.walk.paused).toBe(true);
  expect(avatar.root.position.toArray()).toEqual(before.position);
  expect(avatar.root.quaternion.toArray()).toEqual(before.quaternion);
  expect(avatar.root.scale.toArray()).toEqual(before.scale);
});

it('continues idle time across frames and switches back from walk once', () => {
  const avatar = instance();
  applyAvatarAnimation(avatar, 0.25, 0.016);
  applyAvatarAnimation(avatar, null, 0.1);
  const first = avatar.actions.idle.time;
  applyAvatarAnimation(avatar, null, 0.2);

  expect(first).toBeCloseTo(0.1);
  expect(avatar.actions.idle.time).toBeCloseTo(0.3);
  expect(avatar.actions.walk.enabled).toBe(false);
});

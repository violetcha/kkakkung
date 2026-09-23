import { expect, it } from 'vitest';
import {
  AnimationClip,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
  VectorKeyframeTrack,
} from 'three';
import {
  applyMeshyWalk,
  createMeshyAvatarInstance,
  lockHorizontalRootMotion,
  type MeshyAvatarTemplate,
} from './meshy-avatar-instance';

function template(): MeshyAvatarTemplate {
  const scene = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial());
  mesh.position.y = 1;
  scene.add(mesh);
  return {
    role: 'runner',
    scene,
    animations: [new AnimationClip('Standard Walk', 1.2)],
    textures: {
      color: new Texture(),
      normal: new Texture(),
      roughness: new Texture(),
      metallic: new Texture(),
    },
    targetHeight: 1.55,
  };
}

it('fits the cloned Meshy character to the game role height and floor', () => {
  const avatar = createMeshyAvatarInstance(template());
  const bounds = new Box3().setFromObject(avatar.scene);

  expect(bounds.min.y).toBeCloseTo(0);
  expect(bounds.max.y - bounds.min.y).toBeCloseTo(1.55);
  avatar.dispose();
});

it('turns the Meshy visual forward without changing the server-owned root direction', () => {
  const avatar = createMeshyAvatarInstance(template());
  const visual = avatar.root.children[0];

  expect(avatar.root.rotation.y).toBe(0);
  expect(visual?.rotation.y).toBeCloseTo(Math.PI);
  avatar.dispose();
});

it('samples the Mixamo walk without changing the server-owned transform', () => {
  const avatar = createMeshyAvatarInstance(template());
  avatar.root.position.set(4, 0, -3);
  avatar.root.rotation.set(0, 1.2, 0);

  applyMeshyWalk(avatar, 0.5);

  expect(avatar.action.time).toBeCloseTo(0.6);
  expect(avatar.action.paused).toBe(true);
  expect(avatar.root.position.toArray()).toEqual([4, 0, -3]);
  expect(avatar.root.rotation.y).toBeCloseTo(1.2);
  avatar.dispose();
});

it('holds the first walk frame as a stable idle pose', () => {
  const avatar = createMeshyAvatarInstance(template());
  applyMeshyWalk(avatar, 0.75);
  applyMeshyWalk(avatar, null);

  expect(avatar.action.time).toBe(0);
  expect(avatar.action.paused).toBe(true);
  avatar.dispose();
});

it('removes Mixamo horizontal root motion while preserving vertical bounce', () => {
  const source = new AnimationClip('Orc Walk', 1, [
    new VectorKeyframeTrack('mixamorigHips.position', [0, 0.5, 1], [1, 2, 3, 4, 5, 9, -2, 4, 12]),
  ]);

  const clip = lockHorizontalRootMotion(source);
  const values = Array.from(clip.tracks[0]?.values ?? []);

  expect(values).toEqual([1, 2, 3, 1, 5, 3, 1, 4, 3]);
  expect(Array.from(source.tracks[0]?.values ?? [])).toEqual([1, 2, 3, 4, 5, 9, -2, 4, 12]);
});

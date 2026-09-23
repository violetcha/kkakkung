import { expect, it, vi } from 'vitest';
import {
  AnimationClip,
  Bone,
  Box3,
  BoxGeometry,
  Group,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
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

it('releases shared template textures after the final avatar instance is disposed', () => {
  const shared = template();
  const releases = Object.values(shared.textures).map((texture) => vi.spyOn(texture, 'dispose'));
  const first = createMeshyAvatarInstance(shared);
  const second = createMeshyAvatarInstance(shared);

  first.dispose();
  expect(releases.map((release) => release.mock.calls.length)).toEqual([0, 0, 0, 0]);

  second.dispose();
  expect(releases.map((release) => release.mock.calls.length)).toEqual([1, 1, 1, 1]);

  const remounted = createMeshyAvatarInstance(shared);
  remounted.dispose();
  expect(releases.map((release) => release.mock.calls.length)).toEqual([2, 2, 2, 2]);
});

it('releases the cloned Mixamo skeleton GPU resources', () => {
  const shared = template();
  const bone = new Bone();
  const geometry = new BoxGeometry(1, 2, 1);
  const vertices = geometry.getAttribute('position').count;
  const weights = new Float32Array(vertices * 4);
  for (let index = 0; index < vertices; index += 1) weights[index * 4] = 1;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const skinned = new SkinnedMesh(geometry, new MeshStandardMaterial());
  skinned.add(bone);
  skinned.bind(new Skeleton([bone]));
  shared.scene.clear();
  shared.scene.add(skinned);
  const avatar = createMeshyAvatarInstance(shared);
  let cloned: SkinnedMesh | null = null;
  avatar.scene.traverse((object) => {
    if (object instanceof SkinnedMesh) cloned = object;
  });
  expect(cloned).not.toBeNull();
  const release = vi.spyOn(cloned!.skeleton, 'dispose');

  avatar.dispose();

  expect(release).toHaveBeenCalledOnce();
});

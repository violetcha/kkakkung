import { expect, it } from 'vitest';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { createAvatarInstance } from './avatar-instance';
import type { AvatarTemplate } from './avatar-loader';

function template(): AvatarTemplate {
  const scene = new Group();
  const root = new Group();
  root.name = 'AvatarRoot';
  scene.add(root);
  const rig = new Group();
  rig.name = 'Rig';
  root.add(rig);
  const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  body.material.name = 'BodyMaterial';
  rig.add(body);
  const socket = new Group();
  socket.name = 'FaceSocket';
  root.add(socket);
  return {
    role: 'runner',
    quality: 'medium',
    version: 'v1',
    scene,
    animations: [new AnimationClip('idle', 1), new AnimationClip('walk', 1)],
    atlas: { color: new Texture(), roughness: new Texture() },
  };
}

it('isolates scene, material, mixer and actions while sharing immutable resources', () => {
  const source = template();
  const first = createAvatarInstance(source);
  const second = createAvatarInstance(source);
  const sourceMesh = source.scene.getObjectByProperty('type', 'Mesh') as Mesh;
  const firstMesh = first.scene.getObjectByProperty('type', 'Mesh') as Mesh;
  const secondMesh = second.scene.getObjectByProperty('type', 'Mesh') as Mesh;

  expect(first.scene).not.toBe(second.scene);
  expect(firstMesh.geometry).toBe(sourceMesh.geometry);
  expect(firstMesh.material).not.toBe(secondMesh.material);
  expect(firstMesh.material).not.toBe(sourceMesh.material);
  expect((firstMesh.material as MeshStandardMaterial).map).toBe(source.atlas.color);
  expect((firstMesh.material as MeshStandardMaterial).roughnessMap).toBe(source.atlas.roughness);
  expect(first.mixer).not.toBe(second.mixer);
  expect(first.actions.idle).not.toBe(second.actions.idle);
  expect(first.actions.walk).not.toBe(second.actions.walk);
  expect(first.root.name).toBe('AvatarRoot');
  expect(first.faceSocket?.name).toBe('FaceSocket');
});

it('disposes clone-owned materials once without disposing shared geometry or atlases', () => {
  const source = template();
  const instance = createAvatarInstance(source);
  let materialDisposals = 0;
  let geometryDisposals = 0;
  let atlasDisposals = 0;
  instance.materials.forEach((material) =>
    material.addEventListener('dispose', () => materialDisposals++),
  );
  const geometry = (source.scene.getObjectByProperty('type', 'Mesh') as Mesh).geometry;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  source.atlas.color.addEventListener('dispose', () => atlasDisposals++);
  source.atlas.roughness?.addEventListener('dispose', () => atlasDisposals++);

  instance.dispose();
  instance.dispose();

  expect(materialDisposals).toBe(instance.materials.length);
  expect(geometryDisposals).toBe(0);
  expect(atlasDisposals).toBe(0);
});

import type { Role } from '@kkakkung/protocol/game-schema';
import { Color, MeshBasicMaterial, type Object3D, type Texture } from 'three';

export type FaceTextureLookup = Readonly<{
  get(playerId: string): Texture | null;
}>;

export function selectRunnerFaceTexture(
  playerId: string,
  faces?: FaceTextureLookup,
  standIn?: Texture | null,
) {
  return faces?.get(playerId) ?? standIn ?? null;
}

export function findRunnerFaceSocket(scene: Object3D, role: Role) {
  return role === 'runner' ? (scene.getObjectByName('FaceSocket') ?? null) : null;
}

export function createRunnerFaceMaterial() {
  return new MeshBasicMaterial({ color: '#7c8984', toneMapped: false });
}

export function syncRunnerFaceMaterial(material: MeshBasicMaterial, texture: Texture | null) {
  if (material.map !== texture) {
    material.map = texture;
    material.color.copy(texture ? new Color('#ffffff') : new Color('#7c8984'));
    material.needsUpdate = true;
  }
  return texture !== null;
}

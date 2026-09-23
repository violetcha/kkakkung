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
  // S15P21C204-358. 원격 얼굴은 화면에 붙지 않은 video 다. three 의 VideoTexture 는 그런 요소에서
  // 프레임 콜백을 받지 못해 첫 장(검정)에서 멈춘다. 그릴 때마다 직접 올려 준다.
  if (texture && (texture as { isVideoTexture?: boolean }).isVideoTexture)
    texture.needsUpdate = true;
  return texture !== null;
}

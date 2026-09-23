import type { Role } from '@kkakkung/protocol/game-schema';
import {
  AnimationMixer,
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
  type Texture,
} from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { fitAvatarBounds } from './meshy-avatar-preview';
import { meshyAvatarAsset, meshyWalkSample } from './meshy-role-avatar';

export type MeshyAvatarTemplate = Readonly<{
  role: Role;
  scene: Object3D;
  animations: readonly AnimationClip[];
  textures: Readonly<{
    color: Texture;
    normal: Texture;
    roughness: Texture;
    metallic: Texture;
  }>;
  targetHeight: number;
}>;

export type MeshyAvatarInstance = Readonly<{
  scene: Object3D;
  root: Group;
  mixer: AnimationMixer;
  action: AnimationAction;
  dispose(): void;
}>;

const templateCache = new Map<Role, Promise<MeshyAvatarTemplate>>();

export function loadMeshyAvatarTemplate(role: Role): Promise<MeshyAvatarTemplate> {
  const existing = templateCache.get(role);
  if (existing) return existing;
  const asset = meshyAvatarAsset(role);
  const promise = Promise.all([
    new FBXLoader().loadAsync(asset.model),
    new TextureLoader().loadAsync(asset.color),
    new TextureLoader().loadAsync(asset.normal),
    new TextureLoader().loadAsync(asset.roughness),
    new TextureLoader().loadAsync(asset.metallic),
  ])
    .then(([scene, color, normal, roughness, metallic]) => {
      if (!scene.animations[0]) throw new Error(`Missing ${role} Mixamo walk animation`);
      color.colorSpace = SRGBColorSpace;
      return {
        role,
        scene,
        animations: scene.animations,
        textures: { color, normal, roughness, metallic },
        targetHeight: asset.targetHeight,
      } satisfies MeshyAvatarTemplate;
    })
    .catch((error) => {
      templateCache.delete(role);
      throw error;
    });
  templateCache.set(role, promise);
  return promise;
}

export function prefetchMeshyAvatarAssets() {
  return Promise.allSettled([loadMeshyAvatarTemplate('runner'), loadMeshyAvatarTemplate('tagger')]);
}

export function lockHorizontalRootMotion(source: AnimationClip): AnimationClip {
  const clip = source.clone();
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position') || track.values.length < 3) continue;
    const firstX = track.values[0] ?? 0;
    const firstZ = track.values[2] ?? 0;
    for (let index = 0; index + 2 < track.values.length; index += 3) {
      track.values[index] = firstX;
      track.values[index + 2] = firstZ;
    }
  }
  return clip;
}

export function createMeshyAvatarInstance(template: MeshyAvatarTemplate): MeshyAvatarInstance {
  const object = cloneSkeleton(template.scene);
  const material = new MeshStandardMaterial({
    map: template.textures.color,
    normalMap: template.textures.normal,
    roughnessMap: template.textures.roughness,
    metalnessMap: template.textures.metallic,
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  });
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.material = material;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  // Mixamo-authored Meshy FBX files face the opposite local axis from the game world.
  // Keep the authoritative root yaw untouched and correct only the rendered character.
  object.rotation.y = Math.PI;
  const fit = fitAvatarBounds(new Box3().setFromObject(object), template.targetHeight);
  object.scale.setScalar(fit.scale);
  object.position.set(...fit.offset);

  const root = new Group();
  root.name = `MeshyAvatarRoot:${template.role}`;
  root.add(object);
  const sourceClip = template.animations[0];
  if (!sourceClip) {
    material.dispose();
    throw new Error('MESHY_AVATAR_WALK_CLIP_MISSING');
  }
  const clip = lockHorizontalRootMotion(sourceClip);
  const mixer = new AnimationMixer(object);
  const action = mixer.clipAction(clip);
  action.reset().play();
  action.paused = true;
  mixer.update(0);
  let disposed = false;
  return {
    scene: root,
    root,
    mixer,
    action,
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(object);
      material.dispose();
    },
  };
}

export function applyMeshyWalk(instance: MeshyAvatarInstance, stride: number | null) {
  const sample = meshyWalkSample(stride, instance.action.getClip().duration);
  instance.action.enabled = true;
  instance.action.paused = true;
  instance.action.time = sample.time;
  instance.mixer.update(0);
}

import {
  AnimationMixer,
  Mesh,
  MeshStandardMaterial,
  type AnimationAction,
  type Material,
  type Object3D,
} from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { AvatarTemplate } from './avatar-loader';

export type AvatarInstance = Readonly<{
  scene: Object3D;
  root: Object3D;
  faceSocket: Object3D | null;
  mixer: AnimationMixer;
  actions: Readonly<{ idle: AnimationAction; walk: AnimationAction }>;
  materials: readonly Material[];
  dispose(): void;
}>;

function cloneMaterial(material: Material, template: AvatarTemplate) {
  const cloned = material.clone();
  if (cloned.name === 'BodyMaterial' && cloned instanceof MeshStandardMaterial) {
    cloned.map = template.atlas.color;
    cloned.roughnessMap = template.atlas.roughness ?? null;
    // The authored atlas owns the final cloth colour; keeping the GLB tint would multiply dark
    // tagger texels twice and erase its silhouette under the facility lighting.
    cloned.color.set('#ffffff');
    cloned.needsUpdate = true;
  }
  return cloned;
}

export function createAvatarInstance(template: AvatarTemplate): AvatarInstance {
  const scene = cloneSkeleton(template.scene);
  const materials: Material[] = [];
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => {
        const cloned = cloneMaterial(material, template);
        materials.push(cloned);
        return cloned;
      });
    } else {
      const cloned = cloneMaterial(object.material, template);
      materials.push(cloned);
      object.material = cloned;
    }
  });
  const root = scene.getObjectByName('AvatarRoot');
  const idle = template.animations.find((clip) => clip.name === 'idle');
  const walk = template.animations.find((clip) => clip.name === 'walk');
  if (!root || !idle || !walk) {
    materials.forEach((material) => material.dispose());
    throw new Error('AVATAR_TEMPLATE_CONTRACT_INVALID');
  }
  const mixer = new AnimationMixer(scene);
  const actions = { idle: mixer.clipAction(idle), walk: mixer.clipAction(walk) };
  let disposed = false;
  return {
    scene,
    root,
    faceSocket: scene.getObjectByName('FaceSocket') ?? null,
    mixer,
    actions,
    materials,
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      materials.forEach((material) => material.dispose());
    },
  };
}

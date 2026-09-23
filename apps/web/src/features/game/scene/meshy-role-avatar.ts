import type { Role } from '@kkakkung/protocol/game-schema';

export type MeshyAvatarAsset = Readonly<{
  model: string;
  color: string;
  normal: string;
  roughness: string;
  metallic: string;
  targetHeight: number;
}>;

const STEMS = {
  runner: {
    directory: '/models/avatars/meshy-preview/runner',
    stem: 'Meshy_AI_The_Hollow_Pilgrim_0922031207_texture',
    model: 'runner_standard_walk_rigged.fbx',
    targetHeight: 1.55,
  },
  tagger: {
    directory: '/models/avatars/meshy-preview/tagger',
    stem: 'Meshy_AI_Ragtooth_Revenant_0922030916_texture',
    model: 'tagger_orc_walk_rigged.fbx',
    targetHeight: 1.6,
  },
} as const satisfies Record<Role, object>;

export function meshyAvatarAsset(role: Role): MeshyAvatarAsset {
  const selected = STEMS[role];
  return {
    model: `${selected.directory}/${selected.model}`,
    color: `${selected.directory}/${selected.stem}.png`,
    normal: `${selected.directory}/${selected.stem}_normal.png`,
    roughness: `${selected.directory}/${selected.stem}_roughness.png`,
    metallic: `${selected.directory}/${selected.stem}_metallic.png`,
    targetHeight: selected.targetHeight,
  };
}

export type MeshyWalkSample = Readonly<{ moving: boolean; time: number }>;

/** Samples the authored Mixamo walk from the authoritative server move progress. */
export function meshyWalkSample(stride: number | null, duration: number): MeshyWalkSample {
  if (stride === null || !Number.isFinite(stride)) return { moving: false, time: 0 };
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return {
    moving: true,
    time: Math.min(1, Math.max(0, stride)) * safeDuration,
  };
}

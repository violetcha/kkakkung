import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Texture,
} from 'three';
import type { PrivateView, Role, VisibleEntity } from '@kkakkung/protocol/game-schema';
import type { FaceTextures } from './face-textures';
import { CHARACTER } from './scene-model';
import { sampleActor } from './action-interpolation';
import { visibilityMask } from './visibility-mask';
import { walkPose } from './walk-pose';
import { ROLE_COLORS, ROLE_SILHOUETTE } from './role-colors';

/**
 * S15P21C204-268 (W1). Block proportions: cube head, box torso, box limbs. The real face plane
 * stays on the head's front, unlit so it reads in the dark. Limbs swing from pivot groups at the
 * shoulder and hip (S15P21C204-262). Roles differ in cloth colour and in shape: a tagger is
 * broad-shouldered with a visor brim, a runner narrower with a satchel. Unknown role (an entity
 * the server did not label) falls back to neutral grey and no shape cue.
 */
export const AVATAR = Object.freeze({
  headY: 0.72,
  torsoY: 0.33,
  torsoHeight: 0.3,
  torsoDepth: 0.18,
  shoulderY: 0.47,
  hipY: 0.235,
  armLength: 0.28,
  legLength: 0.235,
  limbWidth: 0.1,
  bootHeight: 0.06,
  brimY: 0.9,
});

type Player = Extract<VisibleEntity, { kind: 'player' }>;
type RoleKey = Role | 'neutral';
const NEUTRAL = Object.freeze({ cloth: '#5e5a52', accent: '#8a857b', boot: '#1f2223' });

/**
 * Every box part is the one unit cube scaled per mesh, so the GPU holds three avatar
 * geometries (cube, face plane, badge) no matter which roles appear. Role-specific parts
 * uploading lazily would make the resource count drift between scenes (facility-rendering e2e).
 */
export const AVATAR_PARTS = Object.freeze({
  head: [CHARACTER.head, CHARACTER.head, CHARACTER.head] as const,
  torso: (shoulder: number) => [shoulder, AVATAR.torsoHeight, AVATAR.torsoDepth] as const,
  arm: [AVATAR.limbWidth, AVATAR.armLength, AVATAR.limbWidth] as const,
  leg: [AVATAR.limbWidth, AVATAR.legLength - AVATAR.bootHeight, AVATAR.limbWidth] as const,
  boot: [AVATAR.limbWidth + 0.01, AVATAR.bootHeight, AVATAR.limbWidth + 0.04] as const,
  stripe: [0.2, 0.05, 0.012] as const,
  brim: [CHARACTER.head + 0.04, 0.05, 0.2] as const,
  satchel: [0.22, 0.16, 0.08] as const,
});

export function createAvatarResources() {
  const geometry = {
    cube: new BoxGeometry(1, 1, 1),
    face: new PlaneGeometry(0.418, 0.418),
    badge: new SphereGeometry(0.032, 8, 6),
  };
  const roleMaterials = (colors: { cloth: string; accent: string; boot: string }) => ({
    cloth: new MeshStandardMaterial({ color: colors.cloth, roughness: 1 }),
    accent: new MeshStandardMaterial({
      color: colors.accent,
      emissive: colors.accent,
      emissiveIntensity: 0.25,
      roughness: 0.9,
    }),
    boot: new MeshStandardMaterial({ color: colors.boot, roughness: 0.9 }),
  });
  const material = {
    head: new MeshStandardMaterial({ color: '#33302c', roughness: 0.9 }),
    ally: new MeshBasicMaterial({ color: '#a9e6d1', toneMapped: false }),
    role: {
      tagger: roleMaterials(ROLE_COLORS.tagger),
      runner: roleMaterials(ROLE_COLORS.runner),
      neutral: roleMaterials(NEUTRAL),
    } satisfies Record<RoleKey, unknown>,
  };
  const all = [
    ...Object.values(geometry),
    material.head,
    material.ally,
    ...Object.values(material.role).flatMap((set) => Object.values(set)),
  ];
  return {
    geometry,
    material,
    dispose() {
      all.forEach((resource) => resource.dispose());
    },
  };
}

export function Avatar({
  player,
  ally,
  faces,
  standIn,
  resources,
  renderTick,
}: {
  player: Player;
  ally: boolean;
  faces?: FaceTextures;
  /** Demo rooms only: the drawn face used for a participant that has no camera. */
  standIn?: Texture | null;
  resources: ReturnType<typeof createAvatarResources>;
  renderTick(): number | null;
}) {
  const root = useRef<Group>(null);
  const legs = [useRef<Group>(null), useRef<Group>(null)] as const;
  const arms = [useRef<Group>(null), useRef<Group>(null)] as const;
  const face = useMemo(() => new MeshBasicMaterial({ color: '#7c8984', toneMapped: false }), []);
  useEffect(() => () => face.dispose(), [face]);
  const initial = sampleActor(player, renderTick());
  useFrame(() => {
    const next = sampleActor(player, renderTick());
    // 걷기 모션은 같은 보간 진행도에서 파생한 장식이다. 위치·방향은 서버 행동만 따른다.
    const pose = walkPose(next.stride);
    root.current?.position.set(next.x, pose.bob, next.z);
    root.current?.rotation.set(0, next.yaw, 0);
    for (const index of [0, 1] as const) {
      legs[index].current?.rotation.set(pose.leg[index], 0, 0);
      arms[index].current?.rotation.set(pose.arm[index], 0, 0);
    }
    const texture = faces?.get(player.id) ?? standIn ?? null;
    if (face.map !== texture) {
      face.map = texture;
      face.color.set(texture ? '#ffffff' : '#7c8984');
      face.needsUpdate = true;
    }
  });
  const { geometry: g, material: m } = resources;
  const role: RoleKey = player.role ?? 'neutral';
  const colors = m.role[role];
  const shape = role === 'neutral' ? null : ROLE_SILHOUETTE[role];
  const shoulder = shape?.shoulder ?? 0.36;
  const box = (scale: readonly [number, number, number]) => [...scale] as [number, number, number];
  return (
    <group
      ref={root}
      dispose={null}
      position={[initial.x, 0, initial.z]}
      rotation={[0, initial.yaw, 0]}
    >
      <mesh
        geometry={g.cube}
        material={m.head}
        position={[0, AVATAR.headY, 0]}
        scale={box(AVATAR_PARTS.head)}
      />
      <mesh
        geometry={g.face}
        material={face}
        position={[0, AVATAR.headY, -0.241]}
        rotation={[0, Math.PI, 0]}
      />
      {shape?.brim && (
        <mesh
          geometry={g.cube}
          material={colors.cloth}
          position={[0, AVATAR.brimY, -0.12]}
          scale={box(AVATAR_PARTS.brim)}
        />
      )}
      <mesh
        geometry={g.cube}
        material={colors.cloth}
        position={[0, AVATAR.torsoY, 0]}
        scale={box(AVATAR_PARTS.torso(shoulder))}
      />
      <mesh
        geometry={g.cube}
        material={colors.accent}
        position={[0, AVATAR.torsoY + 0.08, -AVATAR.torsoDepth / 2 - 0.006]}
        scale={box(AVATAR_PARTS.stripe)}
      />
      {shape?.satchel && (
        <mesh
          geometry={g.cube}
          material={colors.accent}
          position={[0, AVATAR.torsoY - 0.02, AVATAR.torsoDepth / 2 + 0.04]}
          scale={box(AVATAR_PARTS.satchel)}
        />
      )}
      {([-1, 1] as const).map((side, index) => (
        <group key={side}>
          <group
            ref={arms[index]}
            position={[side * (shoulder / 2 + AVATAR.limbWidth / 2), AVATAR.shoulderY, 0]}
          >
            <mesh
              geometry={g.cube}
              material={colors.cloth}
              position={[0, -AVATAR.armLength / 2, 0]}
              scale={box(AVATAR_PARTS.arm)}
            />
          </group>
          <group ref={legs[index]} position={[side * 0.06, AVATAR.hipY, 0]}>
            <mesh
              geometry={g.cube}
              material={colors.boot}
              position={[0, -(AVATAR.legLength - AVATAR.bootHeight) / 2, 0]}
              scale={box(AVATAR_PARTS.leg)}
            />
            <mesh
              geometry={g.cube}
              material={colors.boot}
              position={[0, -AVATAR.legLength + AVATAR.bootHeight / 2, -0.02]}
              scale={box(AVATAR_PARTS.boot)}
            />
          </group>
        </group>
      ))}
      {ally && <mesh geometry={g.badge} material={m.ally} position={[0, 1.035, 0]} />}
    </group>
  );
}

/** Geometry/materials belong to the scene; face textures still belong to FaceTextures. */
export function FaceAvatars({
  view,
  faces,
  standIn,
  renderTick = () => null,
}: {
  view: PrivateView;
  faces?: FaceTextures;
  standIn?: Texture | null;
  renderTick?(): number | null;
}) {
  const resources = useMemo(createAvatarResources, []);
  useEffect(() => () => resources.dispose(), [resources]);
  return (
    <group dispose={null}>
      {visibilityMask(view).players.map((player) => (
        <Avatar
          key={player.id}
          player={player}
          ally={player.role !== undefined && player.role === view.self?.role}
          faces={faces}
          standIn={standIn}
          resources={resources}
          renderTick={renderTick}
        />
      ))}
    </group>
  );
}

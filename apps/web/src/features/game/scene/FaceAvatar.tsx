import { useEffect, useMemo, useRef, type RefObject } from 'react';
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
import { worldActor } from './action-interpolation';
import { visibilityMask } from './visibility-mask';
import { walkPose } from './walk-pose';
import { ROLE_COLORS, ROLE_SILHOUETTE } from './role-colors';
import { createTaggerGeometry, TAGGER_BODY } from './tagger-body';

/**
 * S15P21C204-268 (W1). Block proportions: cube head, box torso, box limbs. The real face plane
 * stays on the head's front, unlit so it reads in the dark. Limbs swing from pivot groups at the
 * shoulder and hip (S15P21C204-262). Roles differ in cloth colour and in shape: a tagger is the
 * hulking body below (TAGGER_BODY), a runner narrower with a satchel. Unknown role (an entity the
 * server did not label) falls back to neutral grey and no shape cue.
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
  satchel: [0.22, 0.16, 0.08] as const,
});

export function createAvatarResources() {
  const geometry = {
    cube: new BoxGeometry(1, 1, 1),
    face: new PlaneGeometry(0.418, 0.418),
    badge: new SphereGeometry(0.032, 8, 6),
    tagger: createTaggerGeometry(),
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
    /** S15P21C204-378. 술래의 붉은 몸, 검은 허리·눈썹뼈·손, 조명과 상관없이 빛나는 눈. */
    taggerHide: new MeshStandardMaterial({ color: '#8a2218', roughness: 1 }),
    taggerDark: new MeshStandardMaterial({ color: '#1a1010', roughness: 0.95 }),
    taggerEye: new MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false }),
    /** 그리지 않고 도형만 GPU 에 올리는 재질(TaggerPreload). */
    preload: new MeshBasicMaterial({ visible: false }),
  };
  const all = [
    geometry.cube,
    geometry.face,
    geometry.badge,
    ...Object.values(geometry.tagger),
    material.head,
    material.ally,
    material.taggerHide,
    material.taggerDark,
    material.taggerEye,
    material.preload,
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
  const initial = worldActor(player, renderTick());
  useFrame(() => {
    const next = worldActor(player, renderTick());
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
    // S15P21C204-295. 원격 얼굴은 화면에 붙지 않은 video 다. three 의 VideoTexture 는 그런
    // 요소에서 프레임 콜백을 받지 못해 첫 장(검정)에서 멈춘다. 그릴 때마다 직접 올려 준다.
    if (texture && (texture as { isVideoTexture?: boolean }).isVideoTexture)
      texture.needsUpdate = true;
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
      {role === 'tagger' ? (
        <TaggerParts resources={resources} arms={arms} legs={legs} />
      ) : (
        <>
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
        </>
      )}
      {ally && (
        <mesh
          geometry={g.badge}
          material={m.ally}
          position={[0, role === 'tagger' ? TAGGER_BODY.badgeY : 1.035, 0]}
        />
      )}
    </group>
  );
}

type LimbRefs = readonly [RefObject<Group | null>, RefObject<Group | null>];

/**
 * S15P21C204-378. 술래의 괴수 체형(TAGGER_BODY). 공용 머리·얼굴 판 둘레에 합친 도형 세 개(몸·검은
 * 부위·눈)를 두고, 팔·다리는 걷기 자세가 흔드는 같은 관절 ref 에 한쪽 몫 도형을 매단다.
 */
function TaggerParts({
  resources,
  arms,
  legs,
}: {
  resources: ReturnType<typeof createAvatarResources>;
  arms: LimbRefs;
  legs: LimbRefs;
}) {
  const { geometry: g, material: m } = resources;
  const { arm, leg } = TAGGER_BODY;
  return (
    <>
      <mesh geometry={g.tagger.bodyHide} material={m.taggerHide} />
      <mesh geometry={g.tagger.bodyDark} material={m.taggerDark} />
      <mesh geometry={g.tagger.bodyEye} material={m.taggerEye} />
      {([-1, 1] as const).map((side, index) => (
        <group
          key={`arm${side}`}
          ref={arms[index]}
          position={[side * arm.pivot[0], arm.pivot[1], arm.pivot[2]]}
        >
          <mesh geometry={g.tagger.armHide} material={m.taggerHide} />
          <mesh geometry={g.tagger.armDark} material={m.taggerDark} />
        </group>
      ))}
      {([-1, 1] as const).map((side, index) => (
        <group
          key={`leg${side}`}
          ref={legs[index]}
          position={[side * leg.pivot[0], leg.pivot[1], leg.pivot[2]]}
        >
          <mesh geometry={g.tagger.legHide} material={m.taggerHide} />
          <mesh geometry={g.tagger.legDark} material={m.taggerDark} />
        </group>
      ))}
    </>
  );
}

/**
 * S15P21C204-378. 술래의 합친 도형을 장면이 열릴 때 GPU 에 올려 둔다. 술래가 처음 보이는 순간에야
 * 올리면 장면마다 자원 수가 달라지고(facility-rendering e2e), 첫 등장 프레임이 잠깐 무거워진다.
 * 재질이 보이지 않아 그려지지는 않는다(도형 갱신은 재질 확인보다 먼저 일어난다).
 */
function TaggerPreload({ resources }: { resources: ReturnType<typeof createAvatarResources> }) {
  return (
    <group>
      {Object.entries(resources.geometry.tagger).map(([name, geometry]) => (
        <mesh
          key={name}
          geometry={geometry}
          material={resources.material.preload}
          frustumCulled={false}
        />
      ))}
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
      <TaggerPreload resources={resources} />
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

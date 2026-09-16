import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Texture,
} from 'three';
import type { PrivateView, VisibleEntity } from '@kkakkung/protocol/game-schema';
import type { FaceTextures } from './face-textures';
import { CHARACTER } from './scene-model';
import { sampleActor } from './action-interpolation';
import { visibilityMask } from './visibility-mask';
import { walkPose } from './walk-pose';

/** 팔·다리는 어깨·고관절에서 회전하도록 pivot 그룹 아래에 둔다(S15P21C204-262). */
const LIMB = Object.freeze({
  shoulderY: 0.43,
  hipY: 0.235,
  /** pivot 기준 원통 중심. 길이 0.24의 절반이다. */
  limbDrop: -0.12,
  bootDrop: -0.2025,
});

type Player = Extract<VisibleEntity, { kind: 'player' }>;
function createAvatarResources() {
  const geometry = {
    head: new BoxGeometry(CHARACTER.head, CHARACTER.head, CHARACTER.head),
    body: new BoxGeometry(0.28, 0.32, 0.2),
    limb: new CylinderGeometry(0.045, 0.035, 0.24, 6),
    boot: new BoxGeometry(0.1, 0.065, 0.15),
    face: new PlaneGeometry(0.418, 0.418),
    badge: new SphereGeometry(0.032, 8, 6),
    strap: new BoxGeometry(0.02, 0.3, 0.207),
  };
  const material = {
    head: new MeshStandardMaterial({ color: '#364243', roughness: 0.85, metalness: 0.15 }),
    cloth: new MeshStandardMaterial({ color: '#696455', roughness: 1 }),
    boot: new MeshStandardMaterial({ color: '#1a2425', roughness: 0.87 }),
    ally: new MeshBasicMaterial({ color: '#a9e6d1', toneMapped: false }),
  };
  return {
    geometry,
    material,
    dispose() {
      Object.values(geometry).forEach((resource) => resource.dispose());
      Object.values(material).forEach((resource) => resource.dispose());
    },
  };
}
function Avatar({
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
  return (
    <group
      ref={root}
      dispose={null}
      position={[initial.x, 0, initial.z]}
      rotation={[0, initial.yaw, 0]}
    >
      <mesh geometry={g.head} material={m.head} position={[0, 0.72, 0]} />
      <mesh
        geometry={g.face}
        material={face}
        position={[0, 0.72, -0.241]}
        rotation={[0, Math.PI, 0]}
      />
      <mesh geometry={g.body} material={m.cloth} position={[0, 0.32, 0.025]} />
      {([-1, 1] as const).map((side, index) => (
        <group key={side}>
          <group ref={arms[index]} position={[side * 0.195, LIMB.shoulderY, 0.025]}>
            <mesh
              geometry={g.limb}
              material={m.cloth}
              position={[0, LIMB.limbDrop, 0]}
              rotation={[0, 0, side * 0.15]}
            />
          </group>
          <group ref={legs[index]} position={[side * 0.075, LIMB.hipY, 0.015]}>
            <mesh geometry={g.limb} material={m.boot} position={[0, LIMB.limbDrop, 0]} />
            <mesh geometry={g.boot} material={m.boot} position={[0, LIMB.bootDrop, -0.03]} />
          </group>
          <mesh geometry={g.strap} material={m.boot} position={[side * 0.09, 0.32, 0.02]} />
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

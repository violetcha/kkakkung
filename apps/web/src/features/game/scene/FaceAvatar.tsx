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
} from 'three';
import type { PrivateView, VisibleEntity } from '@kkakkung/protocol/game-schema';
import type { FaceTextures } from './face-textures';
import { CHARACTER } from './scene-model';
import { sampleActor } from './action-interpolation';
import { visibilityMask } from './visibility-mask';

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
  resources,
  renderTick,
}: {
  player: Player;
  ally: boolean;
  faces?: FaceTextures;
  resources: ReturnType<typeof createAvatarResources>;
  renderTick(): number | null;
}) {
  const root = useRef<Group>(null);
  const face = useMemo(() => new MeshBasicMaterial({ color: '#7c8984', toneMapped: false }), []);
  useEffect(() => () => face.dispose(), [face]);
  const initial = sampleActor(player, renderTick());
  useFrame(() => {
    const next = sampleActor(player, renderTick());
    root.current?.position.set(next.x, 0, next.z);
    root.current?.rotation.set(0, next.yaw, 0);
    const texture = faces?.get(player.id) ?? null;
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
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh
            geometry={g.limb}
            material={m.cloth}
            position={[side * 0.195, 0.31, 0.025]}
            rotation={[0, 0, side * 0.15]}
          />
          <mesh geometry={g.limb} material={m.boot} position={[side * 0.075, 0.115, 0.015]} />
          <mesh geometry={g.boot} material={m.boot} position={[side * 0.075, 0.0325, -0.015]} />
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
  renderTick = () => null,
}: {
  view: PrivateView;
  faces?: FaceTextures;
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
          resources={resources}
          renderTick={renderTick}
        />
      ))}
    </group>
  );
}

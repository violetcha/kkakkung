import { useEffect, useMemo } from 'react';
import { BoxGeometry, MeshStandardMaterial } from 'three';
import type { Cell, Dir, WallFace } from '@kkakkung/protocol/game-schema';
import { CHARACTER, cellPosition, directionYaw, wallKey, wallModel } from './scene-model';
import { createFacilityResources, FACILITY } from './facility-theme';

/** The scene owns these shared resources; children never dispose them. */
export function ScenePrimitives({
  cells,
  walls,
  players,
}: {
  cells: readonly Cell[];
  walls: readonly WallFace[];
  players: readonly { id: string; cell: Cell; dir: Dir }[];
}) {
  const facility = useMemo(createFacilityResources, []);
  useEffect(() => () => facility.dispose(), [facility]);
  const resources = useMemo(
    () => ({
      head: new BoxGeometry(CHARACTER.head, CHARACTER.head, CHARACTER.head),
      body: new BoxGeometry(CHARACTER.body, CHARACTER.body, CHARACTER.body),
      white: new MeshStandardMaterial({ color: '#eeeeea', roughness: 1 }),
      black: new MeshStandardMaterial({ color: '#30302e', roughness: 1 }),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(resources).forEach((resource) => resource.dispose());
    },
    [resources],
  );
  return (
    <group dispose={null}>
      {cells.map((cell) => (
        <group key={`${cell.x}:${cell.y}`} position={cellPosition(cell)}>
          <mesh
            geometry={facility.geometry.floor}
            material={facility.material.floor}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          <mesh
            geometry={facility.geometry.floor}
            material={facility.material.ceiling}
            position={[0, FACILITY.ceilingHeight, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          />
          <mesh
            geometry={facility.geometry.lamp}
            material={facility.material.housing}
            position={[0, FACILITY.ceilingHeight - 0.02, 0]}
          />
          <mesh
            geometry={facility.geometry.tube}
            material={facility.material.tube}
            position={[0, FACILITY.ceilingHeight - 0.043, 0]}
          />
        </group>
      ))}
      {walls.map((wall) => (
        <group key={wallKey(wall)} {...wallModel(wall)}>
          <mesh geometry={facility.geometry.wall} material={facility.material.wall} />
          <mesh
            geometry={facility.geometry.panel}
            material={facility.material.panel}
            position={[0, -0.4, 0.001]}
          />
          <mesh
            geometry={facility.geometry.rail}
            material={facility.material.trim}
            position={[0, -0.21, 0.01]}
          />
          <mesh
            geometry={facility.geometry.rail}
            material={facility.material.housing}
            position={[0, -0.58, 0.009]}
          />
          <mesh
            geometry={facility.geometry.joint}
            material={facility.material.trim}
            position={[-0.493, 0, 0.004]}
          />
        </group>
      ))}
      {players.map((player) => (
        <group
          key={player.id}
          position={cellPosition(player.cell)}
          rotation={[0, directionYaw(player.dir), 0]}
        >
          <mesh geometry={resources.head} material={resources.white} position={[0, 0.72, 0]} />
          <mesh geometry={resources.body} material={resources.black} position={[0, 0.35, 0]} />
        </group>
      ))}
    </group>
  );
}

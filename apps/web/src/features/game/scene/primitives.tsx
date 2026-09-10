import { useEffect, useMemo } from 'react';
import { BoxGeometry, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { Cell, Dir, WallFace } from '@kkakkung/protocol/game-schema';
import { CHARACTER, cellPosition, directionYaw, wallKey, wallModel } from './scene-model';

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
  const resources = useMemo(
    () => ({
      floor: new PlaneGeometry(1, 1),
      wall: new PlaneGeometry(1, 1.2),
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
        <mesh
          key={`${cell.x}:${cell.y}`}
          geometry={resources.floor}
          material={resources.white}
          position={cellPosition(cell)}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ))}
      {walls.map((wall) => (
        <mesh
          key={wallKey(wall)}
          geometry={resources.wall}
          material={resources.white}
          {...wallModel(wall)}
        />
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

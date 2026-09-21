import { useEffect, useMemo, useState } from 'react';
import { BoxGeometry, MeshStandardMaterial, TextureLoader, type Texture } from 'three';
import type { Cell, Dir, WallFace } from '@kkakkung/protocol/game-schema';
import { CHARACTER, cellPosition, directionYaw, wallKey, wallModel } from './scene-model';
import { createFacilityResources, FACILITY, type BackroomsTextureSet } from './facility-theme';
import { BLOCK, createBlockResources, isMossyFace } from './block-theme';
import { DEFAULT_SCENE_THEME, type SceneThemeId } from './scene-theme';
import type { QualityPreset } from './quality-presets';
import { backroomsTexturePaths, configureBackroomsTexture } from './backrooms-textures';

/** The scene owns these shared resources; children never dispose them. */
export function ScenePrimitives({
  cells,
  walls,
  players,
  theme = DEFAULT_SCENE_THEME,
  quality = 'medium',
  fixtures = true,
}: {
  cells: readonly Cell[];
  walls: readonly WallFace[];
  players: readonly { id: string; cell: Cell; dir: Dir }[];
  theme?: SceneThemeId;
  quality?: QualityPreset;
  fixtures?: boolean;
}) {
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
      {theme === 'block' ? (
        <BlockTerrain cells={cells} walls={walls} />
      ) : (
        <FacilityTerrain cells={cells} walls={walls} quality={quality} fixtures={fixtures} />
      )}
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

/**
 * S15P21C204-268. Block terrain: one pixel-tiled plane per floor, ceiling and wall face, no
 * trims or lamps. The forms are the grid cells themselves; the lantern does the rest.
 */
function BlockTerrain({ cells, walls }: { cells: readonly Cell[]; walls: readonly WallFace[] }) {
  const block = useMemo(createBlockResources, []);
  useEffect(() => () => block.dispose(), [block]);
  return (
    <>
      {cells.map((cell) => (
        <group key={`${cell.x}:${cell.y}`} position={cellPosition(cell)}>
          <mesh
            geometry={block.geometry.floor}
            material={block.material.floor}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          <mesh
            geometry={block.geometry.floor}
            material={block.material.ceiling}
            position={[0, BLOCK.ceilingHeight, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          />
        </group>
      ))}
      {walls.map((wall) => (
        <mesh
          key={wallKey(wall)}
          geometry={block.geometry.wall}
          material={isMossyFace(wall) ? block.material.mossWall : block.material.wall}
          {...wallModel(wall)}
        />
      ))}
    </>
  );
}

function useBackroomsTextures(quality: QualityPreset): BackroomsTextureSet | undefined {
  const [textures, setTextures] = useState<BackroomsTextureSet>();
  useEffect(() => {
    let active = true;
    const owned = new Set<Texture>();
    const loader = new TextureLoader();
    const paths = backroomsTexturePaths(quality);
    setTextures(undefined);
    const load = (path: string | null, kind: 'color' | 'data') =>
      path === null
        ? Promise.resolve(null)
        : new Promise<Texture | null>((resolve) => {
            try {
              loader.load(
                path,
                (texture) => {
                  if (!active) {
                    texture.dispose();
                    resolve(null);
                    return;
                  }
                  owned.add(texture);
                  resolve(configureBackroomsTexture(texture, kind));
                },
                undefined,
                () => resolve(null),
              );
            } catch {
              resolve(null);
            }
          });
    void Promise.all([
      load(paths.color, 'color'),
      load(paths.roughness, 'data'),
      load(paths.normal, 'data'),
    ]).then(([color, roughness, normal]) => {
      if (!active || !color) return;
      setTextures({
        color,
        ...(roughness ? { roughness } : {}),
        ...(normal ? { normal } : {}),
      });
    });
    return () => {
      active = false;
      owned.forEach((texture) => texture.dispose());
    };
  }, [quality]);
  return textures;
}

function FacilityTerrain({
  cells,
  walls,
  quality,
  fixtures,
}: {
  cells: readonly Cell[];
  walls: readonly WallFace[];
  quality: QualityPreset;
  fixtures: boolean;
}) {
  const textures = useBackroomsTextures(quality);
  const facility = useMemo(() => createFacilityResources(textures, quality), [quality, textures]);
  useEffect(() => () => facility.dispose(), [facility]);
  return (
    <>
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
          {fixtures && (
            <>
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
            </>
          )}
        </group>
      ))}
      {walls.map((wall) => (
        <group key={wallKey(wall)} {...wallModel(wall)}>
          <mesh
            geometry={facility.geometry.wall}
            material={facility.material.wall}
            position={[0, FACILITY.wallLift, 0]}
          />
          {facility.geometry.panel && (
            <mesh
              geometry={facility.geometry.panel}
              material={facility.material.panel}
              position={[0, -0.52, 0.001]}
            />
          )}
          {facility.geometry.rail && (
            <mesh
              geometry={facility.geometry.rail}
              material={facility.material.trim}
              position={[0, -0.51, 0.01]}
            />
          )}
          {facility.geometry.joint && (
            <mesh
              geometry={facility.geometry.joint}
              material={facility.material.trim}
              position={[-0.493, FACILITY.wallLift, 0.004]}
            />
          )}
        </group>
      ))}
    </>
  );
}

import { Canvas } from '@react-three/fiber';
import { useAppStore } from '../../room/store';
import type { ComponentProps } from 'react';
import { ScenePrimitives } from './primitives';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { FirstPersonCamera } from './FirstPersonCamera';
import { VisibleTerrain } from './VisibleTerrain';
import { QUALITY_PRESETS, type QualityPreset } from './quality-presets';
import type { OwnerNames } from './ExitOwnerLabel';
import type { Texture } from 'three';
import type { FaceTextures } from './face-textures';
import { FacilityLighting } from './FacilityLighting';
import { BlockLighting } from './BlockLighting';
import { FACILITY } from './facility-theme';
import { BLOCK } from './block-theme';
import { FrameMetricsProbe, type FrameMetrics } from './FrameMetrics';
import { resolveSceneTheme, type SceneThemeId } from './scene-theme';
import { HeldTool } from './HeldTool';
import { defaultHeldTool, type HeldToolKind } from './held-tool';

/** Background and fog per theme. The fog never reaches past the server's 3.5-cell sight. */
export const sceneWorld = (theme: SceneThemeId) =>
  theme === 'block'
    ? { background: BLOCK.background, fogNear: BLOCK.fogNear, fogFar: BLOCK.fogFar }
    : { background: FACILITY.background, fogNear: FACILITY.fogNear, fogFar: FACILITY.fogFar };

export function WorldCanvas({
  scene,
  view,
  ownerNames,
  faces,
  standIn,
  quality = 'medium',
  theme = resolveSceneTheme(),
  heldTool,
  renderTick = () => null,
  onMetrics,
}: {
  scene?: ComponentProps<typeof ScenePrimitives>;
  view?: PrivateView;
  ownerNames?: OwnerNames;
  faces?: FaceTextures;
  /** Demo rooms only: drawn face for participants without a camera. */
  standIn?: Texture | null;
  quality?: QualityPreset;
  /** S15P21C204-268. Rendering look; resolved from the URL or the saved choice when omitted. */
  theme?: SceneThemeId;
  /** What the first-person hand holds. Omitted: derived from the player's role and stock. */
  heldTool?: HeldToolKind | null;
  renderTick?(): number | null;
  onMetrics?(metrics: FrameMetrics): void;
} = {}) {
  const players = useAppStore((state) => state.players);
  const sessionId = useAppStore((state) => state.sessionId);
  if (view) {
    const world = sceneWorld(theme);
    const self = view.self?.status === 'ACTIVE' ? view.self : null;
    const viewpoint = self ?? view.spectating ?? null;
    const tool = self
      ? heldTool === undefined
        ? defaultHeldTool(self)
        : heldTool
      : view.spectating
        ? 'map'
        : null;
    return (
      <Canvas
        dpr={QUALITY_PRESETS[quality].dpr}
        gl={{ antialias: false }}
        camera={{ position: [0, 0.8, 0], near: 0.03, far: 3.5 }}
        aria-label="까꿍 미로"
        data-theme={theme}
      >
        <color attach="background" args={[world.background]} />
        <fog attach="fog" args={[world.background, world.fogNear, world.fogFar]} />
        {viewpoint && (
          <>
            <FirstPersonCamera self={viewpoint} renderTick={renderTick} />
            {theme === 'block' ? (
              <BlockLighting self={viewpoint} renderTick={renderTick} />
            ) : (
              <FacilityLighting self={viewpoint} renderTick={renderTick} quality={quality} />
            )}
            {theme === 'block' && <HeldTool tool={tool} />}
          </>
        )}
        <VisibleTerrain
          view={view}
          ownerNames={ownerNames}
          faces={faces}
          standIn={standIn}
          renderTick={renderTick}
          theme={theme}
        />
        {onMetrics && <FrameMetricsProbe report={onMetrics} />}
      </Canvas>
    );
  }
  if (scene)
    return (
      <Canvas camera={{ position: [0, 0.8, 2], fov: 60 }} aria-label="까꿍 미로">
        <color attach="background" args={['#141413']} />
        <ambientLight intensity={1.5} />
        <ScenePrimitives {...scene} />
      </Canvas>
    );
  return (
    <Canvas camera={{ position: [0, 36, 30], fov: 48 }} aria-label="연동 시험장 3D 화면">
      <color attach="background" args={['#07131f']} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[4, 8, 3]} intensity={2.5} />
      <gridHelper args={[32, 32, '#3e84a8', '#18384b']} />
      {players.map((player) => (
        <mesh key={player.playerId} position={[player.x, 0.5, player.z]}>
          <boxGeometry args={[0.75, 1, 0.75]} />
          <meshStandardMaterial color={player.playerId === sessionId ? '#5eead4' : '#f8bd6b'} />
        </mesh>
      ))}
    </Canvas>
  );
}

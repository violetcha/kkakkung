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
import { FACILITY } from './facility-theme';
import { FrameMetricsProbe, type FrameMetrics } from './FrameMetrics';

export function WorldCanvas({
  scene,
  view,
  ownerNames,
  faces,
  standIn,
  quality = 'medium',
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
  renderTick?(): number | null;
  onMetrics?(metrics: FrameMetrics): void;
} = {}) {
  const players = useAppStore((state) => state.players);
  const sessionId = useAppStore((state) => state.sessionId);
  if (view)
    return (
      <Canvas
        dpr={QUALITY_PRESETS[quality].dpr}
        gl={{ antialias: false }}
        camera={{ position: [0, 0.8, 0], near: 0.03, far: 3.5 }}
        aria-label="까꿍 미로"
      >
        <color attach="background" args={[FACILITY.background]} />
        <fog attach="fog" args={[FACILITY.background, FACILITY.fogNear, FACILITY.fogFar]} />
        {view.self?.status === 'ACTIVE' && (
          <>
            <FirstPersonCamera self={view.self} renderTick={renderTick} />
            <FacilityLighting self={view.self} renderTick={renderTick} quality={quality} />
          </>
        )}
        <VisibleTerrain
          view={view}
          ownerNames={ownerNames}
          faces={faces}
          standIn={standIn}
          renderTick={renderTick}
        />
        {onMetrics && <FrameMetricsProbe report={onMetrics} />}
      </Canvas>
    );
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

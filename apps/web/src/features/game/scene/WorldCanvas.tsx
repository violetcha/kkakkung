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
import { GrabHand } from './GrabHand';
import type { TurnLead } from './turn-lead';
import type { MoveLead } from './move-lead';
import { CELL } from './scene-model';

/**
 * Background and fog per theme. The fog closes inside the server's 3.5-cell sight and the camera
 * draws a little past it, so nothing is clipped while still visible through the fog (377).
 */
/** 1인칭 카메라가 그리는 끝. 서버 시야보다 길고, 두 테마의 안개가 완전히 닫힌 뒤다. */
export const CAMERA_FAR = 3.6 * CELL;

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
  grabAnimationId,
  renderTick = () => null,
  turnLead,
  moveLead,
  paused = false,
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
  /** 바뀔 때마다 술래의 1인칭 잡기 손 동작을 시작하거나 유지한다. */
  grabAnimationId?: number;
  renderTick?(): number | null;
  /** S15P21C204-388. 내가 보낸 회전을 카메라가 먼저 따라간다(관전 중에는 쓰지 않는다). */
  turnLead?(): TurnLead | null;
  /** S15P21C204-389. 내가 보낸 한 칸 이동을 카메라가 먼저 따라간다. */
  moveLead?(): MoveLead | null;
  /**
   * S15P21C204-295. 멈춘 동안(설정 창) 장면을 그대로 세운다. 마지막 화면은 남으므로 뒤에
   * 복도가 비치는 것은 그대로이고, 느린 기기에서 창 조작이 밀리지 않는다.
   */
  paused?: boolean;
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
        frameloop={paused ? 'never' : 'always'}
        dpr={QUALITY_PRESETS[quality].dpr}
        gl={{ antialias: false }}
        camera={{ position: [0, 0.8, 0], near: 0.03, far: CAMERA_FAR }}
        aria-label="까꿍 미로"
        data-theme={theme}
      >
        <color attach="background" args={[world.background]} />
        <fog attach="fog" args={[world.background, world.fogNear, world.fogFar]} />
        {viewpoint && (
          <>
            <FirstPersonCamera
              self={viewpoint}
              renderTick={renderTick}
              {...(self && turnLead ? { turnLead } : {})}
              {...(self && moveLead ? { moveLead } : {})}
            />
            {theme === 'block' ? (
              <BlockLighting self={viewpoint} renderTick={renderTick} />
            ) : (
              <FacilityLighting self={viewpoint} renderTick={renderTick} quality={quality} />
            )}
            {theme === 'block' && <HeldTool tool={tool} />}
            {self?.role === 'tagger' && <GrabHand signal={grabAnimationId} />}
          </>
        )}
        <VisibleTerrain
          view={view}
          ownerNames={ownerNames}
          faces={faces}
          standIn={standIn}
          renderTick={renderTick}
          theme={theme}
          quality={quality}
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

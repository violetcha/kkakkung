import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, type Texture } from 'three';
import type { VisibleEntity } from '@kkakkung/protocol/game-schema';
import type { FaceTextures } from './face-textures';
import type { QualityPreset } from './quality-presets';
import { sampleActor } from './action-interpolation';
import { loadRoleAvatar } from './avatar-loader';
import { createAvatarInstance, type AvatarInstance } from './avatar-instance';
import { applyAvatarAnimation } from './AvatarAnimation';
import { RunnerFaceSurface } from './RunnerFaceSurface';
import { roleAssetRequest } from './role-avatar-state';
import { NeutralAvatar, type NeutralAvatarResources } from './NeutralAvatar';

type Player = Extract<VisibleEntity, { kind: 'player' }>;
export type AvatarRenderState = 'loading' | 'ready' | 'fallback' | 'removed';
export type AvatarStateReporter = (playerId: string, state: AvatarRenderState) => void;

export function RoleAvatar({
  player,
  ally,
  quality,
  faces,
  standIn,
  resources,
  renderTick,
  onState,
}: {
  player: Player;
  ally: boolean;
  quality: QualityPreset;
  faces?: FaceTextures;
  standIn?: Texture | null;
  resources: NeutralAvatarResources;
  renderTick(): number | null;
  onState?: AvatarStateReporter;
}) {
  const initial = sampleActor(player, renderTick());
  const overlayRoot = useRef<Group>(null);
  const instanceRef = useRef<AvatarInstance | null>(null);
  const reporter = useRef(onState);
  reporter.current = onState;
  const [instance, setInstance] = useState<AvatarInstance | null>(null);
  const playerId = player.id;
  const requestedRole = roleAssetRequest(player);
  const renderState = useRef<AvatarRenderState>(requestedRole ? 'loading' : 'fallback');

  useEffect(() => {
    let active = true;
    let owned: AvatarInstance | null = null;
    const reportState = (state: AvatarRenderState) => {
      renderState.current = state;
      reporter.current?.(playerId, state);
    };
    instanceRef.current = null;
    setInstance(null);
    if (!requestedRole) {
      reportState('fallback');
      return () => reporter.current?.(playerId, 'removed');
    }
    reportState('loading');
    void loadRoleAvatar(requestedRole, quality).then((result) => {
      if (!active) return;
      if (result.status === 'fallback') {
        reportState('fallback');
        return;
      }
      try {
        owned = createAvatarInstance(result.template);
        instanceRef.current = owned;
        setInstance(owned);
        reportState('ready');
      } catch {
        reportState('fallback');
      }
    });
    return () => {
      active = false;
      owned?.dispose();
      if (instanceRef.current === owned) instanceRef.current = null;
      reporter.current?.(playerId, 'removed');
    };
  }, [playerId, quality, requestedRole]);

  // Preview inspection callbacks may change while React preserves the same ready avatar instance.
  // Re-announce the current state without reloading the model so a new scene aggregate is accurate.
  useEffect(() => {
    onState?.(playerId, renderState.current);
  }, [onState, playerId]);

  useFrame((_state, delta) => {
    const next = sampleActor(player, renderTick());
    overlayRoot.current?.position.set(next.x, 0, next.z);
    overlayRoot.current?.rotation.set(0, next.yaw, 0);
    const current = instanceRef.current;
    if (!current) return;
    current.root.position.set(next.x, 0, next.z);
    current.root.rotation.set(0, next.yaw, 0);
    applyAvatarAnimation(current, next.stride, delta);
  });

  const badgeY = player.role === 'tagger' ? 1.82 : 1.34;
  return (
    <group dispose={null}>
      {instance && <primitive object={instance.scene} dispose={null} />}
      <group ref={overlayRoot} position={[initial.x, 0, initial.z]} rotation={[0, initial.yaw, 0]}>
        {!instance && <NeutralAvatar resources={resources} />}
        {ally && (
          <mesh
            geometry={resources.geometry.badge}
            material={resources.material.ally}
            position={[0, badgeY, 0]}
          />
        )}
      </group>
      {player.role === 'runner' && instance?.faceSocket && (
        <RunnerFaceSurface
          socket={instance.faceSocket}
          playerId={player.id}
          faces={faces}
          standIn={standIn}
        />
      )}
    </group>
  );
}

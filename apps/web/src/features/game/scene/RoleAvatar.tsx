import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, type Texture } from 'three';
import type { VisibleEntity } from '@kkakkung/protocol/game-schema';
import type { Role } from '@kkakkung/protocol/game-schema';
import type { FaceTextures } from './face-textures';
import type { QualityPreset } from './quality-presets';
import { sampleActor } from './action-interpolation';
import { loadRoleAvatar } from './avatar-loader';
import { createAvatarInstance, type AvatarInstance } from './avatar-instance';
import { applyAvatarAnimation } from './AvatarAnimation';
import { RunnerFaceSurface } from './RunnerFaceSurface';
import { roleAssetRequest } from './role-avatar-state';
import { NeutralAvatar, type NeutralAvatarResources } from './NeutralAvatar';
import {
  applyMeshyWalk,
  createMeshyAvatarInstance,
  loadMeshyAvatarTemplate,
  type MeshyAvatarInstance,
} from './meshy-avatar-instance';

type Player = Extract<VisibleEntity, { kind: 'player' }>;
export type AvatarRenderState = 'loading' | 'ready' | 'fallback' | 'removed';
export type AvatarStateReporter = (playerId: string, state: AvatarRenderState) => void;

type RoleAvatarInstance =
  | Readonly<{ kind: 'meshy'; avatar: MeshyAvatarInstance }>
  | Readonly<{ kind: 'contract'; avatar: AvatarInstance }>;

export function RoleAvatar({
  player,
  ally,
  observerRole,
  quality,
  faces,
  standIn,
  resources,
  renderTick,
  onState,
}: {
  player: Player;
  ally: boolean;
  observerRole: Role | null;
  quality: QualityPreset;
  faces?: FaceTextures;
  standIn?: Texture | null;
  resources: NeutralAvatarResources;
  renderTick(): number | null;
  onState?: AvatarStateReporter;
}) {
  const initial = sampleActor(player, renderTick());
  const overlayRoot = useRef<Group>(null);
  const instanceRef = useRef<RoleAvatarInstance | null>(null);
  const reporter = useRef(onState);
  reporter.current = onState;
  const [instance, setInstance] = useState<RoleAvatarInstance | null>(null);
  const playerId = player.id;
  const requestedRole = roleAssetRequest(player, observerRole);
  const renderState = useRef<AvatarRenderState>(requestedRole ? 'loading' : 'fallback');

  useEffect(() => {
    let active = true;
    let owned: RoleAvatarInstance | null = null;
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
    void (async () => {
      try {
        const template = await loadMeshyAvatarTemplate(requestedRole);
        if (!active) return;
        owned = { kind: 'meshy', avatar: createMeshyAvatarInstance(template) };
        instanceRef.current = owned;
        setInstance(owned);
        reportState('ready');
      } catch {
        const result = await loadRoleAvatar(requestedRole, quality);
        if (!active) return;
        if (result.status === 'fallback') {
          reportState('fallback');
          return;
        }
        try {
          owned = { kind: 'contract', avatar: createAvatarInstance(result.template) };
          instanceRef.current = owned;
          setInstance(owned);
          reportState('ready');
        } catch {
          reportState('fallback');
        }
      }
    })();
    return () => {
      active = false;
      owned?.avatar.dispose();
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
    current.avatar.root.position.set(next.x, 0, next.z);
    current.avatar.root.rotation.set(0, next.yaw, 0);
    if (current.kind === 'meshy') applyMeshyWalk(current.avatar, next.stride);
    else applyAvatarAnimation(current.avatar, next.stride, delta);
  });

  const badgeY = player.role === 'tagger' ? 2.32 : 1.72;
  return (
    <group dispose={null}>
      {instance && <primitive object={instance.avatar.scene} dispose={null} />}
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
      {player.role === 'runner' && instance?.kind === 'contract' && instance.avatar.faceSocket && (
        <RunnerFaceSurface
          socket={instance.avatar.faceSocket}
          playerId={player.id}
          faces={faces}
          standIn={standIn}
        />
      )}
    </group>
  );
}

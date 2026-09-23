import { useEffect, useMemo } from 'react';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { Texture } from 'three';
import type { FaceTextures } from './face-textures';
import type { QualityPreset } from './quality-presets';
import { prefetchAvatarAssets } from './avatar-loader';
import { visibilityMask } from './visibility-mask';
import { createNeutralAvatarResources } from './NeutralAvatar';
import { RoleAvatar, type AvatarStateReporter } from './RoleAvatar';
import { prefetchMeshyAvatarAssets } from './meshy-avatar-instance';

export function FaceAvatars({
  view,
  faces,
  standIn,
  quality,
  renderTick = () => null,
  onAvatarState,
}: {
  view: PrivateView;
  faces?: FaceTextures;
  standIn?: Texture | null;
  quality: QualityPreset;
  renderTick?(): number | null;
  onAvatarState?: AvatarStateReporter;
}) {
  const resources = useMemo(createNeutralAvatarResources, []);
  useEffect(() => () => resources.dispose(), [resources]);
  useEffect(() => {
    void Promise.allSettled([prefetchMeshyAvatarAssets(), prefetchAvatarAssets(quality)]);
  }, [quality]);
  const observerRole = view.self?.role ?? null;
  return (
    <group dispose={null}>
      {visibilityMask(view).players.map((player) => (
        <RoleAvatar
          key={player.id}
          player={player}
          ally={player.role !== undefined && player.role === view.self?.role}
          observerRole={observerRole}
          quality={quality}
          faces={faces}
          standIn={standIn}
          resources={resources}
          renderTick={renderTick}
          onState={onAvatarState}
        />
      ))}
    </group>
  );
}

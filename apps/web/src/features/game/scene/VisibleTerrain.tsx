import { useMemo } from 'react';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { visibilityMask } from './visibility-mask';
import { ScenePrimitives } from './primitives';
import { VisibleExits } from './VisibleExits';
import { EquipmentObjects } from './EquipmentObjects';
import { FaceAvatars } from './FaceAvatar';
import type { Texture } from 'three';
import type { FaceTextures } from './face-textures';
import type { OwnerNames } from './ExitOwnerLabel';
import type { SceneThemeId } from './scene-theme';
import type { QualityPreset } from './quality-presets';
export function VisibleTerrain({
  view,
  ownerNames,
  faces,
  standIn,
  renderTick,
  theme,
  quality = 'medium',
}: {
  view: PrivateView;
  ownerNames?: OwnerNames;
  faces?: FaceTextures;
  /** Demo rooms only: drawn face for participants without a camera. */
  standIn?: Texture | null;
  renderTick?(): number | null;
  theme?: SceneThemeId;
  quality?: QualityPreset;
}) {
  // S15P21C204-327. 이 화면은 서버 패치마다, 즉 초당 20번 다시 렌더된다. 마스크를 그때마다 새
  // 객체로 만들면 시야가 하나도 안 바뀐 판에서도 R3F 가 지형 메시를 통째로 재조정한다.
  const mask = useMemo(() => visibilityMask(view), [view]);
  return (
    <>
      <ScenePrimitives {...mask} players={[]} theme={theme} quality={quality} />
      <VisibleExits view={view} ownerNames={ownerNames} />
      <EquipmentObjects view={view} />
      <FaceAvatars view={view} faces={faces} standIn={standIn} renderTick={renderTick} />
    </>
  );
}

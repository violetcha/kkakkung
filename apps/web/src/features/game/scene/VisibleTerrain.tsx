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
export function VisibleTerrain({
  view,
  ownerNames,
  faces,
  standIn,
  renderTick,
  theme,
}: {
  view: PrivateView;
  ownerNames?: OwnerNames;
  faces?: FaceTextures;
  /** Demo rooms only: drawn face for participants without a camera. */
  standIn?: Texture | null;
  renderTick?(): number | null;
  theme?: SceneThemeId;
}) {
  return (
    <>
      <ScenePrimitives {...visibilityMask(view)} players={[]} theme={theme} />
      <VisibleExits view={view} ownerNames={ownerNames} />
      <EquipmentObjects view={view} />
      <FaceAvatars view={view} faces={faces} standIn={standIn} renderTick={renderTick} />
    </>
  );
}

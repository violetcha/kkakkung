import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { visibilityMask } from './visibility-mask';
import { ScenePrimitives } from './primitives';
import { VisibleExits } from './VisibleExits';
import { EquipmentObjects } from './EquipmentObjects';
import { FaceAvatars } from './FaceAvatar';
import type { FaceTextures } from './face-textures';
import type { OwnerNames } from './ExitOwnerLabel';
export function VisibleTerrain({
  view,
  ownerNames,
  faces,
}: {
  view: PrivateView;
  ownerNames?: OwnerNames;
  faces?: FaceTextures;
}) {
  return (
    <>
      <ScenePrimitives {...visibilityMask(view)} />
      <VisibleExits view={view} ownerNames={ownerNames} />
      <EquipmentObjects view={view} />
      <FaceAvatars view={view} faces={faces} />
    </>
  );
}

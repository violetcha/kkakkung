import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { visibilityMask } from './visibility-mask';
import { ScenePrimitives } from './primitives';
import { VisibleExits } from './VisibleExits';
import { EquipmentObjects } from './EquipmentObjects';
import type { OwnerNames } from './ExitOwnerLabel';
export function VisibleTerrain({
  view,
  ownerNames,
}: {
  view: PrivateView;
  ownerNames?: OwnerNames;
}) {
  return (
    <>
      <ScenePrimitives {...visibilityMask(view)} />
      <VisibleExits view={view} ownerNames={ownerNames} />
      <EquipmentObjects view={view} />
    </>
  );
}

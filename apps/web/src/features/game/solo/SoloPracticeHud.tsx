import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';
import { CamcorderOverlay } from '../flow/CamcorderOverlay';
import { Hotbar } from '../flow/Hotbar';
import { MiniMap } from '../map/MiniMap';

export function SoloPracticeHud({
  view,
  tick,
  selected,
  startedAtMs,
  nowMs,
}: {
  view: PrivateView;
  tick: number;
  selected: EquipmentKind;
  startedAtMs?: number;
  nowMs?: number;
}) {
  return (
    <>
      <CamcorderOverlay
        {...(startedAtMs === undefined ? {} : { startedAtMs })}
        {...(nowMs === undefined ? {} : { nowMs })}
      />
      <div className="crosshair" aria-hidden="true" />
      <Hotbar view={view} tick={tick} selected={selected} />
      <MiniMap view={view} tick={tick} ownerNames={{ 'solo-self': '나' }} />
    </>
  );
}

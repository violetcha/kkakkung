import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';
import { CamcorderOverlay, StageClock } from '../flow/CamcorderOverlay';
import { Hotbar } from '../flow/Hotbar';
import { TaggerVeins } from '../flow/TaggerVeins';
import { MiniMap } from '../map/MiniMap';
import { MINIMAP_WINDOW_CELLS } from '../map/minimap-render';

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
      {/* 화면 테두리는 역할이 정한다: 도망자는 캠코더, 술래는 핏줄(S15P21C204-295). */}
      {view.self?.status === 'ACTIVE' && view.self.role === 'tagger' ? (
        <>
          <TaggerVeins />
          <StageClock
            {...(startedAtMs === undefined ? {} : { elapsedFrom: startedAtMs })}
            {...(nowMs === undefined ? {} : { nowMs })}
          />
        </>
      ) : (
        <CamcorderOverlay
          {...(startedAtMs === undefined ? {} : { startedAtMs })}
          {...(nowMs === undefined ? {} : { nowMs })}
        />
      )}
      <div className="crosshair" aria-hidden="true" />
      <Hotbar view={view} tick={tick} selected={selected} />
      <MiniMap
        view={view}
        tick={tick}
        ownerNames={{ 'solo-self': '나' }}
        windowCells={MINIMAP_WINDOW_CELLS}
      />
    </>
  );
}

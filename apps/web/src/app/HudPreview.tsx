import { useState } from 'react';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { roundFixture } from '../features/room/product-fixture';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import { GameHud } from '../features/game/flow/GameHud';
import { GameStatusChrome } from '../features/game/flow/CamcorderOverlay';
import { SpectatorBar } from '../features/game/flow/SpectatorBar';
import { Hotbar } from '../features/game/flow/Hotbar';
import { MiniMap } from '../features/game/map/MiniMap';
import { crosshairState, installHint } from '../features/game/flow/install-hint';
import { ExchangePanel } from '../features/game/map/ExchangePanel';
import { EquipmentHud } from '../features/game/equipment/EquipmentHud';
import type { EquipmentKind } from '@kkakkung/protocol/game-schema';
import { renderFixture } from '../features/game/scene/render-fixture';

const TICK = 100;

function previewView(role: 'runner' | 'tagger'): PrivateView {
  const base = renderFixture('복도');
  const self = base.self!;
  if (self.status !== 'ACTIVE') throw new Error('fixture self must be active');
  return {
    ...base,
    self: {
      ...self,
      role,
      equipment: role === 'tagger' ? { sensor: 2, trap: 1 } : { sensor: 0, trap: 0 },
      restraintUntilTick: role === 'runner' ? TICK + 40 : null,
    },
    visibleEntities:
      role === 'runner'
        ? [
            {
              id: 'ally',
              kind: 'player',
              cell: { x: 1, y: 0 },
              dir: 2,
              action: null,
              role: 'runner',
            },
          ]
        : [],
  };
}

/**
 * S15P21C204-276. 경기 화면 오버레이 배치 검수.
 * 합성 fixture 로만 그리며 실제 방·장치·미디어를 쓰지 않는다. 좁은 폭도 여기서 본다.
 */
export function HudPreview() {
  const [role, setRole] = useState<'runner' | 'tagger'>('tagger');
  const [selected, setSelected] = useState<EquipmentKind>('sensor');
  const [drawer, setDrawer] = useState(false);
  const [facingWall, setFacingWall] = useState(false);
  const [spectating, setSpectating] = useState(false);
  const baseView = previewView(role);
  const baseSelf = baseView.self;
  if (baseSelf?.status !== 'ACTIVE') throw new Error('preview self must be active');
  const view = facingWall
    ? {
        ...baseView,
        visibleWallFaces: [
          ...baseView.visibleWallFaces,
          { x: baseSelf.cell.x, y: baseSelf.cell.y - 1, side: 2 as const },
        ],
      }
    : baseView;
  const self = view.self;
  if (self?.status !== 'ACTIVE') throw new Error('preview self must be active');
  const round = roundFixture({ phase: 'PLAYING', serverTick: TICK, deadlineTick: TICK + 2400 });
  return (
    <>
      <div className="actions" aria-label="검수 설정">
        {(['tagger', 'runner'] as const).map((value) => (
          <button key={value} aria-pressed={role === value} onClick={() => setRole(value)}>
            {value === 'tagger' ? '술래 시점' : '도망자 시점'}
          </button>
        ))}
        <button aria-pressed={drawer} onClick={() => setDrawer(!drawer)}>
          접히는 오버레이 {drawer ? '접기' : '펼치기'}
        </button>
        <button aria-pressed={facingWall} onClick={() => setFacingWall(!facingWall)}>
          설치 가능 칸 {facingWall ? '끄기' : '켜기'}
        </button>
        <button aria-pressed={spectating} onClick={() => setSpectating(!spectating)}>
          관전 {spectating ? '끄기' : '켜기'}
        </button>
      </div>
      <section className="game-stage">
        <div className="product-canvas">
          <WorldCanvas view={view} quality="low" />
        </div>
        <GameStatusChrome
          startedAtMs={0}
          nowMs={4_000}
          status={<GameHud round={round} self={self} mode="motion" />}
        />
        {spectating ? (
          <SpectatorBar
            spectating={{
              targetId: 'preview-runner-a',
              cell: self.cell,
              dir: self.dir,
              action: null,
              candidates: ['preview-runner-a', 'preview-runner-b'],
            }}
            playerNames={{ 'preview-runner-a': '유리', 'preview-runner-b': '초록' }}
          />
        ) : (
          <>
            <div
              className="crosshair"
              aria-hidden="true"
              data-install={crosshairState(installHint(view, selected, TICK))}
            />
            <Hotbar
              view={view}
              tick={TICK}
              selected={selected}
              hint={installHint(view, selected, TICK)}
              onSelectEquipment={(kind) => setSelected(kind)}
            />
          </>
        )}
        <MiniMap view={view} tick={TICK} />
        <details className="hud-drawer" open={drawer} hidden={spectating}>
          <summary>교환 · 도전 · 장치 · 소리</summary>
          <div className="hud-drawer-body">
            <ExchangePanel
              view={view}
              selected={null}
              tick={TICK}
              onSelect={() => {}}
              send={() => {}}
            />
            <EquipmentHud
              view={view}
              tick={TICK}
              selected={selected}
              onSelect={setSelected}
              send={() => {}}
            />
          </div>
        </details>
      </section>
    </>
  );
}

// S15P21C204-276. 경기 화면 아래 핫바. 역할에 따라 쓸 수 있는 것 두 칸을 항상 같은 자리에 둔다.
// 판정은 기존 presenter 가 하고 여기서는 칸의 모양만 정한다.
import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';
import { equipmentPresenter } from '../equipment/equipment-presenter';
import { exchangePresenter } from '../map/exchange-presenter';

export type HotbarSlotState = 'selected' | 'available' | 'unavailable' | 'reserved';

export type HotbarSlot = Readonly<{
  id: string;
  /** 칸 번호(1~5). 게임 핫바처럼 자리마다 늘 같은 숫자가 보인다. */
  key: string;
  glyph: string;
  label: string;
  /** 칸 오른쪽 아래의 남은 개수. 개수 개념이 없는 칸은 null 이다. */
  count: number | null;
  detail: string | null;
  state: HotbarSlotState;
}>;

/** 감지기는 벽 상자(▣), 덫은 바닥 지지대(▲). 3D 형상·장비 HUD 와 같은 구분이다. */
const EQUIPMENT_GLYPH: Record<EquipmentKind, string> = { sensor: '▣', trap: '▲' };
const EQUIPMENT_LABEL: Record<EquipmentKind, string> = { sensor: '감지기', trap: '덫' };

function completeFiveSlots(slots: readonly HotbarSlot[]): readonly HotbarSlot[] {
  const locked = Array.from({ length: Math.max(0, 5 - slots.length) }, (_, index) => {
    const position = slots.length + index + 1;
    return Object.freeze({
      id: `locked-${position}`,
      key: String(position),
      glyph: '·',
      label: '빈 슬롯',
      count: null,
      detail: null,
      state: 'reserved' as const,
    });
  });
  return Object.freeze([...slots, ...locked]);
}

export function hotbarSlots(input: {
  view: PrivateView | null;
  tick: number;
  selected: EquipmentKind;
  exchangeTarget?: string | null;
}): readonly HotbarSlot[] | null {
  const equipment = equipmentPresenter(input.view, input.tick);
  if (equipment)
    return completeFiveSlots(
      (['sensor', 'trap'] as const).map((kind, index) =>
        Object.freeze({
          id: kind,
          key: String(index + 1),
          glyph: EQUIPMENT_GLYPH[kind],
          label: EQUIPMENT_LABEL[kind],
          count: equipment.remaining[kind],
          detail: `${equipment.remaining[kind]}개`,
          state:
            equipment.remaining[kind] === 0 || equipment.locked
              ? 'unavailable'
              : input.selected === kind
                ? 'selected'
                : 'available',
        }),
      ),
    );
  // 도망자 아이템(J7)이 정해지면 채운다. 지도 교환·탈출 도전은 아이템이 아니라 상호작용이므로
  // 핫바에 두지 않는다(interact-prompt). 자리만 비워 두어 두 역할의 배치가 같다.
  const exchange = exchangePresenter(input.view, input.exchangeTarget ?? null, input.tick);
  if (!exchange) return null;
  return completeFiveSlots([]);
}

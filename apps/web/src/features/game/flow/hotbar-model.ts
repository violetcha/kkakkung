// S15P21C204-276. 경기 화면 아래 핫바. 역할에 따라 쓸 수 있는 것 두 칸을 항상 같은 자리에 둔다.
// 판정은 기존 presenter 가 하고 여기서는 칸의 모양만 정한다.
import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';
import { equipmentPresenter } from '../equipment/equipment-presenter';
import { exchangePresenter } from '../map/exchange-presenter';

export type HotbarSlotState = 'selected' | 'available' | 'unavailable' | 'reserved';

export type HotbarSlot = Readonly<{
  id: string;
  /** 누르는 키. 화면 단추에도 같은 글자를 적는다. */
  key: string;
  glyph: string;
  label: string;
  detail: string | null;
  state: HotbarSlotState;
}>;

/** 감지기는 벽 상자(▣), 덫은 바닥 지지대(▲). 3D 형상·장비 HUD 와 같은 구분이다. */
const EQUIPMENT_GLYPH: Record<EquipmentKind, string> = { sensor: '▣', trap: '▲' };
const EQUIPMENT_LABEL: Record<EquipmentKind, string> = { sensor: '감지기', trap: '덫' };

export function hotbarSlots(input: {
  view: PrivateView | null;
  tick: number;
  selected: EquipmentKind;
  exchangeTarget?: string | null;
}): readonly HotbarSlot[] | null {
  const equipment = equipmentPresenter(input.view, input.tick);
  if (equipment)
    return (['sensor', 'trap'] as const).map((kind, index) =>
      Object.freeze({
        id: kind,
        key: String(index + 1),
        glyph: EQUIPMENT_GLYPH[kind],
        label: EQUIPMENT_LABEL[kind],
        detail: `${equipment.remaining[kind]}개`,
        state:
          equipment.remaining[kind] === 0 || equipment.locked
            ? 'unavailable'
            : input.selected === kind
              ? 'selected'
              : 'available',
      }),
    );
  const exchange = exchangePresenter(input.view, input.exchangeTarget ?? null, input.tick);
  if (!exchange) return null;
  return [
    Object.freeze({
      id: 'exchange',
      key: 'E',
      glyph: '⇄',
      label: '지도 교환',
      detail: exchange.canAccept ? '수락 대기' : exchange.canRequest ? '가까이 있음' : null,
      state: (exchange.canAccept
        ? 'selected'
        : exchange.canRequest
          ? 'available'
          : 'unavailable') as HotbarSlotState,
    }),
    // 도망자 아이템(J7)이 정해지면 채운다. 자리를 미리 잡아 두어 핫바 배치가 나중에 흔들리지 않는다.
    Object.freeze({
      id: 'reserved',
      key: '2',
      glyph: '▢',
      label: '예약 슬롯',
      detail: '준비 중',
      state: 'reserved' as HotbarSlotState,
    }),
  ];
}

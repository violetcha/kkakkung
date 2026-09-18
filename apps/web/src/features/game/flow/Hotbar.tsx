import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';
import { hotbarSlots } from './hotbar-model';

/**
 * S15P21C204-276. 경기 화면 아래 가운데 핫바.
 * 술래는 감지기·덫, 도망자는 지도 교환과 예약 슬롯을 같은 자리에서 본다.
 */
export function Hotbar({
  view,
  tick,
  selected,
  exchangeTarget,
  onSelectEquipment,
}: {
  view: PrivateView | null;
  tick: number;
  selected: EquipmentKind;
  exchangeTarget?: string | null;
  onSelectEquipment?(kind: EquipmentKind): void;
}) {
  const slots = hotbarSlots({ view, tick, selected, exchangeTarget });
  if (!slots) return null;
  return (
    <div className="hotbar" aria-label="빠른 선택">
      {slots.map((slot) => {
        const selectable =
          onSelectEquipment && (slot.id === 'sensor' || slot.id === 'trap') ? slot.id : null;
        const body = (
          <>
            <span className="hotbar-key" aria-hidden="true">
              {slot.key}
            </span>
            <span className="hotbar-glyph" aria-hidden="true">
              {slot.glyph}
            </span>
            <span className="hotbar-label">{slot.label}</span>
            {slot.detail && <span className="hotbar-detail">{slot.detail}</span>}
          </>
        );
        return selectable ? (
          <button
            key={slot.id}
            type="button"
            className="hotbar-slot"
            data-slot={slot.id}
            data-state={slot.state}
            aria-pressed={slot.state === 'selected'}
            disabled={slot.state === 'unavailable'}
            onClick={() => onSelectEquipment?.(selectable as EquipmentKind)}
          >
            {body}
          </button>
        ) : (
          <div key={slot.id} className="hotbar-slot" data-slot={slot.id} data-state={slot.state}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';
import { hotbarSlots } from './hotbar-model';
import type { InstallHint } from './install-hint';

/**
 * S15P21C204-276. 경기 화면 아래 가운데 핫바.
 * 술래는 감지기·덫, 도망자는 지도 교환과 예약 슬롯을 같은 자리에서 본다.
 */
export function Hotbar({
  view,
  tick,
  selected,
  exchangeTarget,
  hint,
  onSelectEquipment,
}: {
  view: PrivateView | null;
  tick: number;
  selected: EquipmentKind;
  exchangeTarget?: string | null;
  /** S15P21C204-278. 지금 설치할 수 있는지와 그 이유. 술래가 아니면 넘기지 않는다. */
  hint?: InstallHint | null;
  onSelectEquipment?(kind: EquipmentKind): void;
}) {
  const slots = hotbarSlots({ view, tick, selected, exchangeTarget });
  if (!slots) return null;
  // 게임 핫바처럼 칸 안에는 글리프·번호·개수만 두고, 이름은 고른 칸의 것만 바 위에 한 줄로 띄운다.
  const current = slots.find((slot) => slot.state === 'selected') ?? slots[0]!;
  return (
    <div className="hotbar" aria-label="빠른 선택">
      {hint && (
        <p className="hotbar-hint" role="status" data-ready={hint.ready}>
          {hint.text}
        </p>
      )}
      <p className="hotbar-name" aria-hidden="true">
        {current.label}
        {current.detail && <span>{current.detail}</span>}
      </p>
      <div className="hotbar-slots">
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
              {slot.count !== null && (
                <span className="hotbar-count" aria-hidden="true">
                  {slot.count}
                </span>
              )}
              {/* 이름·개수는 바 위 한 줄에 있다. 여기 글자는 보조 기술을 위해 남긴다. */}
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
    </div>
  );
}

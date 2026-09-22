// S15P21C204-311. 로비의 맵 크기 선택. 방장만 고르고, 참가자에게는 고른 것이 보이기만 한다.
//
// 장치 점검이 시작되면 잠긴다. 맵은 MAP_FINALIZING 에서 확정되므로 그 전까지만 바꿀 수 있고,
// 호출 측이 `canEdit` 으로 그 단계를 정한다. 이 파일은 단계를 스스로 판단하지 않는다.
import { MAP_SIZE_OPTIONS, type MapSizeId } from './map-size';

export function MapSizeChoice({
  value,
  canEdit,
  busy = false,
  onSelect,
  editableNote = '방장이 고릅니다. 장치 점검이 시작되면 바꿀 수 없습니다.',
  note,
}: {
  value: MapSizeId;
  /** 방장이고 아직 바꿀 수 있는 단계일 때만 true. */
  canEdit: boolean;
  busy?: boolean;
  onSelect?(size: MapSizeId): void;
  /** 바꿀 수 있을 때의 안내. 데모 방은 준비 단계에서도 고르므로 문구가 다르다(S15P21C204-313). */
  editableNote?: string;
  /** 단계와 무관하게 상태 문구를 통째로 바꿀 때. 시연 방처럼 맵이 고정된 이유를 적는다. */
  note?: string;
}) {
  return (
    <section className="map-size-choice" aria-label="맵 크기">
      <h3>맵 크기</h3>
      <div className="map-size-options" role="group" aria-label="맵 크기 선택">
        {MAP_SIZE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
            disabled={!canEdit || busy || !onSelect}
            onClick={() => onSelect?.(option.id)}
          >
            <strong>{option.label}</strong>
            <span>
              {option.grid}×{option.grid} 미로
            </span>
          </button>
        ))}
      </div>
      <p role="status">{note ?? (canEdit ? editableNote : '방장이 고른 맵입니다.')}</p>
    </section>
  );
}

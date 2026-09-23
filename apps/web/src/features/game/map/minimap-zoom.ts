// S15P21C204-352. 경기 미니맵의 축척 전환. M 키로 내 주변 창(295)과 전체 지도를 오간다.
//
// 판단만 여기 모은다: 키가 토글인지, 전환이 지금 어디까지 왔는지. 그리기는 minimap-render,
// 상태 보관은 MiniMap 이 한다. 전환은 화면 위젯 안에서만 일어나므로 게임 입력과 겹치지 않는다.
import { isTextEntryTarget } from '../../input/InteractionRuntime';

/** 전환에 쓰는 시간. 0.2초 안쪽이라 보던 자리를 눈으로 따라갈 수 있으면서 답답하지 않다. */
export const MINIMAP_ZOOM_MS = 180;

/** 축척을 바꾸는 키. 이동·행동 키와 겹치지 않는다. */
export const MINIMAP_ZOOM_CODE = 'KeyM';

/**
 * 이 키 사건이 축척 토글인지. 입력창·IME 조합 중에는 다른 단축키와 같은 규칙으로 무시하고,
 * 길게 눌러 생기는 반복도 한 번으로 본다. 수식 키가 눌린 조합(Ctrl+M 등)은 브라우저·확장의
 * 것이므로 건드리지 않는다.
 */
export function togglesMinimapZoom(
  event: Readonly<{
    code: string;
    repeat?: boolean;
    isComposing?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    target?: EventTarget | null;
  }>,
): boolean {
  if (event.code !== MINIMAP_ZOOM_CODE) return false;
  if (event.repeat || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return !isTextEntryTarget(event.target ?? null);
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** 가운데가 빠르고 양 끝이 느린 곡선. 시작과 끝이 툭 끊기지 않는다. */
export function easeMinimapZoom(progress: number): number {
  const t = clamp01(progress);
  return t * t * (3 - 2 * t);
}

/**
 * `from` 에서 `to` 로 가는 전환이 `elapsedMs` 뒤에 어디쯤인지. 전환 도중에 다시 누르면 지금
 * 위치에서 반대로 돌아가야 하므로, 남은 거리에 비례해 시간을 쓴다.
 */
export function minimapZoomAt(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs = MINIMAP_ZOOM_MS,
): number {
  const distance = Math.abs(to - from);
  if (distance === 0 || durationMs <= 0) return to;
  const progress = clamp01(elapsedMs / (durationMs * distance));
  return from + (to - from) * easeMinimapZoom(progress);
}

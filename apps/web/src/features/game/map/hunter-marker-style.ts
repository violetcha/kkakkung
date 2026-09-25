// S15P21C204-386. 술래 미니맵의 사건 표식. 한 번 반짝이고 마는 빈 원으로는 멀리서 걸린 덫·감지기를
// 놓쳤다. 종류마다 모양과 색을 나누고, 퍼지는 물결로 눈을 끌고, 사라지기 전에 흐려진다. 작은 창
// 밖에서 일어난 사건은 창 가장자리에 그쪽을 가리키는 화살표로 남긴다. 위치·시각은 서버가 준
// 표식 그대로이며 새 정보를 만들지 않는다.
import type { HunterMarker } from './past-event-markers';

export type MarkerShape = 'triangle' | 'square' | 'circle';
export type HunterMarkerStyle = Readonly<{
  shape: MarkerShape;
  /** `r, g, b`. 투명도는 그릴 때 붙인다. */
  rgb: string;
  ripple: boolean;
}>;

export const HUNTER_MARKER_STYLES: Readonly<Record<HunterMarker['kind'], HunterMarkerStyle>> =
  Object.freeze({
    trap: { shape: 'triangle', rgb: '255, 74, 58', ripple: true },
    sensor: { shape: 'square', rgb: '255, 210, 74', ripple: true },
    exchange: { shape: 'circle', rgb: '216, 170, 97', ripple: false },
  });

/** 물결 한 바퀴의 길이(틱)와 물결이 퍼지는 반지름(칸). */
export const RIPPLE = Object.freeze({ periodTicks: 20, fromCells: 0.35, toCells: 1.9 });
/** 보이는 시간 가운데 마지막 이만큼 동안 흐려진다. */
const FADE_SHARE = 0.25;

export type MarkerPhase = Readonly<{
  /** 표식 자체의 불투명도. 끝나기 전에 0으로 내려간다. */
  alpha: number;
  /** 반 주기씩 어긋난 두 물결. */
  rings: readonly Readonly<{ radiusCells: number; alpha: number }>[];
  /** 창 밖 화살표의 깜빡임(0.3~1). 물결과 같은 주기로 숨 쉬듯 밝아졌다 어두워진다. */
  pulse: number;
}>;

export function hunterMarkerPhase(marker: HunterMarker, tick: number): MarkerPhase {
  const total = Math.max(1, marker.expiresTick - marker.showAtTick);
  const elapsed = Math.max(0, tick - marker.showAtTick);
  const alpha = Math.max(0, Math.min(1, (total - elapsed) / (total * FADE_SHARE)));
  const rings = [0, RIPPLE.periodTicks / 2].map((shift) => {
    const progress = ((elapsed + shift) % RIPPLE.periodTicks) / RIPPLE.periodTicks;
    return {
      radiusCells: RIPPLE.fromCells + progress * (RIPPLE.toCells - RIPPLE.fromCells),
      alpha: alpha * (1 - progress) * 0.9,
    };
  });
  const cycle = (elapsed % RIPPLE.periodTicks) / RIPPLE.periodTicks;
  return { alpha, rings, pulse: 0.65 + 0.35 * Math.cos(cycle * Math.PI * 2) };
}

export const rgba = (rgb: string, alpha: number) =>
  `rgba(${rgb}, ${Math.round(alpha * 1000) / 1000})`;

/**
 * 창 가운데(`from`)에서 창 밖 사건(`to`)으로 가는 선이 창 테두리(안쪽으로 `inset` 들인 사각형)와
 * 만나는 점과 그 방향. 그 자리에 바깥을 가리키는 화살표를 그린다.
 */
export function edgeArrow(
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
  box: Readonly<{ min: number; max: number }>,
): Readonly<{ x: number; y: number; angle: number }> | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  const reach = (d: number, start: number) =>
    d > 0 ? (box.max - start) / d : d < 0 ? (box.min - start) / d : Infinity;
  const t = Math.min(reach(dx, from.x), reach(dy, from.y));
  return { x: from.x + dx * t, y: from.y + dy * t, angle: Math.atan2(dy, dx) };
}

/**
 * 알림에 붙일 방향과 대략의 거리("북동쪽 약 12칸"). 지도는 위가 북쪽이고 칸 y 는 아래로 커진다.
 * 가까우면 방향 대신 "근처"라고 쓴다. 거리는 직선 칸 수를 반올림한 값이다.
 */
export function compassFrom(
  self: Readonly<{ x: number; y: number }>,
  point: Readonly<{ x: number; y: number }>,
): string {
  const dx = point.x - self.x;
  const dy = point.y - self.y;
  if (Math.hypot(dx, dy) < 1.5) return '근처';
  const ns = dy < -Math.abs(dx) / 2 ? '북' : dy > Math.abs(dx) / 2 ? '남' : '';
  const ew = dx > Math.abs(dy) / 2 ? '동' : dx < -Math.abs(dy) / 2 ? '서' : '';
  return `${ns}${ew}쪽 약 ${Math.round(Math.hypot(dx, dy))}칸`;
}

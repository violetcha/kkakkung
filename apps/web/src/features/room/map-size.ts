/**
 * S15P21C204-311. 방장이 로비에서 고르는 맵 크기.
 *
 * 화면 표기와 실제 미로 격자가 다르다. 미로는 홀수 격자 위에만 만들어지므로(갈림길이 홀수
 * 좌표, 벽이 한 칸씩 - `scripts/generate-maze-template.mjs`) 16/24/32 는 사람에게 보이는
 * 표기이고 실제 격자는 15/23/31 이다.
 *
 * 고른 값은 계약(MAP_SIZES)이 옮기고, 표기와 격자의 짝은 여기서만 정한다. 실제 템플릿 선택은
 * 크기별 맵이 생긴 뒤에 서버가 붙인다.
 */
import { MAP_SIZES, type MapSize } from '@kkakkung/protocol/game-schema';
export type MapSizeId = MapSize;

export type MapSizeOption = Readonly<{
  id: MapSizeId;
  /** 화면에 보이는 표기. */
  label: string;
  /** 실제 미로 격자 한 변. 홀수만 가능하다. */
  grid: number;
}>;

/** 계약의 크기마다 표기와 격자를 하나씩 둔다. 새 크기가 생기면 여기서 막힌다. */
const DISPLAY: Readonly<Record<MapSizeId, Omit<MapSizeOption, 'id'>>> = Object.freeze({
  small: { label: '16x16', grid: 15 },
  medium: { label: '24x24', grid: 23 },
  large: { label: '32x32', grid: 31 },
});

/** 화면에 왼쪽부터 놓는 순서는 계약의 순서를 따른다. */
export const MAP_SIZE_OPTIONS: readonly MapSizeOption[] = Object.freeze(
  MAP_SIZES.map((id) => Object.freeze({ id, ...DISPLAY[id] })),
);

/** 지금 제품 기본값인 `maze-v1`(31x31)과 같은 크기. */
export const DEFAULT_MAP_SIZE: MapSizeId = 'large';

/** S15P21C204-398. 고른 크기의 실제 미로 격자 한 변. 미니맵 전체 지도가 이 칸 수를 담는다. */
export function mapGrid(id: MapSizeId): number {
  return DISPLAY[id].grid;
}

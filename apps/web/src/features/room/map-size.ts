/**
 * S15P21C204-311. 방장이 로비에서 고르는 맵 크기.
 *
 * 화면 표기와 실제 미로 격자가 다르다. 미로는 홀수 격자 위에만 만들어지므로(갈림길이 홀수
 * 좌표, 벽이 한 칸씩 - `scripts/generate-maze-template.mjs`) 16/24/32 는 사람에게 보이는
 * 표기이고 실제 격자는 15/23/31 이다.
 *
 * 목록은 아직 웹이 들고 있다. 서버가 방마다 맵을 갖게 되면 목록도 서버가 소유하고, 이 파일은
 * 표기만 남긴다. 그때까지 화면은 고른 값을 서버에 보내지 않는다.
 */
export const MAP_SIZE_IDS = ['small', 'medium', 'large'] as const;
export type MapSizeId = (typeof MAP_SIZE_IDS)[number];

export type MapSizeOption = Readonly<{
  id: MapSizeId;
  /** 화면에 보이는 표기. */
  label: string;
  /** 실제 미로 격자 한 변. 홀수만 가능하다. */
  grid: number;
}>;

export const MAP_SIZE_OPTIONS: readonly MapSizeOption[] = Object.freeze([
  Object.freeze({ id: 'small', label: '16x16', grid: 15 }),
  Object.freeze({ id: 'medium', label: '24x24', grid: 23 }),
  Object.freeze({ id: 'large', label: '32x32', grid: 31 }),
]);

/** 지금 제품 기본값인 `maze-v1`(31x31)과 같은 크기. */
export const DEFAULT_MAP_SIZE: MapSizeId = 'large';

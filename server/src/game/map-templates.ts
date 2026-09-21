/**
 * S15P21C204-321. 로비에서 고른 크기와 인증된 템플릿의 짝.
 *
 * 크기(small/medium/large)는 계약이고 템플릿 id 는 배포 내용물이라 짝은 서버가 쥔다. 격자는
 * 15 / 23 / 31 이며 화면 표기(16x16 등)와 다르다. 미로는 홀수 격자 위에만 만들어진다.
 *
 * 세 맵 모두 `scripts/generate-maze-template.mjs` 가 같은 규칙으로 만들고 인증한다.
 */
import type { MapSize } from '@kkakkung/protocol/game-schema';

export const MAP_TEMPLATE_BY_SIZE: Readonly<Record<MapSize, string>> = Object.freeze({
  small: 'maze-s-v1',
  medium: 'maze-m-v1',
  large: 'maze-v1',
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { MAP_SIZES } from '@kkakkung/protocol/game-schema';
import { MAP_TEMPLATE_BY_SIZE } from '../../src/game/map-templates.js';

/**
 * S15P21C204-321. 로비가 고르는 크기마다 배포에 인증된 맵이 실제로 있어야 한다. 크기를 늘리면서
 * 맵을 빠뜨리면 그 방은 조용히 기본 맵으로 돌아가므로, 여기서 먼저 막는다.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const mapPath = (templateId: string) => resolve(root, `server/content/maps/${templateId}.json`);

it('names a template for every size the contract offers', () => {
  expect(Object.keys(MAP_TEMPLATE_BY_SIZE).sort()).toEqual([...MAP_SIZES].sort());
  // 두 크기가 같은 맵을 가리키면 고르는 의미가 없다.
  expect(new Set(Object.values(MAP_TEMPLATE_BY_SIZE)).size).toBe(MAP_SIZES.length);
});

it('ships a map and a certified placement file for each of them', () => {
  for (const templateId of Object.values(MAP_TEMPLATE_BY_SIZE)) {
    expect(existsSync(mapPath(templateId)), templateId).toBe(true);
    expect(
      existsSync(resolve(root, `server/content/placements/${templateId}-fallback.json`)),
      templateId,
    ).toBe(true);
  }
});

it('keeps each grid square and odd, and the sizes ordered small to large', () => {
  const sizes = MAP_SIZES.map((size) => {
    const templateId = MAP_TEMPLATE_BY_SIZE[size];
    const map = JSON.parse(readFileSync(mapPath(templateId), 'utf8')) as {
      width: number;
      height: number;
    };
    expect(map.width, templateId).toBe(map.height);
    // 미로는 홀수 격자 위에만 만들어진다. 화면 표기(16x16 등)는 이 값과 다르다.
    expect(map.width % 2, templateId).toBe(1);
    return map.width;
  });
  expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
});

// S15P21C204-374. 핏줄은 한 번 그려 두는 그림 한 장이다. 화면 위에서 합성 효과를 다시 걸지 않는다.
import { expect, it } from 'vitest';
import { veinImageSvg } from './TaggerVeins';

it('draws the vessels, their warp and the edge fade into one standalone image', () => {
  const svg = veinImageSvg();
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('<feDisplacementMap');
  expect(svg).toContain('mask="url(#fade)"');
  // 번진 겹과 또렷한 겹이 같은 경로를 한 번씩 그린다.
  const bleed = svg.match(/stroke="#3e0303"/g)?.length ?? 0;
  const core = svg.match(/stroke="#640909"/g)?.length ?? 0;
  expect(bleed).toBeGreaterThan(50);
  expect(core).toBe(bleed);
  expect(svg).not.toContain('mix-blend');
  // 같은 씨앗이라 매번 같은 그림이다.
  expect(veinImageSvg()).toBe(svg);
});

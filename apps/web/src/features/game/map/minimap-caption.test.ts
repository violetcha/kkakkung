import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { MiniMap } from './MiniMap';
import { MINIMAP_WINDOW_CELLS } from './minimap-render';

const markup = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(MiniMap, { view: viewFixture(), ...props }));

// S15P21C204-352. 축척은 눈으로만 알 수 있는 것이 아니라 화면 설명으로도 말해야 한다.
it('tells which scale the minimap is at and which key changes it', () => {
  const near = markup({ windowCells: MINIMAP_WINDOW_CELLS });
  expect(near).toContain(`내 주변 ${MINIMAP_WINDOW_CELLS}칸 지도`);
  expect(near).toContain('M = 전체 지도');
  expect(near).not.toContain('mini-map-zoomed-out');

  const out = markup({ windowCells: MINIMAP_WINDOW_CELLS, zoomedOut: true });
  expect(out).toContain('내가 탐색한 지도 전체');
  expect(out).toContain('M = 내 주변');
  expect(out).toContain('mini-map-zoomed-out');

  // 사이드바 전체 지도는 이 키와 무관하므로 안내하지 않는다.
  expect(markup({})).not.toContain('M =');
});

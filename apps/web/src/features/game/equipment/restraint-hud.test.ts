import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { RestraintHud } from './RestraintHud';

const render = (restraintUntilTick: number | null, restraintImmuneUntilTick: number | null) => {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  return renderToStaticMarkup(
    createElement(RestraintHud, {
      view: { ...view, self: { ...view.self, restraintUntilTick, restraintImmuneUntilTick } },
      tick: 100,
    }),
  );
};

it('separates restraint from immunity by state attribute and glyph instead of a generic notice', () => {
  const restrained = render(160, null);
  expect(restrained).toContain('class="restraint-hud"');
  expect(restrained).not.toContain('class="notice"');
  // S15P21C204-386. 사용자가 정한 문구. 남은 초를 그대로 넣는다.
  expect(restrained).toContain('덫을 밟았습니다! 3초 동안 움직일 수 없습니다!');
  expect(restrained).toMatch(/data-state="restrained"[^>]*>[^<]*⛓/);
  const immune = render(null, 140);
  expect(immune).toMatch(/data-state="immune"[^>]*>[^<]*◈[^<]*구속 면역 2초/);
  expect(immune).not.toContain('data-state="restrained"');
});

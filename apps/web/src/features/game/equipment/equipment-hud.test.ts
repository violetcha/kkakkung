import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { EquipmentHud } from './EquipmentHud';

function taggerView() {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  return {
    ...view,
    self: {
      ...view.self,
      role: 'tagger' as const,
      equipment: { sensor: 2, trap: 1 },
      ownedEquipment: [
        {
          equipmentId: 'a',
          kind: 'sensor' as const,
          cell: { x: 1, y: 1 },
          state: 'ARMED' as const,
          armedTick: 1,
        },
        {
          equipmentId: 'b',
          kind: 'trap' as const,
          cell: { x: 2, y: 1 },
          state: 'UNARMED' as const,
          armedTick: 200,
        },
        {
          equipmentId: 'c',
          kind: 'trap' as const,
          cell: { x: 3, y: 1 },
          state: 'SPENT' as const,
          armedTick: 1,
        },
      ],
    },
  };
}

it('tells sensor and trap apart by glyph and kind attribute on the pick buttons', () => {
  const html = renderToStaticMarkup(
    createElement(EquipmentHud, {
      view: taggerView(),
      tick: 100,
      selected: 'sensor',
      onSelect() {},
      send() {},
    }),
  );
  expect(html).toMatch(/<button[^>]*data-kind="sensor"[^>]*>[^<]*▣[^<]*감지기/);
  expect(html).toMatch(/<button[^>]*data-kind="trap"[^>]*>[^<]*▲[^<]*덫/);
});

it('marks owned equipment armed, pending and spent with distinct glyphs and states', () => {
  const html = renderToStaticMarkup(
    createElement(EquipmentHud, {
      view: taggerView(),
      tick: 100,
      selected: 'trap',
      onSelect() {},
      send() {},
    }),
  );
  expect(html).toMatch(/<li[^>]*data-state="armed"[^>]*>[^<]*●[^<]*감지기[^<]*무장됨/);
  expect(html).toMatch(/<li[^>]*data-state="pending"[^>]*>[^<]*○[^<]*덫[^<]*무장 대기 5\.0초/);
  expect(html).toMatch(/<li[^>]*data-state="spent"[^>]*>[^<]*×[^<]*덫[^<]*소모됨/);
});

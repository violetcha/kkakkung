import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { visibilityMask } from './visibility-mask';
import { verticalFov } from './FirstPersonCamera';
it('does not fill visibility holes from remembered terrain', () => {
  expect(visibilityMask(viewFixture({ visibleCells: [] })).cells).toEqual([]);
  expect(visibilityMask(viewFixture({ visibleCells: [{ x: 10, y: 10 }] })).cells).toEqual([]);
});
it('keeps eighty degrees horizontally across screen ratios', () => {
  for (const aspect of [9 / 16, 16 / 9, 32 / 9])
    expect(
      (2 * Math.atan(Math.tan((verticalFov(aspect) * Math.PI) / 360) * aspect) * 180) / Math.PI,
    ).toBeCloseTo(80);
});

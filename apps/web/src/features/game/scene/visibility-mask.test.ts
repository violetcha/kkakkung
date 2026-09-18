import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { visibilityMask } from './visibility-mask';
import { verticalFov } from './FirstPersonCamera';
it('does not fill visibility holes from remembered terrain', () => {
  expect(visibilityMask(viewFixture({ visibleCells: [] })).cells).toEqual([]);
  expect(visibilityMask(viewFixture({ visibleCells: [{ x: 10, y: 10 }] })).cells).toEqual([]);
});
it('uses the watched runner as the visibility origin for a spectator', () => {
  const view = viewFixture({
    self: { playerId: 'self', role: 'runner', status: 'CAPTURED' },
    spectating: {
      targetId: 'runner-a',
      cell: { x: 7, y: 8 },
      dir: 1,
      action: null,
      candidates: ['runner-a'],
    },
    visibleCells: [
      { x: 7, y: 8 },
      { x: 10, y: 8 },
      { x: 11, y: 8 },
    ],
    visibleEntities: [
      { id: 'runner-a', kind: 'player', cell: { x: 7, y: 8 }, dir: 1, action: null },
      { id: 'tagger-a', kind: 'player', cell: { x: 8, y: 8 }, dir: 3, action: null },
    ],
  });

  expect(visibilityMask(view)).toMatchObject({
    cells: [
      { x: 7, y: 8 },
      { x: 10, y: 8 },
    ],
    players: [{ id: 'tagger-a' }],
  });
});
it('keeps eighty degrees horizontally across screen ratios', () => {
  for (const aspect of [9 / 16, 16 / 9, 32 / 9])
    expect(
      (2 * Math.atan(Math.tan((verticalFov(aspect) * Math.PI) / 360) * aspect) * 180) / Math.PI,
    ).toBeCloseTo(80);
});

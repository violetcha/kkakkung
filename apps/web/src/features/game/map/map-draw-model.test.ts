import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { mapDrawModel } from './map-draw-model';
it('excludes other player coordinates and preserves only observed wall sides', () => {
  const model = mapDrawModel(
    viewFixture({
      visibleEntities: [
        { id: 'enemy', kind: 'player', cell: { x: 2, y: 1 }, dir: 0, action: null },
      ],
    }),
  );
  expect(JSON.stringify(model)).not.toContain('enemy');
  expect(model?.terrain.filter((t) => t.kind === 'wall')).toHaveLength(1);
});
it('removes the entire map after participation ends', () => {
  expect(
    mapDrawModel(viewFixture({ self: { playerId: 'self', role: 'runner', status: 'CAPTURED' } })),
  ).toBeNull();
});

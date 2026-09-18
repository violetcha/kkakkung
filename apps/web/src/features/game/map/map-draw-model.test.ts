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

it('draws the watched runner position and direction for a spectator', () => {
  const view = viewFixture({
    self: { playerId: 'self', role: 'runner', status: 'ESCAPED' },
    spectating: {
      targetId: 'runner-a',
      cell: { x: 9, y: 4 },
      dir: 3,
      action: null,
      candidates: ['runner-a'],
    },
  });

  expect(mapDrawModel(view, 0)).toMatchObject({
    self: { x: 9, z: 4 },
    exits: view.knownActiveExits,
  });
});
it('interpolates the watched runner action at the render tick', () => {
  const view = viewFixture({
    self: { playerId: 'self', role: 'runner', status: 'CAPTURED' },
    spectating: {
      targetId: 'runner-a',
      cell: { x: 2, y: 1 },
      dir: 1,
      action: {
        kind: 'move',
        from: { x: 1, y: 1, dir: 1 },
        to: { x: 2, y: 1, dir: 1 },
        startTick: 10,
        endTick: 20,
      },
      candidates: ['runner-a'],
    },
  });
  expect(mapDrawModel(view, 15)?.self).toMatchObject({ x: 1.5, z: 1 });
});
it('removes the entire map after participation ends', () => {
  expect(
    mapDrawModel(viewFixture({ self: { playerId: 'self', role: 'runner', status: 'CAPTURED' } })),
  ).toBeNull();
});

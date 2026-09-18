import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { exitPerspectivePlayerId } from './VisibleExits';
import { visibleExitModel } from './visible-exit-model';
it('requires currently visible matching wall side and removes closed portals', () => {
  expect(visibleExitModel(viewFixture())).toHaveLength(1);
  expect(visibleExitModel(viewFixture({ visibleWallFaces: [{ x: 1, y: 1, side: 1 }] }))).toEqual(
    [],
  );
  expect(visibleExitModel(viewFixture({ knownActiveExits: [] }))).toEqual([]);
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw new Error();
  expect(visibleExitModel({ ...view, self: { ...view.self, role: 'tagger' } })).toEqual([]);
});
it('renders exits from a watched runner projection', () => {
  const view = viewFixture({
    self: { playerId: 'self', role: 'runner', status: 'ESCAPED' },
    spectating: {
      targetId: 'runner-a',
      cell: { x: 1, y: 1 },
      dir: 0,
      action: null,
      candidates: ['runner-a'],
    },
  });
  expect(visibleExitModel(view)).toHaveLength(1);
  expect(exitPerspectivePlayerId(view)).toBe('runner-a');
});

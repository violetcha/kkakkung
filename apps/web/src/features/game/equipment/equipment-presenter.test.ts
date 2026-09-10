import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { equipmentPresenter, visibleEquipment } from './equipment-presenter';
it('keeps authoritative inventory and arming state while display time elapses', () => {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error();
  const v = {
    ...view,
    self: {
      ...view.self,
      role: 'tagger' as const,
      equipment: { sensor: 2, trap: 1 },
      installation: {
        installationId: 'install',
        kind: 'sensor' as const,
        startTick: 10,
        endTick: 20,
        armedTick: 40,
      },
      ownedEquipment: [
        {
          equipmentId: 'used',
          kind: 'trap' as const,
          cell: { x: 1, y: 1 },
          state: 'SPENT' as const,
          armedTick: 1,
        },
      ],
    },
  };
  expect(equipmentPresenter(v, 15)?.progress).toBe(0.5);
  expect(equipmentPresenter(v, 100)?.remaining.sensor).toBe(2);
  expect(equipmentPresenter(v, 100)?.owned[0]?.state).toBe('SPENT');
});
it('only renders recipient-visible equipment and uses non-owner sensor wall side', () => {
  const v = viewFixture({
    visibleEntities: [
      {
        id: 'other-sensor',
        kind: 'sensor',
        cell: { x: 2, y: 1 },
        wall: { x: 2, y: 1, side: 3 },
        state: 'ARMED',
      },
    ],
  });
  expect(visibleEquipment(v)).toEqual(v.visibleEntities);
  expect(equipmentPresenter(v, 0)).toBeNull();
  expect(visibleEquipment({ ...v, visibleEntities: [] })).toEqual([]);
});

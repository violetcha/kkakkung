import { expect, it } from 'vitest';
import { pastEventMarkers, type HunterMarker } from './past-event-markers';
import { viewFixture } from '../../room/product-fixture';
it('shows fixed fractional past points only to active taggers within the server TTL', () => {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error();
  const tagger = { ...view, self: { ...view.self, role: 'tagger' as const } };
  const markers: HunterMarker[] = [
    {
      markerId: 'marker',
      kind: 'exchange',
      point: { x: 4.5, y: 5 },
      occurredTick: 10,
      showAtTick: 30,
      expiresTick: 70,
    },
  ];
  expect(pastEventMarkers(tagger, markers, 29)).toEqual([]);
  expect(pastEventMarkers(tagger, markers, 30)[0]?.point.x).toBe(4.5);
  expect(pastEventMarkers(tagger, markers, 70)).toEqual([]);
  expect(pastEventMarkers(view, markers, 40)).toEqual([]);
  expect(pastEventMarkers(null, markers, 40)).toEqual([]);
});

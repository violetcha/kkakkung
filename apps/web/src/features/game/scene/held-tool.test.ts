import { expect, it } from 'vitest';
import type { ActiveSelf } from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';
import { HAND, defaultHeldTool } from './held-tool';

const self = (over: Partial<ActiveSelf>): ActiveSelf => {
  const base = viewFixture().self;
  if (base?.status !== 'ACTIVE') throw new Error('active fixture required');
  return { ...base, ...over };
};

it('shows a runner the map piece and a tagger the first device still in stock', () => {
  expect(defaultHeldTool(self({ role: 'runner' }))).toBe('map');
  expect(defaultHeldTool(self({ role: 'tagger', equipment: { sensor: 1, trap: 1 } }))).toBe(
    'sensor',
  );
  expect(defaultHeldTool(self({ role: 'tagger', equipment: { sensor: 0, trap: 1 } }))).toBe('trap');
  expect(defaultHeldTool(self({ role: 'tagger', equipment: { sensor: 0, trap: 0 } }))).toBeNull();
});

it('places the hand lower right, inside the fog start and in front of the near plane', () => {
  const [x, y, z] = HAND.offset;
  expect(x).toBeGreaterThan(0);
  expect(y).toBeLessThan(0);
  expect(-z).toBeGreaterThan(0.03);
  expect(-z).toBeLessThan(1.5);
});

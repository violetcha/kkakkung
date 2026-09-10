import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { restraintPresenter } from './restraint-presenter';

it('waits for an authoritative release after countdown reaches zero', () => {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error();
  const bound = { ...view, self: { ...view.self, restraintUntilTick: 100 } };
  expect(restraintPresenter(bound, 79)?.restraintSeconds).toBe(2);
  expect(restraintPresenter(bound, 101)?.restraintSeconds).toBe(0);
  const immune = { ...view, self: { ...view.self, restraintImmuneUntilTick: 120 } };
  expect(restraintPresenter(immune, 100)).toEqual({ restraintSeconds: null, immuneSeconds: 1 });
  expect(restraintPresenter(view, 200)).toBeNull();
  expect(restraintPresenter({ ...bound, self: null }, 200)).toBeNull();
  expect(bound.self.restraintUntilTick).toBe(100);
});

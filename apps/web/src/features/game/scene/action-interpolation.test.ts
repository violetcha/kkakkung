import { expect, it } from 'vitest';
import { sampleAction } from './action-interpolation';
it('clamps delayed movement and never extrapolates authoritative position', () => {
  const action = {
    kind: 'move' as const,
    from: { x: 1, y: 1, dir: 0 as const },
    to: { x: 1, y: 0, dir: 0 as const },
    startTick: 10,
    endTick: 19,
  };
  expect(sampleAction(action, 14.5).z).toBe(0.5);
  expect(sampleAction(action, 100).z).toBe(0);
  expect(action.from.y).toBe(1);
});
it('takes a quarter turn across west/north rather than a three-quarter turn', () => {
  const action = {
    kind: 'turn' as const,
    from: { x: 1, y: 1, dir: 3 as const },
    to: { x: 1, y: 1, dir: 0 as const },
    startTick: 10,
    endTick: 16,
  };
  expect(sampleAction(action, 16).yaw - sampleAction(action, 10).yaw).toBeCloseTo(-Math.PI / 2);
});

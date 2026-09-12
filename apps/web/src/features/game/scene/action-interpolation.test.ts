import { expect, it } from 'vitest';
import { sampleAction, sampleActor } from './action-interpolation';
import { renderFixture } from './render-fixture';
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
it.each([0, 1, 2, 3] as const)(
  'samples an approaching actor in facing %s without endpoint jumps',
  (facing) => {
    const player = renderFixture('복도', facing).visibleEntities[0]!;
    if (player.kind !== 'player' || !player.action) throw Error('moving player required');
    const start = sampleActor(player, 0);
    const middle = sampleActor(player, 10);
    const end = sampleActor(player, 20);
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeCloseTo(1);
    expect(middle.x).toBeCloseTo((start.x + end.x) / 2);
    expect(middle.z).toBeCloseTo((start.z + end.z) / 2);
    expect(sampleActor(player, -100)).toEqual(start);
    expect(sampleActor(player, 100)).toEqual(end);
    for (const unavailable of [null, NaN, Infinity]) {
      expect(sampleActor(player, unavailable)).toMatchObject({
        x: player.cell.x,
        z: player.cell.y,
      });
    }
  },
);

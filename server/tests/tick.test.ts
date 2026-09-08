import { expect, it } from 'vitest';
import { TickScheduler } from '../src/game/TickScheduler.js';

it('accumulates jitter into fixed steps and limits catch-up work', () => {
  const scheduler = new TickScheduler();
  let steps = 0;
  scheduler.advance(30, () => steps++);
  expect(steps).toBe(0);
  scheduler.advance(30, () => steps++);
  expect(steps).toBe(1);
  scheduler.advance(210, () => steps++);
  expect(steps).toBe(5);
});

it('aborts before doing stale simulation after severe event-loop delay', () => {
  const scheduler = new TickScheduler();
  let steps = 0;
  expect(() => scheduler.advance(251, () => steps++)).toThrow('TICK_OVERLOAD');
  expect(steps).toBe(0);
});

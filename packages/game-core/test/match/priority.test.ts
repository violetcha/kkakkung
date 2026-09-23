import { describe, expect, it } from 'vitest';

import {
  createPriorityOrder,
  priorityForTick,
  selectPriorityCandidate,
} from '../../src/match/priority.js';

describe('rotating priority', () => {
  const base = createPriorityOrder(['C', 'A', 'B'], 11);

  it('builds the base order from sorted ids regardless of input order', () => {
    expect(createPriorityOrder(['A', 'B', 'C'], 11)).toEqual(base);
    expect(createPriorityOrder(['B', 'C', 'A'], 11)).toEqual(base);
    expect(new Set(base).size).toBe(3);
    expect(() => createPriorityOrder(['A', 'A', 'B'], 1)).toThrow(RangeError);
  });

  it('rotates left by one each tick after startTick', () => {
    const [first, second, third] = base;
    expect(priorityForTick(base, 100, 100)).toEqual([first, second, third]);
    expect(priorityForTick(base, 101, 100)).toEqual([second, third, first]);
    expect(priorityForTick(base, 102, 100)).toEqual([third, first, second]);
    expect(priorityForTick(base, 103, 100)).toEqual([first, second, third]);
    expect(() => priorityForTick(base, 99, 100)).toThrow(RangeError);
  });

  it('selects the first candidate of the tick order; duplicates count once; empty gives undefined', () => {
    const [first, second] = base;
    expect(selectPriorityCandidate(base, 100, 100, [first, second])).toBe(first);
    expect(selectPriorityCandidate(base, 101, 100, [first, second])).toBe(second);
    expect(selectPriorityCandidate(base, 100, 100, [second, first, second])).toBe(
      selectPriorityCandidate(base, 100, 100, [first, second]),
    );
    expect(selectPriorityCandidate(base, 100, 100, [])).toBeUndefined();
    expect(selectPriorityCandidate(base, 100, 100, ['nobody'])).toBeUndefined();
  });

  it('serves trap candidates: single candidate wins, then the rotating winner among two', () => {
    const [first, second, third] = base;
    expect(selectPriorityCandidate(base, 200, 100, [third])).toBe(third);
    // (200-100) % 3 = 1 -> order [second, third, first]
    expect(selectPriorityCandidate(base, 200, 100, [first, second])).toBe(second);
    expect(selectPriorityCandidate(base, 201, 100, [first, second])).toBe(first);
  });

  it('keeps the three-runner order of a seed exactly as before the variable-length change', () => {
    // S15P21C204-350. Pinned from the fixed-triple implementation: 3:3 replays must not move.
    expect(base).toEqual(['A', 'C', 'B']);
  });

  it('serves a 2:2 match: both runner ids, rotation alternating every tick (S15P21C204-350)', () => {
    const pair = createPriorityOrder(['B', 'A'], 11);
    expect([...pair].sort()).toEqual(['A', 'B']);
    expect(createPriorityOrder(['A', 'B'], 11)).toEqual(pair);
    const [first, second] = pair as readonly [string, string];
    expect(priorityForTick(pair, 100, 100)).toEqual([first, second]);
    expect(priorityForTick(pair, 101, 100)).toEqual([second, first]);
    expect(priorityForTick(pair, 102, 100)).toEqual([first, second]);
    expect(selectPriorityCandidate(pair, 101, 100, [first, second])).toBe(second);
    expect(selectPriorityCandidate(pair, 102, 100, [first, second])).toBe(first);
    // One runner is a fixed order; none, or more than a team, is refused.
    expect(createPriorityOrder(['A'], 3)).toEqual(['A']);
    expect(() => createPriorityOrder([], 1)).toThrow(RangeError);
    expect(() => createPriorityOrder(['A', 'B', 'C', 'D'], 1)).toThrow(RangeError);
  });

  it('is deterministic per seed and differs across seeds for at least one of several seeds', () => {
    expect(createPriorityOrder(['A', 'B', 'C'], 5)).toEqual(
      createPriorityOrder(['A', 'B', 'C'], 5),
    );
    const orders = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((s) => createPriorityOrder(['A', 'B', 'C'], s).join()),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});

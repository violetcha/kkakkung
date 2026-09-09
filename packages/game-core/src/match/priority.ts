import { createRng, shuffle } from './random.js';

/**
 * Seeded base order of exactly three runner IDs. Built once per match from the
 * sorted IDs so participant array order and transport order never matter.
 */
export type PriorityOrder = readonly [string, string, string];

export function createPriorityOrder(runnerIds: readonly string[], seed: number): PriorityOrder {
  const unique = new Set(runnerIds);
  if (runnerIds.length !== 3 || unique.size !== 3) {
    throw new RangeError('priority order needs exactly three distinct runner ids');
  }
  const sorted = [...runnerIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const shuffled = shuffle(createRng(seed), sorted).items;
  return Object.freeze([shuffled[0]!, shuffled[1]!, shuffled[2]!]);
}

/** Order for a tick: base order rotated left by (tick - startTick) mod 3. */
export function priorityForTick(
  baseOrder: PriorityOrder,
  tick: number,
  startTick: number,
): PriorityOrder {
  if (!Number.isInteger(tick) || !Number.isInteger(startTick) || tick < startTick) {
    throw new RangeError('tick must be an integer at or after startTick');
  }
  const shift = (tick - startTick) % 3;
  return Object.freeze([
    baseOrder[shift]!,
    baseOrder[(shift + 1) % 3]!,
    baseOrder[(shift + 2) % 3]!,
  ]) as PriorityOrder;
}

/**
 * Picks the first ID of the tick order that is present in `candidates`.
 * Duplicates in candidates count once; an empty set yields undefined. Callers
 * apply ACTIVE/restraint/grace filters before calling.
 */
export function selectPriorityCandidate(
  baseOrder: PriorityOrder,
  tick: number,
  startTick: number,
  candidates: Iterable<string>,
): string | undefined {
  const set = new Set(candidates);
  if (set.size === 0) return undefined;
  for (const id of priorityForTick(baseOrder, tick, startTick)) {
    if (set.has(id)) return id;
  }
  return undefined;
}

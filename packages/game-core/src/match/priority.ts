import { createRng, shuffle } from './random.js';

/** A team holds at most three runners (RL-01); the showcase room fields two (S15P21C204-350). */
export const MAX_RUNNERS = 3;

/**
 * Seeded base order of the match's runner IDs, one to three of them. Built once per match from
 * the sorted IDs so participant array order and transport order never matter. The length is the
 * runner count; a three-runner order is byte for byte what the fixed triple used to produce.
 */
export type PriorityOrder = readonly string[];

export function createPriorityOrder(runnerIds: readonly string[], seed: number): PriorityOrder {
  const unique = new Set(runnerIds);
  if (
    runnerIds.length === 0 ||
    runnerIds.length > MAX_RUNNERS ||
    unique.size !== runnerIds.length
  ) {
    throw new RangeError('priority order needs one to three distinct runner ids');
  }
  const sorted = [...runnerIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.freeze([...shuffle(createRng(seed), sorted).items]);
}

/** Order for a tick: base order rotated left by (tick - startTick) mod its length. */
export function priorityForTick(
  baseOrder: PriorityOrder,
  tick: number,
  startTick: number,
): PriorityOrder {
  if (!Number.isInteger(tick) || !Number.isInteger(startTick) || tick < startTick) {
    throw new RangeError('tick must be an integer at or after startTick');
  }
  const length = baseOrder.length;
  const shift = (tick - startTick) % length;
  return Object.freeze(baseOrder.map((_, index) => baseOrder[(shift + index) % length]!));
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

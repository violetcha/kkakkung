import {
  createPriorityOrder,
  priorityForTick,
  selectPriorityCandidate,
} from '../../src/match/priority.js';

export type PriorityReplayInput = Readonly<{
  runnerIds: readonly [string, string, string];
  seed: number;
  startTick: number;
  observations: readonly Readonly<{
    tick: number;
    candidateIds: readonly string[];
  }>[];
}>;

export type PriorityReplayResult = Readonly<{
  baseOrder: readonly [string, string, string];
  decisions: readonly Readonly<{
    tick: number;
    priorityOrder: readonly [string, string, string];
    candidateIds: readonly string[];
    selectedId: string | undefined;
  }>[];
}>;

export function replayPriorityDecisions(input: PriorityReplayInput): PriorityReplayResult {
  const baseOrder = createPriorityOrder(input.runnerIds, input.seed);
  return {
    baseOrder,
    decisions: input.observations.map(({ tick, candidateIds }) => ({
      tick,
      priorityOrder: priorityForTick(baseOrder, tick, input.startTick),
      candidateIds: [...candidateIds],
      selectedId: selectPriorityCandidate(baseOrder, tick, input.startTick, candidateIds),
    })),
  };
}

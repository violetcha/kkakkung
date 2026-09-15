import { describe, expect, it } from 'vitest';

import { replayPriorityDecisions } from './priority-replay.js';

describe('same seed and tick priority replay', () => {
  it('replays the verified QA-07 simultaneous trap candidate decision', () => {
    const replay = replayPriorityDecisions({
      runnerIds: ['r-a', 'r-b', 'r-c'],
      seed: 20260910,
      startTick: 1,
      observations: [{ tick: 50, candidateIds: ['r-a', 'r-b'] }],
    });

    expect(replay).toEqual({
      baseOrder: ['r-c', 'r-b', 'r-a'],
      decisions: [
        {
          tick: 50,
          priorityOrder: ['r-b', 'r-a', 'r-c'],
          candidateIds: ['r-a', 'r-b'],
          selectedId: 'r-b',
        },
      ],
    });
  });

  it('keeps the verdict stable when the same candidates arrive in a different order', () => {
    const forward = replayPriorityDecisions({
      runnerIds: ['r-a', 'r-b', 'r-c'],
      seed: 20260910,
      startTick: 1,
      observations: [{ tick: 51, candidateIds: ['r-a', 'r-b'] }],
    });
    const reversed = replayPriorityDecisions({
      runnerIds: ['r-c', 'r-b', 'r-a'],
      seed: 20260910,
      startTick: 1,
      observations: [{ tick: 51, candidateIds: ['r-b', 'r-a'] }],
    });

    expect(forward.decisions[0]).toMatchObject({
      priorityOrder: ['r-a', 'r-c', 'r-b'],
      selectedId: 'r-a',
    });
    expect(reversed.decisions[0]).toMatchObject({
      priorityOrder: ['r-a', 'r-c', 'r-b'],
      selectedId: 'r-a',
    });
  });
});

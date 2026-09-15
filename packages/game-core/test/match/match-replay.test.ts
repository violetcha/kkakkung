import { describe, expect, it } from 'vitest';

import { command, player } from './match-fixture.js';
import { replayMatchCommands } from './match-replay.js';

describe('same seed and tick command replay', () => {
  it('replays sparse command rows through every authoritative tick', () => {
    const replay = replayMatchCommands({
      seed: 20260910,
      startTick: 1,
      commandRows: [
        {
          tick: 2,
          commands: [
            command(
              'r-a',
              'TURN',
              { direction: 'left' },
              { requestId: 'replay-turn', sequence: 1 },
            ),
          ],
        },
        {
          tick: 5,
          commands: [
            command(
              'r-b',
              'MOVE_INTENT',
              { direction: null },
              { requestId: 'replay-stop', sequence: 1 },
            ),
          ],
        },
      ],
    });

    expect(replay.processedTicks).toEqual([1, 2, 3, 4, 5]);
    expect(replay.rows.map((row) => row.outcomes.map((outcome) => outcome.requestId))).toEqual([
      ['replay-turn'],
      ['replay-stop'],
    ]);
    expect(replay.state.tick).toBe(5);
    expect(replay.state.seed).toBe(20260910);
    expect(replay.state.priority).toEqual(['r-c', 'r-b', 'r-a']);
    expect(player(replay.state, 'r-a').action).toMatchObject({ kind: 'turn' });
  });

  it('rejects command rows that do not advance from the recorded start tick', () => {
    expect(() =>
      replayMatchCommands({
        seed: 20260910,
        startTick: 1,
        commandRows: [
          { tick: 3, commands: [] },
          { tick: 3, commands: [] },
        ],
      }),
    ).toThrow('command row ticks must strictly increase after startTick');
  });
});

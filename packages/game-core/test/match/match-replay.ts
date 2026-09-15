import type { CoreCommand, StepResult } from '../../src/match/core-types.js';
import { stepMatch, type MatchState } from '../../src/match/engine.js';
import { createTestMatch } from './match-fixture.js';

export type MatchReplayInput = Readonly<{
  seed: number;
  startTick: number;
  commandRows: readonly Readonly<{
    tick: number;
    commands: readonly CoreCommand[];
  }>[];
}>;

export type MatchReplayResult = Readonly<{
  processedTicks: readonly number[];
  rows: readonly StepResult<MatchState>[];
  state: MatchState;
}>;

export function replayMatchCommands(input: MatchReplayInput): MatchReplayResult {
  let opened = stepMatch(createTestMatch({ seed: input.seed }), {
    tick: input.startTick,
    commands: [],
    controls: [{ type: 'START_PLAYING', startTick: input.startTick }],
  });
  const processedTicks = [input.startTick];
  const rows: StepResult<MatchState>[] = [];
  let previousTick = input.startTick;

  for (const row of input.commandRows) {
    if (!Number.isInteger(row.tick) || row.tick <= previousTick) {
      throw new RangeError('command row ticks must strictly increase after startTick');
    }
    for (let tick = previousTick + 1; tick < row.tick; tick += 1) {
      opened = stepMatch(opened.state, { tick, commands: [], controls: [] });
      processedTicks.push(tick);
    }
    opened = stepMatch(opened.state, { tick: row.tick, commands: row.commands, controls: [] });
    processedTicks.push(row.tick);
    rows.push(opened);
    previousTick = row.tick;
  }

  return { processedTicks, rows, state: opened.state };
}

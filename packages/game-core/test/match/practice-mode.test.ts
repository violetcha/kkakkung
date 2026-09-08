import { describe, expect, it } from 'vitest';

import { createPractice, getFrame, getPlayerSelf } from '../../src/match/engine.js';
import {
  command,
  createTestMatch,
  createTestPractice,
  player,
  step,
  tuning,
} from './match-fixture.js';

describe('practice mode', () => {
  it('runs movement with the same rules in TEAM_PRACTICE without START_PLAYING or a deadline', () => {
    const practice = createTestPractice('runner', ['p1', 'p2', 'p3']);
    expect(getFrame(practice)).toMatchObject({
      phase: 'TEAM_PRACTICE',
      gameInstanceId: 'practice-runner',
    });
    expect(practice.deadlineTick).toBeNull();
    // No runner-triple priority and no exit registry: the 6-player invariants are not reused.
    expect(practice.priority).toBeNull();
    expect(practice.exits.size).toBe(0);
    const p1 = player(practice, 'p1');
    const result = step(practice, 501, [command('p1', 'MOVE_INTENT', { direction: 'forward' })]);
    expect(result.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(result.state, 'p1').action).toMatchObject({ startTick: 501, endTick: 510 });
    expect(player(result.state, 'p1').action?.from).toEqual({ ...p1.cell, dir: p1.dir });
    expect(getPlayerSelf(result.state, 'p1')).toMatchObject({ status: 'ACTIVE', loading: null });
  });

  it('keeps practice and game instances of the same match separate', () => {
    const game = createTestMatch({ matchId: 'match-1', gameInstanceId: 'game-1' });
    const practiceRunners = createTestPractice('runner', ['r-a', 'r-b']);
    const practiceTaggers = createTestPractice('tagger', ['t-a']);
    expect(getFrame(game).gameInstanceId).toBe('game-1');
    expect(getFrame(practiceRunners).gameInstanceId).toBe('practice-runner');
    expect(getFrame(practiceTaggers).gameInstanceId).toBe('practice-tagger');
    const moved = step(practiceRunners, 700, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]);
    expect(player(moved.state, 'r-a').action).not.toBeNull();
    expect(player(game, 'r-a').action).toBeNull();
    expect(getFrame(moved.state).tick).toBe(700);
    expect(getFrame(game).tick).toBe(0);
  });

  it('applies START_PLAYING once to a game and never re-times it; practice ignores it', () => {
    const game = createTestMatch();
    const started = step(game, 500, [], [{ type: 'START_PLAYING', startTick: 500 }]).state;
    expect(started).toMatchObject({ phase: 'PLAYING', startTick: 500, deadlineTick: 4100 });
    const again = step(started, 600, [], [{ type: 'START_PLAYING', startTick: 600 }]).state;
    expect(again).toMatchObject({ phase: 'PLAYING', startTick: 500, deadlineTick: 4100 });
    const practice = createTestPractice('tagger', ['t-a', 't-b', 't-c']);
    const ignored = step(practice, 10, [], [{ type: 'START_PLAYING', startTick: 10 }]).state;
    expect(ignored).toMatchObject({ phase: 'TEAM_PRACTICE', startTick: null, deadlineTick: null });
  });

  it('rejects rosters that break the practice limits', () => {
    const base = createTestPractice('runner', ['p1']);
    expect(() =>
      createPractice({
        matchId: 'm',
        gameInstanceId: 'g',
        seed: 1,
        tuning: tuning(),
        layout: base.layout,
        players: [],
        role: 'runner',
      }),
    ).toThrow(RangeError);
    expect(() =>
      createPractice({
        matchId: 'm',
        gameInstanceId: 'g',
        seed: 1,
        tuning: tuning(),
        layout: base.layout,
        players: [{ playerId: 'p1', role: 'tagger' }],
        role: 'runner',
      }),
    ).toThrow(RangeError);
  });
});

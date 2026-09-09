import { describe, expect, it } from 'vitest';
import { PracticeCoordinator } from '../../src/rooms/PracticeCoordinator.js';
import { FakeCore, fakePracticePort, openTopology, testTuning } from './test-harness.js';

const roles = new Map([
  ['r1', 'runner' as const],
  ['r2', 'runner' as const],
  ['r3', 'runner' as const],
  ['t1', 'tagger' as const],
  ['t2', 'tagger' as const],
  ['t3', 'tagger' as const],
]);

describe('team practice', () => {
  it('splits the six into two isolated teams and ends early when everyone reports ready', () => {
    const practice = new PracticeCoordinator();
    const teams = practice.start(roles, 0);
    expect(teams.runner).toEqual(['r1', 'r2', 'r3']);
    expect(teams.tagger).toEqual(['t1', 't2', 't3']);
    expect(practice.teamOf('r1')).toBe('runner');
    expect(practice.applyPracticeReady('ghost', true)).toEqual({
      result: 'rejected',
      code: 'INVALID_PHASE',
    });
    for (const id of [...roles.keys()])
      expect(practice.applyPracticeReady(id, true)).toEqual({ result: 'applied', code: null });
    expect(practice.evaluate(45_000, [...roles.keys()])).toBe('end-all-ready');
  });

  it('times out at 60 seconds and returns to DEVICE_CHECK when a device report was withdrawn', () => {
    const practice = new PracticeCoordinator();
    practice.start(roles, 1000);
    expect(practice.evaluate(60_999, [...roles.keys()])).toBe('continue');
    expect(practice.evaluate(61_000, [...roles.keys()])).toBe('end-timeout');
    expect(practice.next([...roles.keys()], (id) => id !== 't2')).toBe('to-device-check');
    expect(practice.next([...roles.keys()], () => true)).toBe('to-map-finalizing');
    practice.stop();
    expect(practice.active).toBe(false);
    expect(practice.applyPracticeReady('r1', true)).toEqual({
      result: 'rejected',
      code: 'INVALID_PHASE',
    });
  });

  it('creates separate practice states per team through the practice port with current ids only', () => {
    const core = new FakeCore();
    const runners = [...roles]
      .filter(([, r]) => r === 'runner')
      .map(([playerId, role]) => ({ playerId, role }));
    const taggers = [...roles]
      .filter(([, r]) => r === 'tagger')
      .map(([playerId, role]) => ({ playerId, role }));
    const prepared = fakePracticePort.preparePracticeLayout(
      { practiceVersion: 'p1' },
      runners,
      'runner',
    );
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    expect(prepared.layout.exits).toEqual([]);
    expect(prepared.layout.players.map((p) => p.playerId)).toEqual(['r1', 'r2', 'r3']);
    const runnerState = core.createPractice({
      matchId: 'm',
      gameInstanceId: 'practice-runners',
      seed: 1,
      tuning: testTuning,
      layout: prepared.layout,
      players: runners,
      role: 'runner',
    });
    const taggerLayout = fakePracticePort.preparePracticeLayout(
      { practiceVersion: 'p1' },
      taggers,
      'tagger',
    );
    if (taggerLayout.status !== 'ready') throw new Error('expected ready');
    const taggerState = core.createPractice({
      matchId: 'm',
      gameInstanceId: 'practice-taggers',
      seed: 1,
      tuning: testTuning,
      layout: taggerLayout.layout,
      players: taggers,
      role: 'tagger',
    });
    expect(runnerState).not.toBe(taggerState);
    expect(core.getFrame(runnerState).participants.map((p) => p.playerId)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
    expect(core.getFrame(taggerState).participants.map((p) => p.playerId)).toEqual([
      't1',
      't2',
      't3',
    ]);
    expect(core.getFrame(runnerState).phase).toBe('TEAM_PRACTICE');
    // Mixed roles, four players or bad data return to preparation instead of a static slot layout.
    expect(fakePracticePort.preparePracticeLayout({}, runners, 'runner').status).toBe('invalid');
    expect(
      fakePracticePort.preparePracticeLayout(
        { practiceVersion: 'p1' },
        [...runners, taggers[0]!],
        'runner',
      ).status,
    ).toBe('invalid');
    expect(
      fakePracticePort.preparePracticeLayout(
        { practiceVersion: 'p1' },
        [...runners, { playerId: 'r4', role: 'runner' }],
        'runner',
      ).status,
    ).toBe('invalid');
    expect(openTopology(8, 8).walkable).toHaveLength(64);
  });
});

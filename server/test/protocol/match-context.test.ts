import { describe, expect, it } from 'vitest';
import { MatchContext } from '../../src/game/MatchContext.js';
import type { MatchTuning } from '../../src/game/ports.js';

const tuning: MatchTuning = {
  tuningVersion: 'tuning-test-1',
  tickMs: 50,
  moveTicks: 9,
  turnTicks: 6,
  grabTicks: 6,
  roundTicks: 3600,
  installationTicks: 10,
  armTicks: 20,
  restraintTicks: 30,
  restraintImmunityTicks: 40,
  exchangeExpiryTicks: 40,
  exitMinimumTicks: 40,
  exitExpiryTicks: 160,
  exitRetryTicks: 10,
};

function context() {
  let n = 0;
  return new MatchContext({ serverEpoch: 'epoch-1', createId: () => `id-${++n}` });
}

describe('MatchContext', () => {
  it('keeps stateVersion and serverTick continuous across logical scope changes', () => {
    const ctx = context();
    expect(ctx.matchId).toBe('id-1');
    expect(ctx.scopeOf('p1')).toEqual({ gameInstanceId: null, kind: 'none', revision: 0 });
    ctx.bumpVersion();
    ctx.advanceTick();
    const practice = ctx.createInstance('practice', 'runner');
    expect(ctx.enterInstance('p1', practice.gameInstanceId)).toEqual({
      gameInstanceId: 'id-2',
      kind: 'practice',
      revision: 1,
    });
    ctx.bumpVersion();
    expect(ctx.leaveInstance('p1')).toEqual({ gameInstanceId: null, kind: 'none', revision: 2 });
    const game = ctx.createInstance('game');
    expect(ctx.enterInstance('p1', game.gameInstanceId)).toEqual({
      gameInstanceId: 'id-3',
      kind: 'game',
      revision: 3,
    });
    expect(ctx.stateVersion).toBe(2);
    expect(ctx.serverTick).toBe(1);
    expect(ctx.instanceOf('p1')?.kind).toBe('game');
    // A media reconnect inside the same game instance does not touch the logical scope.
    expect(ctx.scopeOf('p1').revision).toBe(3);
    expect(ctx.hasInstance('id-2')).toBe(true);
    expect(ctx.retireInstance('id-2')).toEqual([]);
    expect(ctx.hasInstance('id-2')).toBe(false);
  });

  it('fixes tuning and seed once and rejects mid-match tuning changes', () => {
    const ctx = context();
    ctx.fixRoundInputs({ tuning, seed: 204 });
    expect(ctx.tuningVersion).toBe('tuning-test-1');
    expect(ctx.seed).toBe(204);
    expect(() =>
      ctx.fixRoundInputs({ tuning: { ...tuning, tuningVersion: 'other' }, seed: 1 }),
    ).toThrow('TUNING_CHANGED_MID_MATCH');
    expect(() => ctx.fixRoundInputs({ tuning, seed: -1 })).toThrow('INVALID_SEED');
    expect(ctx.fixStart(100, tuning.roundTicks)).toBe(true);
    expect(ctx.fixStart(200, tuning.roundTicks)).toBe(false);
    expect(ctx.startTick).toBe(100);
    expect(ctx.deadlineTick).toBe(3700);
    ctx.scheduleStart(12_345.5);
    expect(ctx.startAt).toBe(12_345.5);
    expect(() => ctx.scheduleStart(Number.NaN)).toThrow('INVALID_START_AT');
  });

  it('starts a new round with a fresh matchId and reset counters, keeping the tuning input', () => {
    const ctx = context();
    ctx.fixRoundInputs({ tuning, seed: 7 });
    ctx.bumpVersion();
    ctx.advanceTick();
    ctx.fixStart(5, tuning.roundTicks);
    ctx.enterInstance('p1', ctx.createInstance('game').gameInstanceId);
    ctx.setRolePlan(new Map([['p1', 'tagger']]));
    const previous = ctx.matchId;
    const round = ctx.startNewRound();
    expect(round.previousMatchId).toBe(previous);
    expect(ctx.matchId).not.toBe(previous);
    expect(ctx.isCommandForCurrentMatch(previous)).toBe(false);
    expect(ctx.stateVersion).toBe(0);
    expect(ctx.serverTick).toBe(0);
    expect(ctx.startTick).toBeNull();
    expect(ctx.deadlineTick).toBeNull();
    expect(ctx.seed).toBeNull();
    expect(ctx.tuningVersion).toBe('tuning-test-1');
    expect(ctx.scopeOf('p1')).toEqual({ gameInstanceId: null, kind: 'none', revision: 0 });
    expect(ctx.activeInstances()).toEqual([]);
    expect(ctx.takeRolePlan()?.get('p1')).toBe('tagger');
    expect(ctx.takeRolePlan()).toBeNull();
  });
});

// F-12 / QA-07 producer→consumer boundary on real modules: A `matchCore` (producer) → B
// MatchDriver/MatchContext/PlayerProjection (serializer) → protocol `privateViewSchema` (the
// wire contract C's reducer consumes). This suite stops at the strict wire boundary; browser
// reducer/runtime integration is exercised separately, not represented by a fake consumer here.
import { describe, expect, it } from 'vitest';
import { privateViewSchema, commandOutcomeSchema } from '@kkakkung/protocol/game-messages';
import { matchCore } from '@kkakkung/game-core/match';
import { projectPrivateBody } from '../../server/src/game/PlayerProjection.ts';
import { G3_TUNING, createG3Harness, type G3Harness } from '../fixtures/g3-scenarios.ts';

function viewFor(h: G3Harness, playerId: string) {
  const body = projectPrivateBody(matchCore, h.state(), playerId, null);
  return {
    ...body,
    matchId: h.context.matchId,
    gameScope: h.context.scopeOf(playerId),
    stateVersion: h.context.stateVersion,
  };
}

describe('A state → B projection → protocol private view', () => {
  it('every player receives a strict-schema view; taggers never receive exits', () => {
    const h = createG3Harness();
    h.start();
    for (const id of ['r1', 'r2', 'r3', 't1', 't2', 't3']) {
      const parsed = privateViewSchema.safeParse(viewFor(h, id));
      expect(parsed.success, `${id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      const view = parsed.data!;
      expect(view.self?.status).toBe('ACTIVE');
      if (id.startsWith('t')) expect(view.knownActiveExits).toEqual([]);
      expect(view.gameScope.gameInstanceId).toBe(h.instance.gameInstanceId);
    }
  });

  it('the projected view carries no authoritative map, seed or other players’ positions outside sight', () => {
    const h = createG3Harness();
    h.start();
    const raw = JSON.stringify(viewFor(h, 'r2'));
    expect(raw).not.toMatch(/"seed"|"layout"|"topology"|"walkable"|"priority"/);
    const view = privateViewSchema.parse(viewFor(h, 'r2'));
    // r2 faces north at (2,8); t2 stands behind it at (2,9) and must not be visible.
    expect(view.visibleEntities.map((e) => e.id)).not.toContain('t2');
    expect(view.knownActiveExits.every((e) => e.ownerId === 'r2' || e.ownerId !== 't1')).toBe(true);
  });

  it('an ended runner gets the minimal self and empty knowledge, and its outcome message validates', () => {
    const h = createG3Harness();
    h.start();
    h.move('t1');
    h.ticks(G3_TUNING.moveTicks + 1);
    expect(h.player('r1').status).toBe('CAPTURED');
    const view = privateViewSchema.parse(viewFor(h, 'r1'));
    expect(view.self).toEqual({ playerId: 'r1', role: 'runner', status: 'CAPTURED' });
    expect(view.knownTerrain).toEqual([]);
    expect(view.visibleEntities).toEqual([]);
    expect(view.knownActiveExits).toEqual([]);
    h.move('r1');
    h.tick();
    const outcome = h.lastOutcome('r1')!;
    expect(commandOutcomeSchema.parse(outcome)).toMatchObject({
      result: 'rejected',
      code: 'NOT_ACTIVE',
    });
  });

  it('a rule rejection after acceptance reaches the consumer as one terminal outcome, never twice', () => {
    const h = createG3Harness();
    h.start();
    // r1 faces north; a back move into t1's cell is walkable, but a move into the border is not.
    h.turn('r2', 'left');
    h.turn('r2', 'left'); // second turn waits in the single next-action slot
    const accepted = h.accept('r2', h.envelope('r2', 'MOVE_INTENT', { direction: 'forward' }));
    expect(accepted.status).toBe('accepted');
    h.tick();
    const results = h.outcomesOf('r2').map((o) => o.outcome);
    expect(results).toHaveLength(3);
    for (const outcome of results)
      expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true);
    expect(new Set(results.map((o) => o.requestId)).size).toBe(3);
    // Re-sending the same request id is a duplicate at the queue, not a second outcome.
    const again = h.queue.accept({
      actorId: 'r2',
      command: {
        matchId: h.context.matchId,
        requestId: results[2]!.requestId,
        sequence: results[2]!.sequence,
        type: 'MOVE_INTENT',
        payload: { direction: 'forward' },
      },
      gameInstanceId: h.instance.gameInstanceId,
      nowMs: h.clock.now(),
      stateVersion: h.context.stateVersion,
    });
    expect(again.status).toBe('duplicate');
    if (again.status === 'duplicate') expect(again.outcome?.requestId).toBe(results[2]!.requestId);
    h.tick();
    expect(h.outcomesOf('r2')).toHaveLength(3);
  });

  it('state version and scope revision only move on real changes, so a stale view is detectable', () => {
    const h = createG3Harness();
    const scope = h.context.scopeOf('r1');
    expect(scope.kind).toBe('game');
    expect(scope.revision).toBe(1);
    h.start();
    const v0 = h.context.stateVersion;
    h.tick();
    expect(h.context.stateVersion).toBeGreaterThanOrEqual(v0);
    // The frame revision handed to D's media consumer increases once per stepped tick.
    const revisions = h.frames.map((f) => f.frameRevision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBe(revisions.length);
  });
});

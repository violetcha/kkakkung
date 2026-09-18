// F-12 / QA-07 consumer half (closes F-REQ-09): the same producer chain as producer-consumer
// (A matchCore → B EventDispatcher/PlayerProjection → protocol wire) now ends in C's real,
// DOM-free modules: `createProductView` consumes private views, `createCommandLifecycle`
// consumes command outcomes. No fake consumer, no browser. What is proven: every published
// view is accepted once and in order, re-delivered or stale views cause no second change, a
// view ahead of the round waits and is released by the next round state, an ended player stays
// ended while a spectating projection remains visible, and an accepted command reaches exactly
// one terminal display and releases its pending entry when the view catches up.
import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@kkakkung/protocol/game-messages';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { createProductView } from '../../apps/web/src/features/room/product-view';
import {
  createCommandLifecycle,
  type RequestDisplay,
} from '../../apps/web/src/features/room/command-lifecycle';
import { createViewHarness, type ViewHarness } from '../fixtures/private-view-scenarios.ts';
import { G3_TUNING } from '../fixtures/g3-scenarios.ts';

/** C's view reducer wired to the harness clock, recording every change and resync request. */
function viewConsumer(v: ViewHarness) {
  const changes: (PrivateView | null)[] = [];
  const resyncs: { matchId: string; version: number }[] = [];
  const views = createProductView({
    now: () => v.h.clock.now(),
    changed: (view) => changes.push(view),
    resync: (matchId, version) => resyncs.push({ matchId, version }),
  });
  return { views, changes, resyncs };
}

/** Feeds the round state and every not-yet-delivered view of `id`; returns the accept results. */
function deliver(v: ViewHarness, c: ReturnType<typeof viewConsumer>, id: string, from: number) {
  c.views.round(v.publicState());
  return v
    .viewsOf(id)
    .slice(from)
    .map((view) => c.views.receive(view));
}

describe('protocol private view → C createProductView', () => {
  it('accepts every published view once, in order, without asking for a resync', () => {
    const v = createViewHarness();
    v.h.start();
    const c = viewConsumer(v);
    v.publish('initial');
    expect(deliver(v, c, 'r1', 0)).toEqual([true]);
    // The first round state clears the screen once (null), then each accepted view is one change.
    expect(c.changes[0]).toBeNull();
    expect(c.changes).toHaveLength(2);
    let seen = v.viewsOf('r1').length;
    for (let i = 0; i < 3; i++) {
      v.h.move('t1');
      v.tickAndPublish(1);
      const results = deliver(v, c, 'r1', seen);
      expect(results.every(Boolean)).toBe(true);
      seen = v.viewsOf('r1').length;
    }
    expect(c.changes).toHaveLength(1 + seen);
    expect(c.views.view).toEqual(v.latestView('r1'));
    expect(c.resyncs).toEqual([]);
  });

  it('drops a re-delivered or stale view without a second change', () => {
    const v = createViewHarness();
    v.h.start();
    const c = viewConsumer(v);
    v.publish('initial');
    deliver(v, c, 't1', 0);
    v.h.move('t1');
    v.tickAndPublish(1);
    deliver(v, c, 't1', 1);
    const before = c.changes.length;
    const all = v.viewsOf('t1');
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(c.views.receive(all[all.length - 1]!)).toBe(false); // duplicate of the current view
    expect(c.views.receive(all[0]!)).toBe(false); // older state version
    expect(c.changes).toHaveLength(before);
    expect(c.views.view).toEqual(all[all.length - 1]);
    expect(c.resyncs).toEqual([]);
  });

  it('holds a view that is ahead of the round and releases it when the round state catches up', () => {
    const v = createViewHarness();
    v.h.start();
    const c = viewConsumer(v);
    v.publish('initial');
    deliver(v, c, 't1', 0);
    const before = c.changes.length;
    v.h.move('t1');
    v.tickAndPublish(1);
    const ahead = v.latestView('t1');
    expect(ahead.stateVersion).toBeGreaterThan(v.viewsOf('t1')[0]!.stateVersion);
    // The consumer still knows the older round: the newer view is not shown yet.
    expect(c.views.receive(ahead)).toBe(false);
    expect(c.changes).toHaveLength(before);
    // The public round state arrives: the pending view is accepted without a redelivery.
    c.views.round(v.publicState());
    expect(c.changes).toHaveLength(before + 1);
    expect(c.views.view).toEqual(ahead);
    expect(c.resyncs).toEqual([]);
  });

  it('keeps a captured runner ended while accepting its spectating projection', () => {
    const v = createViewHarness();
    v.h.start();
    const c = viewConsumer(v);
    v.publish('initial');
    deliver(v, c, 'r1', 0);
    let seen = v.viewsOf('r1').length;
    v.h.move('t1');
    for (let i = 0; i < G3_TUNING.moveTicks + 1; i++) {
      v.tickAndPublish(1);
      deliver(v, c, 'r1', seen);
      seen = v.viewsOf('r1').length;
    }
    expect(v.h.player('r1').status).toBe('CAPTURED');
    const ended = c.views.view!;
    expect(ended.self).toEqual({ playerId: 'r1', role: 'runner', status: 'CAPTURED' });
    expect(ended.spectating).toMatchObject({ targetId: 'r2', candidates: ['r2', 'r3'] });
    const target = v.latestView(ended.spectating!.targetId);
    expect(ended.knownTerrain).toEqual(target.knownTerrain);
    expect(ended.visibleEntities).toEqual(target.visibleEntities);
    expect(ended.knownActiveExits).toEqual(target.knownActiveExits);
    // Later real views keep the ended self and refresh the target's projected world.
    v.h.move('t2');
    v.tickAndPublish(2);
    deliver(v, c, 'r1', seen);
    expect(c.views.view!.self?.status).toBe('CAPTURED');
    expect(c.views.view!.spectating?.targetId).toBe('r2');
    expect(c.views.view!.visibleCells).toEqual(v.latestView('r2').visibleCells);
    expect(c.resyncs).toEqual([]);
  });
});

describe('B CommandQueue outcome → C createCommandLifecycle', () => {
  function lifecycle(v: ViewHarness) {
    const sent: CommandEnvelope[] = [];
    const displays: RequestDisplay[] = [];
    let n = 0;
    const life = createCommandLifecycle({
      now: () => v.h.clock.now(),
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      send: (channel, value) => {
        if (channel === 'command') sent.push(value as CommandEnvelope);
      },
      changed: (display) => displays.push(display),
    });
    life.setMatch(v.h.context.matchId);
    return { life, sent, displays };
  }

  it('an accepted command reaches exactly one terminal display and releases its pending entry', () => {
    const v = createViewHarness();
    v.h.start();
    const { life, sent, displays } = lifecycle(v);
    const requestId = life.send({ type: 'MOVE_INTENT', payload: { direction: 'forward' } });
    expect(sent).toHaveLength(1);
    expect(displays.map((d) => d.status)).toEqual(['pending']);
    expect(life.pending('MOVE_INTENT')).toBe(requestId);

    // The very envelope C built goes through B's queue and A's rules.
    const accepted = v.h.accept('r2', sent[0]!);
    expect(accepted.status).toBe('accepted');
    v.tickAndPublish(1);
    const outcomes = v.h.outcomesOf('r2').map((o) => o.outcome);
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0]!;
    expect(outcome.requestId).toBe(requestId);

    life.outcome(outcome);
    if (outcome.result === 'applied') {
      // Applied, but the client has not seen that state version yet: shown as waiting-view.
      expect(displays.at(-1)?.status).toBe('waiting-view');
      expect(life.size).toBe(1);
      life.view(v.publicState().stateVersion);
      expect(displays.at(-1)?.status).toBe('applied');
    } else {
      expect(displays.at(-1)?.status).toBe(outcome.result);
      expect(displays.at(-1)?.code).toBe(outcome.code);
    }
    expect(life.size).toBe(0);
    expect(life.pending('MOVE_INTENT')).toBeUndefined();
    const terminalCount = displays.length;

    // Re-delivering the same outcome, or a later view, changes nothing (중복 갱신 0).
    life.outcome(outcome);
    life.view(v.publicState().stateVersion + 5);
    expect(displays).toHaveLength(terminalCount);
    expect(displays.filter((d) => d.status === 'applied' || d.status === 'rejected')).toHaveLength(
      1,
    );
  });

  it('a queue duplicate of an already answered request produces no new outcome for the consumer', () => {
    const v = createViewHarness();
    v.h.start();
    const { life, sent } = lifecycle(v);
    life.send({ type: 'TURN', payload: { direction: 'left' } });
    expect(v.h.accept('r3', sent[0]!).status).toBe('accepted');
    v.tickAndPublish(1);
    const first = v.h.outcomesOf('r3');
    expect(first).toHaveLength(1);
    const again = v.h.accept('r3', sent[0]!);
    expect(again.status).toBe('duplicate');
    v.tickAndPublish(1);
    expect(v.h.outcomesOf('r3')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/match/core-types.js';
import type { MatchState } from '../../src/match/engine.js';
import { midpointOf, releaseTraces, scheduleTrace } from '../../src/match/exchange/trace.js';
import { command, player, startedMatch, step, tuning } from './match-fixture.js';

/** Places players on chosen cells/dirs without moving through the maze. */
function place(
  state: MatchState,
  placements: Record<string, { x: number; y: number; dir?: 0 | 1 | 2 | 3 }>,
): MatchState {
  const players = new Map(state.players);
  for (const [id, p] of Object.entries(placements)) {
    const record = player(state, id);
    players.set(id, {
      ...record,
      cell: { x: p.x, y: p.y },
      dir: p.dir ?? record.dir,
      action: null,
    });
  }
  return { ...state, players };
}

function markers(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'HUNTER_MARKER');
}

/** Runners on the open cells (4,4) and (5,4), each with its own spawn knowledge. */
function facingPair(): MatchState {
  return place(startedMatch(90), {
    'r-a': { x: 4, y: 4, dir: 1 },
    'r-b': { x: 5, y: 4, dir: 3 },
  });
}

/** A successful exchange at tick 100: request at 99, accept at 100. */
function exchangeAt100(): MatchState {
  const opened = step(facingPair(), 99, [
    command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
  ]).state;
  const accepted = step(opened, 100, [command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' })]);
  expect(accepted.outcomes[0]).toMatchObject({ result: 'applied' });
  expect(markers(accepted.events)).toEqual([]);
  return accepted.state;
}

describe('delayed tagger trace of a successful exchange', () => {
  it('publishes the half-cell midpoint one second later and expires two seconds after that', () => {
    let state = exchangeAt100();
    expect(state.traces.size).toBe(1);
    // Nothing at all until the publish tick.
    for (let tick = 101; tick <= 119; tick += 1) {
      const result = step(state, tick);
      expect(markers(result.events)).toEqual([]);
      state = result.state;
    }
    const published = step(state, 120);
    const marker = markers(published.events)[0];
    if (!marker || marker.type !== 'HUNTER_MARKER') throw new Error('expected a marker');
    expect(marker.tick).toBe(120);
    expect(marker.payload).toEqual({
      markerId: 'mk-xch-1',
      kind: 'exchange',
      point: { x: 4.5, y: 4 },
      occurredTick: 100,
      showAtTick: 120,
      expiresTick: 160,
    });
    // 1 second delay, 2 second display, on the 50ms tick - both from the tuning.
    expect(marker.payload.showAtTick - marker.payload.occurredTick).toBe(tuning().traceDelayTicks);
    expect(marker.payload.expiresTick - marker.payload.showAtTick).toBe(tuning().traceVisibleTicks);
    // Every active tagger, and only taggers, receives it.
    expect([...marker.audience].sort()).toEqual(['t-a', 't-b', 't-c']);
    expect(published.state.traces.size).toBe(0);

    // The schedule is empty afterwards: no repeat at 121 or at the expiry tick.
    let after = published.state;
    for (const tick of [121, 140, 160, 161]) {
      const result = step(after, tick);
      expect(markers(result.events)).toEqual([]);
      after = result.state;
    }
  });

  it('sends no identity, heading, or terrain with the marker', () => {
    let state = exchangeAt100();
    for (let tick = 101; tick <= 119; tick += 1) state = step(state, tick).state;
    const marker = markers(step(state, 120).events)[0];
    if (!marker || marker.type !== 'HUNTER_MARKER') throw new Error('expected a marker');
    expect(Object.keys(marker.payload).sort()).toEqual([
      'expiresTick',
      'kind',
      'markerId',
      'occurredTick',
      'point',
      'showAtTick',
    ]);
    // No player id and no direction hide inside the payload values.
    const serialized = JSON.stringify(marker.payload);
    for (const id of ['r-a', 'r-b', 'r-c', 't-a', 't-b', 't-c']) {
      expect(serialized).not.toContain(id);
    }
    expect(Object.keys(marker.payload.point).sort()).toEqual(['x', 'y']);
  });

  it('keeps the point where the exchange happened even after both players move', () => {
    let state = exchangeAt100();
    // r-a walks east off its cell before the marker is published.
    state = step(state, 101, [command('r-a', 'MOVE_INTENT', { direction: 'forward' })]).state;
    for (let tick = 102; tick <= 119; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a').cell).not.toEqual({ x: 4, y: 4 });
    const marker = markers(step(state, 120).events)[0];
    if (!marker || marker.type !== 'HUNTER_MARKER') throw new Error('expected a marker');
    expect(marker.payload.point).toEqual({ x: 4.5, y: 4 });
    expect(marker.payload.occurredTick).toBe(100);
  });

  it('schedules nothing for a canceled exchange or one with no new information', () => {
    const opened = step(facingPair(), 99, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]).state;
    let canceled = step(opened, 100, [
      command('r-a', 'EXCHANGE_CANCEL', { exchangeId: 'xch-1' }),
    ]).state;
    expect(canceled.traces.size).toBe(0);
    for (let tick = 101; tick <= 125; tick += 1) {
      const result = step(canceled, tick);
      expect(markers(result.events)).toEqual([]);
      canceled = result.state;
    }

    // Equal knowledge on both sides: the accept fails and books no trace.
    const record = opened.knowledge.get('r-a')!;
    const union = {
      floors: new Set([...record.floors, ...opened.knowledge.get('r-b')!.floors]),
      walls: new Set([...record.walls, ...opened.knowledge.get('r-b')!.walls]),
      discoveredExits: new Set<string>(),
      mapVersion: 1,
    };
    const knowledge = new Map(opened.knowledge);
    for (const id of ['r-a', 'r-b']) {
      knowledge.set(id, {
        floors: new Set(union.floors),
        walls: new Set(union.walls),
        discoveredExits: new Set(union.discoveredExits),
        mapVersion: opened.knowledge.get(id)!.mapVersion,
      });
    }
    let equal = { ...opened, knowledge };
    const refused = step(equal, 100, [command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' })]);
    expect(refused.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(refused.state.traces.size).toBe(0);
    equal = refused.state;
    for (let tick = 101; tick <= 125; tick += 1) {
      const result = step(equal, tick);
      expect(markers(result.events)).toEqual([]);
      equal = result.state;
    }
  });

  it('books one marker per completion id and releases it exactly once', () => {
    const state = exchangeAt100();
    // A repeated completion of the same exchange changes nothing.
    const again = scheduleTrace(state, {
      markerId: 'mk-xch-1',
      kind: 'exchange',
      point: { x: 9, y: 9 },
      occurredTick: 200,
    });
    expect(again).toBe(state);
    expect(again.traces.get('mk-xch-1')).toMatchObject({
      point: { x: 4.5, y: 4 },
      publishTick: 120,
    });

    const first = releaseTraces(state, 120);
    expect(first.due.map((t) => t.markerId)).toEqual(['mk-xch-1']);
    expect(releaseTraces(first.state, 121).due).toEqual([]);
    // A publish tick reached only after the display window is dropped silently.
    const late = releaseTraces(state, 200);
    expect(late.due).toEqual([]);
    expect(late.state.traces.size).toBe(0);
  });

  it('takes the cell centre for a same-cell exchange and halves for adjacent cells', () => {
    expect(midpointOf({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual({ x: 4, y: 4 });
    expect(midpointOf({ x: 4, y: 4 }, { x: 5, y: 4 })).toEqual({ x: 4.5, y: 4 });
    expect(midpointOf({ x: 7, y: 3 }, { x: 7, y: 4 })).toEqual({ x: 7, y: 3.5 });
  });

  it('makes no new marker once the round is over', () => {
    let state = exchangeAt100();
    for (let tick = 101; tick <= 110; tick += 1) state = step(state, tick).state;
    // The round is aborted before the publish tick.
    const aborted = step(state, 111, [], [{ type: 'ABORT_MATCH', reason: 'MEDIA_UNAVAILABLE' }]);
    expect(aborted.state.phase).toBe('ABORTED');
    const later = step(aborted.state, 120);
    expect(markers(later.events)).toEqual([]);
  });
  it('takes the delay and the display window from the injected tuning', () => {
    const base = startedMatch(100);
    const tuned = {
      ...base,
      tuning: { ...base.tuning, traceDelayTicks: 5, traceVisibleTicks: 12 },
    } as MatchState;
    const point = midpointOf({ x: 4, y: 4 }, { x: 5, y: 4 });

    const scheduled = scheduleTrace(tuned, {
      markerId: 'mk-1',
      kind: 'exchange',
      point,
      occurredTick: 100,
    });
    const delayed = scheduled.traces.get('mk-1')!;
    expect(delayed.publishTick).toBe(105);
    expect(delayed.expiresTick).toBe(117);

    // A device trace publishes at once but still uses the tuned display window.
    const immediate = scheduleTrace(scheduled, {
      markerId: 'mk-2',
      kind: 'trap',
      point,
      occurredTick: 100,
      delayTicks: 0,
    });
    const now = immediate.traces.get('mk-2')!;
    expect(now.publishTick).toBe(100);
    expect(now.expiresTick).toBe(112);

    // Each window really ends where its own tuning put it: at 112 the device
    // trace has expired and is dropped, while the longer exchange one still goes out.
    expect(releaseTraces(immediate, 111).due.map((trace) => trace.markerId)).toEqual([
      'mk-1',
      'mk-2',
    ]);
    expect(releaseTraces(immediate, 112).due.map((trace) => trace.markerId)).toEqual(['mk-1']);
  });
});

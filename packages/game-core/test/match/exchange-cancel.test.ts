import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/match/core-types.js';
import type { MatchState } from '../../src/match/engine.js';
import { getPlayerKnowledge } from '../../src/match/engine.js';
import { exitOfOwner } from '../../src/match/exits/registry.js';
import { command, player, startedMatch, step } from './match-fixture.js';

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

function knowledgeSnapshot(state: MatchState, id: string) {
  const knowledge = getPlayerKnowledge(state, id);
  return {
    mapVersion: knowledge.mapVersion,
    terrain: knowledge.knownTerrain.map((t) => JSON.stringify(t)).sort(),
  };
}

function canceledEvents(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'EXCHANGE_CANCELED');
}

/** r-a (10,2) and r-b (11,2) adjacent, r-c (9,2) next to r-a on the open row y=2. */
function threeRunners(): MatchState {
  return place(startedMatch(100), {
    'r-a': { x: 10, y: 2, dir: 1 },
    'r-b': { x: 11, y: 2, dir: 3 },
    'r-c': { x: 9, y: 2, dir: 1 },
  });
}

function openSession(state: MatchState, tick = 101) {
  return step(state, tick, [command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' })]).state;
}

describe('map exchange cancel and concurrent requests', () => {
  it('fixes the first approved pair and rejects a third request in the same tick', () => {
    const result = step(threeRunners(), 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
      command('r-c', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-a' }),
      command('r-b', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-c' }),
    ]);
    expect(result.outcomes.map((o) => [o.actorId, o.result, o.code])).toEqual([
      ['r-a', 'applied', null],
      ['r-c', 'rejected', 'NOT_ALLOWED'],
      ['r-b', 'rejected', 'NOT_ALLOWED'],
    ]);
    // Exactly one session exists and only its two parties hold a slot: no queue.
    expect([...result.state.exchanges.keys()]).toEqual(['xch-1']);
    expect(player(result.state, 'r-a').exchange).toMatchObject({ exchangeId: 'xch-1' });
    expect(player(result.state, 'r-b').exchange).toMatchObject({ exchangeId: 'xch-1' });
    expect(player(result.state, 'r-c').exchange).toBeNull();
    expect(canceledEvents(result.events)).toEqual([]);
  });

  it('releases both slots when a party moves out of range, leaving maps unmerged', () => {
    const opened = openSession(threeRunners());
    const stationary = knowledgeSnapshot(opened, 'r-a');
    // r-b faces west, so `back` steps east to (12,2): distance becomes 2.
    let state = step(opened, 102, [command('r-b', 'MOVE_INTENT', { direction: 'back' })]).state;
    expect(state.exchanges.size).toBe(1);
    for (let tick = 103; tick <= 110; tick += 1) state = step(state, tick).state;
    const arrival = step(state, 111);
    expect(player(arrival.state, 'r-b').cell).toEqual({ x: 12, y: 2 });
    expect(arrival.state.exchanges.size).toBe(0);
    expect(player(arrival.state, 'r-a').exchange).toBeNull();
    expect(player(arrival.state, 'r-b').exchange).toBeNull();
    expect(canceledEvents(arrival.events)).toEqual([
      expect.objectContaining({
        audience: ['r-a', 'r-b'],
        payload: { exchangeId: 'xch-1', reason: 'NOT_ALLOWED' },
      }),
    ]);
    // No outcome is re-issued for the request that was applied at tick 101.
    expect(arrival.outcomes).toEqual([]);
    // r-a stood still and gained nothing; r-b only added what it saw itself, so
    // neither holds the other's spawn cell.
    expect(knowledgeSnapshot(arrival.state, 'r-a')).toEqual(stationary);
    const floorsOf = (id: string) =>
      getPlayerKnowledge(arrival.state, id)
        .knownTerrain.filter((t) => t.kind === 'floor')
        .map((t) => `${t.x},${t.y}`);
    expect(floorsOf('r-b')).not.toContain('2,2');
    expect(floorsOf('r-a')).not.toContain('29,2');

    // A later tick adds no further event for the same session.
    const quiet = step(arrival.state, 112);
    expect(canceledEvents(quiet.events)).toEqual([]);
  });

  it('settles a capture before an accept in the same tick and cancels the session once', () => {
    // r-b at (11,2) walks east while t-a walks west into the same cell: capture.
    const base = place(threeRunners(), { 't-a': { x: 13, y: 2, dir: 3 } });
    const opened = openSession(base);
    let state = step(opened, 102, [
      command('r-b', 'MOVE_INTENT', { direction: 'back' }),
      command('t-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    for (let tick = 103; tick <= 109; tick += 1) state = step(state, tick).state;
    state = step(state, 110, [command('t-a', 'GRAB_INTENT', {})]).state;
    // Both actions complete at tick 111; the accept arrives in that same tick.
    const contact = step(state, 111, [command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' })]);
    expect(player(contact.state, 'r-b').status).toBe('CAPTURED');
    // Capture is committed first, so the accept is canceled, not applied.
    expect(contact.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-b', result: 'canceled', code: 'NOT_ACTIVE' }),
    ]);
    expect(contact.state.exchanges.size).toBe(0);
    expect(player(contact.state, 'r-a').exchange).toBeNull();
    expect(player(contact.state, 'r-b').exchange).toBeNull();
    expect(canceledEvents(contact.events)).toEqual([
      expect.objectContaining({ payload: { exchangeId: 'xch-1', reason: 'NOT_ACTIVE' } }),
    ]);
    // Repeating the cancel path produces no extra event.
    const again = step(contact.state, 112, [
      command('r-a', 'EXCHANGE_CANCEL', { exchangeId: 'xch-1' }),
    ]);
    expect(again.outcomes[0]).toMatchObject({ result: 'rejected', code: 'STALE_REQUEST' });
    expect(canceledEvents(again.events)).toEqual([]);
  });

  it('ends a session on a party cancel and refuses non-parties and stale ids', () => {
    const opened = openSession(threeRunners());
    const outsider = step(opened, 102, [
      command('r-c', 'EXCHANGE_CANCEL', { exchangeId: 'xch-1' }),
    ]);
    expect(outsider.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(outsider.state.exchanges.size).toBe(1);
    expect(canceledEvents(outsider.events)).toEqual([]);

    // The recipient may cancel just as the requester may.
    const canceled = step(outsider.state, 103, [
      command('r-b', 'EXCHANGE_CANCEL', { exchangeId: 'xch-1' }),
    ]);
    expect(canceled.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-b', result: 'applied', code: null }),
    ]);
    expect(canceled.state.exchanges.size).toBe(0);
    expect(player(canceled.state, 'r-a').exchange).toBeNull();
    expect(player(canceled.state, 'r-b').exchange).toBeNull();
    expect(canceledEvents(canceled.events)).toEqual([
      expect.objectContaining({
        audience: ['r-a', 'r-b'],
        payload: { exchangeId: 'xch-1', reason: 'CANCELED' },
      }),
    ]);

    // Re-cancel and re-accept of the finished id change nothing.
    const replay = step(canceled.state, 104, [
      command('r-a', 'EXCHANGE_CANCEL', { exchangeId: 'xch-1' }),
      command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' }),
    ]);
    expect(replay.outcomes.map((o) => o.code)).toEqual(['STALE_REQUEST', 'STALE_REQUEST']);
    expect(replay.state.exchanges.size).toBe(0);
    expect(canceledEvents(replay.events)).toEqual([]);

    // A new request may open after the cancel: no slot is left behind.
    const reopened = step(replay.state, 105, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]);
    expect(reopened.outcomes[0]).toMatchObject({ result: 'applied' });
    expect([...reopened.state.exchanges.keys()]).toEqual(['xch-2']);
  });

  it('rejects a cancel at the deadline and lets the sweep close the session once', () => {
    const opened = openSession(threeRunners());
    const before = ['r-a', 'r-b'].map((id) => knowledgeSnapshot(opened, id));
    const expired = step(opened, 141, [command('r-a', 'EXCHANGE_CANCEL', { exchangeId: 'xch-1' })]);
    expect(expired.outcomes).toEqual([
      expect.objectContaining({ result: 'rejected', code: 'EXPIRED' }),
    ]);
    expect(expired.state.exchanges.size).toBe(0);
    expect(player(expired.state, 'r-a').exchange).toBeNull();
    expect(player(expired.state, 'r-b').exchange).toBeNull();
    expect(canceledEvents(expired.events)).toEqual([
      expect.objectContaining({ payload: { exchangeId: 'xch-1', reason: 'EXPIRED' } }),
    ]);
    expect(['r-a', 'r-b'].map((id) => knowledgeSnapshot(expired.state, id))).toEqual(before);
  });

  it('expires an untouched session on its own tick without any outcome', () => {
    const opened = openSession(threeRunners());
    const alive = step(opened, 140);
    expect(alive.state.exchanges.size).toBe(1);
    expect(canceledEvents(alive.events)).toEqual([]);
    const swept = step(alive.state, 141);
    expect(swept.outcomes).toEqual([]);
    expect(swept.state.exchanges.size).toBe(0);
    expect(canceledEvents(swept.events)).toEqual([
      expect.objectContaining({ payload: { exchangeId: 'xch-1', reason: 'EXPIRED' } }),
    ]);
  });

  it('ends a session when a party becomes restrained or starts an exit challenge', () => {
    const opened = openSession(threeRunners());
    const players = new Map(opened.players);
    players.set('r-b', { ...player(opened, 'r-b'), restraintUntilTick: 135 });
    const restrained = step({ ...opened, players }, 105);
    expect(restrained.state.exchanges.size).toBe(0);
    expect(canceledEvents(restrained.events)).toEqual([
      expect.objectContaining({ payload: { exchangeId: 'xch-1', reason: 'NOT_ALLOWED' } }),
    ]);

    // r-a stands on its own exit approach cell (11,22) facing the wall (12,22)
    // and r-b next to it, so a real exit challenge can start on top of a session.
    const atExit = place(startedMatch(100), {
      'r-a': { x: 11, y: 22, dir: 1 },
      'r-b': { x: 11, y: 21, dir: 2 },
    });
    const exit = exitOfOwner(atExit.exits, 'r-a')!;
    expect(exit.approach).toEqual({ x: 11, y: 22 });
    const second = openSession(atExit);
    expect(second.exchanges.size).toBe(1);
    const locked = step(second, 102, [command('r-a', 'EXIT_START', { exitId: exit.exitId })]);
    expect(locked.outcomes[0]).toMatchObject({ result: 'applied' });
    // The challenge locks map exchange: the open session ends in the same tick.
    expect(locked.state.exchanges.size).toBe(0);
    expect(canceledEvents(locked.events)).toEqual([
      expect.objectContaining({ payload: { exchangeId: 'xch-1', reason: 'NOT_ALLOWED' } }),
    ]);
  });

  it('never tells taggers that an exchange session ended', () => {
    const opened = openSession(threeRunners());
    const canceled = step(opened, 102, [
      command('r-a', 'EXCHANGE_CANCEL', { exchangeId: 'xch-1' }),
    ]);
    for (const event of canceled.events) {
      if (event.type === 'SPATIAL_SOUND') continue;
      expect(event.audience).not.toContain('t-a');
      expect(event.audience).not.toContain('t-b');
      expect(event.audience).not.toContain('t-c');
    }
    expect(canceled.events.some((e) => e.type === 'HUNTER_MARKER')).toBe(false);
    // The cancel reason carries no position of either party.
    const event = canceledEvents(canceled.events)[0];
    if (!event || event.type !== 'EXCHANGE_CANCELED') throw new Error('expected a cancel event');
    expect(Object.keys(event.payload).sort()).toEqual(['exchangeId', 'reason']);
  });
});

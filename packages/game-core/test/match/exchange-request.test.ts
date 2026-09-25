import { describe, expect, it } from 'vitest';

import type { MatchState } from '../../src/match/engine.js';
import { getPlayerKnowledge, getPlayerSelf } from '../../src/match/engine.js';
import { inExchangeRange } from '../../src/match/exchange/session.js';
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

/** Gives `to` an independent copy of `from`'s knowledge, so neither side gains anything. */
function copyKnowledge(state: MatchState, from: string, to: string): MatchState {
  const record = state.knowledge.get(from)!;
  const knowledge = new Map(state.knowledge);
  knowledge.set(to, {
    floors: new Set(record.floors),
    walls: new Set(record.walls),
    discoveredExits: new Set(record.discoveredExits),
    mapVersion: record.mapVersion,
  });
  return { ...state, knowledge };
}

function knowledgeSnapshot(state: MatchState, id: string) {
  const knowledge = getPlayerKnowledge(state, id);
  return {
    mapVersion: knowledge.mapVersion,
    terrain: knowledge.knownTerrain.map((t) => JSON.stringify(t)).sort(),
    exits: knowledge.knownActiveExits.map((e) => e.exitId).sort(),
  };
}

/** Two runners on adjacent open cells of row y=2, each still holding its spawn knowledge. */
function adjacentRunners(): MatchState {
  return place(startedMatch(100), {
    'r-a': { x: 10, y: 2, dir: 1 },
    'r-b': { x: 11, y: 2, dir: 3 },
  });
}

describe('map exchange request and accept', () => {
  it('opens a session for adjacent runners with new information and moves no knowledge yet', () => {
    const base = adjacentRunners();
    const idle = step(base, 101);
    const result = step(base, 101, [command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' })]);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ result: 'applied', code: null, actorId: 'r-a' });

    const session = result.state.exchanges.get('xch-1');
    expect(session).toMatchObject({
      exchangeId: 'xch-1',
      fromPlayerId: 'r-a',
      toPlayerId: 'r-b',
      requestedTick: 101,
      // 4 seconds is 80 game ticks (S15P21C204-389).
      expiresAtTick: 181,
    });
    expect(getPlayerSelf(result.state, 'r-a')).toMatchObject({
      exchange: {
        exchangeId: 'xch-1',
        fromPlayerId: 'r-a',
        toPlayerId: 'r-b',
        direction: 'outgoing',
        expiresAtTick: 181,
      },
    });
    expect(getPlayerSelf(result.state, 'r-b')).toMatchObject({
      exchange: { direction: 'incoming', expiresAtTick: 181 },
    });

    // The request alone changes no knowledge on either side.
    for (const id of ['r-a', 'r-b']) {
      expect(knowledgeSnapshot(result.state, id)).toEqual(knowledgeSnapshot(idle.state, id));
    }
  });

  it('tells only the recipient and leaves no tagger trace at the request stage', () => {
    const result = step(adjacentRunners(), 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]);
    expect(result.state.exchanges.size).toBe(1);
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    if (!event || event.type !== 'EXCHANGE_OFFER') throw new Error('expected an offer event');
    expect(event.audience).toEqual(['r-b']);
    expect(event.tick).toBe(101);
    expect(Object.keys(event.payload).sort()).toEqual([
      'exchangeId',
      'expiresAtTick',
      'fromPlayerId',
    ]);
    // No marker and no sound: taggers learn nothing from a request.
    expect(result.events.some((e) => e.type === 'HUNTER_MARKER')).toBe(false);
    expect(result.events.some((e) => e.type === 'SPATIAL_SOUND')).toBe(false);
  });

  it('rejects diagonal, walled, and ineligible targets without touching state', () => {
    const diagonal = place(startedMatch(100), {
      'r-a': { x: 10, y: 2, dir: 1 },
      'r-b': { x: 11, y: 3, dir: 3 },
    });
    const rejected = step(diagonal, 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]);
    expect(rejected.outcomes).toEqual([
      expect.objectContaining({ result: 'rejected', code: 'NOT_ALLOWED' }),
    ]);
    expect(rejected.state.exchanges.size).toBe(0);
    expect(player(rejected.state, 'r-a').exchange).toBeNull();
    expect(player(rejected.state, 'r-b').exchange).toBeNull();
    expect(rejected.events).toEqual([]);

    // (5,3) and (7,3) are passages with the wall cell (6,3) between them.
    const walled = place(startedMatch(100), {
      'r-a': { x: 5, y: 3, dir: 1 },
      'r-b': { x: 7, y: 3, dir: 3 },
    });
    expect(inExchangeRange(walled, { x: 5, y: 3 }, { x: 7, y: 3 })).toBe(false);
    const blocked = step(walled, 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]);
    expect(blocked.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(blocked.state.exchanges.size).toBe(0);

    // A far runner and the actor itself are both ineligible targets.
    const far = step(adjacentRunners(), 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-c' }),
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-a' }),
    ]);
    expect(far.outcomes.map((o) => o.code)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
    expect(far.state.exchanges.size).toBe(0);

    // A tagger neighbour never exchanges maps.
    const withTagger = place(startedMatch(100), {
      'r-a': { x: 10, y: 2, dir: 1 },
      't-a': { x: 11, y: 2, dir: 3 },
    });
    const tagger = step(withTagger, 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 't-a' }),
    ]);
    expect(tagger.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(tagger.state.exchanges.size).toBe(0);
  });

  it('rejects a request when neither side would learn anything new', () => {
    const same = copyKnowledge(adjacentRunners(), 'r-a', 'r-b');
    const result = step(same, 101, [command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' })]);
    expect(result.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(result.state.exchanges.size).toBe(0);
    expect(result.events).toEqual([]);
  });

  it('keeps one session per player: a third request is rejected, not queued', () => {
    const base = place(startedMatch(100), {
      'r-a': { x: 10, y: 2, dir: 1 },
      'r-b': { x: 11, y: 2, dir: 3 },
      'r-c': { x: 9, y: 2, dir: 1 },
    });
    const opened = step(base, 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]).state;
    const third = step(opened, 102, [
      command('r-c', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-a' }),
    ]);
    expect(third.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect([...third.state.exchanges.keys()]).toEqual(['xch-1']);
    expect(player(third.state, 'r-c').exchange).toBeNull();
    expect(player(third.state, 'r-a').exchange).toMatchObject({ exchangeId: 'xch-1' });
  });

  it('lets only the recipient accept, once, before the deadline', () => {
    const opened = step(adjacentRunners(), 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]).state;
    // The requester and a third party cannot accept, and an unknown id is stale.
    const refused = step(opened, 102, [
      command('r-a', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' }),
      command('r-c', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' }),
      command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-9' }),
    ]);
    expect(refused.outcomes.map((o) => o.code)).toEqual([
      'NOT_ALLOWED',
      'NOT_ALLOWED',
      'STALE_REQUEST',
    ]);
    expect(refused.state.exchanges.size).toBe(1);

    const accepted = step(refused.state, 140, [
      command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' }),
    ]);
    expect(accepted.outcomes).toEqual([
      expect.objectContaining({ result: 'applied', code: null, actorId: 'r-b' }),
    ]);
    expect(accepted.state.exchanges.size).toBe(0);
    expect(player(accepted.state, 'r-a').exchange).toBeNull();
    expect(player(accepted.state, 'r-b').exchange).toBeNull();

    // The id cannot be used again.
    const replay = step(accepted.state, 141, [
      command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' }),
    ]);
    expect(replay.outcomes[0]).toMatchObject({ result: 'rejected', code: 'STALE_REQUEST' });
    expect(replay.state.exchanges.size).toBe(0);
  });

  it('ends the session with EXPIRED at the deadline and leaves knowledge untouched', () => {
    const opened = step(adjacentRunners(), 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]).state;
    const before = ['r-a', 'r-b'].map((id) => knowledgeSnapshot(opened, id));
    const expired = step(opened, 181, [command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' })]);
    expect(expired.outcomes).toEqual([
      expect.objectContaining({ result: 'rejected', code: 'EXPIRED' }),
    ]);
    // The outcome alone lets the UI drop the pending request: both slots are clear.
    expect(expired.state.exchanges.size).toBe(0);
    expect(player(expired.state, 'r-a').exchange).toBeNull();
    expect(player(expired.state, 'r-b').exchange).toBeNull();
    // The KN-06 sweep of the same tick reports the deadline to both parties only.
    expect(expired.events).toHaveLength(1);
    expect(expired.events[0]).toMatchObject({
      type: 'EXCHANGE_CANCELED',
      audience: ['r-a', 'r-b'],
      payload: { exchangeId: 'xch-1', reason: 'EXPIRED' },
    });
    expect(['r-a', 'r-b'].map((id) => knowledgeSnapshot(expired.state, id))).toEqual(before);
  });

  it('rejects an accept once a party is no longer ACTIVE', () => {
    const opened = step(adjacentRunners(), 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]).state;
    const players = new Map(opened.players);
    players.set('r-a', { ...player(opened, 'r-a'), status: 'CAPTURED' });
    const ended: MatchState = { ...opened, players };
    const result = step(ended, 105, [command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' })]);
    expect(result.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ACTIVE' });
    expect(knowledgeSnapshot(result.state, 'r-b')).toEqual(knowledgeSnapshot(ended, 'r-b'));
  });
});

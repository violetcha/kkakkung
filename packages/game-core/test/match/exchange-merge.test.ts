import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/match/core-types.js';
import type { MatchState } from '../../src/match/engine.js';
import { getPlayerKnowledge } from '../../src/match/engine.js';
import { mergeKnowledge } from '../../src/match/exchange/merge.js';
import { exitOfOwner } from '../../src/match/exits/registry.js';
import { terminateRunner } from '../../src/match/participation.js';
import type { KnowledgeRecord } from '../../src/match/state.js';
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

/** Replaces one player's terrain memory with an exact, independent set. */
function setKnowledge(state: MatchState, id: string, patch: Partial<KnowledgeRecord>): MatchState {
  const record = state.knowledge.get(id)!;
  const knowledge = new Map(state.knowledge);
  knowledge.set(id, {
    floors: patch.floors ? new Set(patch.floors) : new Set(record.floors),
    walls: patch.walls ? new Set(patch.walls) : new Set(record.walls),
    discoveredExits: patch.discoveredExits
      ? new Set(patch.discoveredExits)
      : new Set(record.discoveredExits),
    mapVersion: patch.mapVersion ?? record.mapVersion,
  });
  return { ...state, knowledge };
}

/** Gives both players an independent copy of the union, so neither can gain. */
function equalize(state: MatchState, a: string, b: string): MatchState {
  const first = state.knowledge.get(a)!;
  const second = state.knowledge.get(b)!;
  const union = {
    floors: new Set([...first.floors, ...second.floors]),
    walls: new Set([...first.walls, ...second.walls]),
    discoveredExits: new Set([...first.discoveredExits, ...second.discoveredExits]),
  };
  return setKnowledge(setKnowledge(state, a, union), b, union);
}

function floorsOf(state: MatchState, id: string): string[] {
  return getPlayerKnowledge(state, id)
    .knownTerrain.filter((t) => t.kind === 'floor')
    .map((t) => `${t.x},${t.y}`);
}

function completedEvents(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'EXCHANGE_COMPLETED');
}

/**
 * Row y=2 is open. r-a (10,2) and r-b (11,2) are adjacent, r-c (12,2) sits next
 * to r-b for the relay case. Each keeps the knowledge from its own spawn.
 */
function threeRunners(): MatchState {
  return place(startedMatch(100), {
    'r-a': { x: 10, y: 2, dir: 1 },
    'r-b': { x: 11, y: 2, dir: 3 },
    'r-c': { x: 12, y: 2, dir: 3 },
  });
}

function requestAndAccept(state: MatchState, from: string, to: string, exchangeId: string) {
  const opened = step(state, 101, [
    command(from, 'EXCHANGE_REQUEST', { targetPlayerId: to }),
  ]).state;
  return step(opened, 102, [command(to, 'EXCHANGE_ACCEPT', { exchangeId })]);
}

describe('map knowledge merge and closed exit filter', () => {
  it('gives both sides the union with independent sets and no later sync', () => {
    const base = threeRunners();
    const beforeA = floorsOf(base, 'r-a');
    const beforeB = floorsOf(base, 'r-b');
    // Each side really holds something the other lacks.
    expect(beforeA).not.toEqual(expect.arrayContaining(beforeB));

    const merged = requestAndAccept(base, 'r-a', 'r-b', 'xch-1');
    expect(merged.outcomes).toEqual([
      expect.objectContaining({ actorId: 'r-b', result: 'applied', code: null }),
    ]);
    const afterA = floorsOf(merged.state, 'r-a');
    const afterB = floorsOf(merged.state, 'r-b');
    for (const cell of [...beforeA, ...beforeB]) {
      expect(afterA).toContain(cell);
      expect(afterB).toContain(cell);
    }
    // Both versions rose, and the session is closed.
    expect(getPlayerKnowledge(merged.state, 'r-a').mapVersion).toBeGreaterThan(
      getPlayerKnowledge(base, 'r-a').mapVersion,
    );
    expect(getPlayerKnowledge(merged.state, 'r-b').mapVersion).toBeGreaterThan(
      getPlayerKnowledge(base, 'r-b').mapVersion,
    );
    expect(merged.state.exchanges.size).toBe(0);
    expect(player(merged.state, 'r-a').exchange).toBeNull();
    expect(player(merged.state, 'r-b').exchange).toBeNull();

    // The two records share no Set: a new floor for r-a stays with r-a.
    const recordA = merged.state.knowledge.get('r-a')!;
    const recordB = merged.state.knowledge.get('r-b')!;
    expect(recordA.floors).not.toBe(recordB.floors);
    expect(recordA.walls).not.toBe(recordB.walls);
    expect(recordA.discoveredExits).not.toBe(recordB.discoveredExits);
    const extended = setKnowledge(merged.state, 'r-a', {
      floors: new Set([...recordA.floors, 3 * 32 + 3]),
    });
    expect(floorsOf(extended, 'r-a')).toContain('3,3');
    expect(floorsOf(extended, 'r-b')).not.toContain('3,3');
  });

  it('tells each side its own new map version and nothing to the taggers', () => {
    const merged = requestAndAccept(threeRunners(), 'r-a', 'r-b', 'xch-1');
    const completed = completedEvents(merged.events);
    expect(completed).toHaveLength(2);
    expect(completed.map((e) => (e.type === 'EXCHANGE_COMPLETED' ? e.audience : null))).toEqual([
      ['r-a'],
      ['r-b'],
    ]);
    for (const event of completed) {
      if (event.type !== 'EXCHANGE_COMPLETED') throw new Error('expected a completed event');
      expect(Object.keys(event.payload).sort()).toEqual(['exchangeId', 'mapVersion']);
      expect(event.payload.exchangeId).toBe('xch-1');
      expect(event.payload.mapVersion).toBe(
        getPlayerKnowledge(merged.state, event.audience[0]!).mapVersion,
      );
    }
    for (const event of merged.events) {
      if (event.type === 'SPATIAL_SOUND') continue;
      for (const tagger of ['t-a', 't-b', 't-c']) expect(event.audience).not.toContain(tagger);
    }
  });

  it('never restores a closed exit for either side', () => {
    const base = threeRunners();
    const exit = exitOfOwner(base.exits, 'r-b')!;
    // r-a knows r-b's exit; r-b's personal end closes it before the exchange.
    const known = setKnowledge(base, 'r-a', { discoveredExits: new Set([exit.exitId]) });
    const ended = terminateRunner(known, 'r-b', 'ESCAPED', 100, () => 'e-1').state;
    expect(exitOfOwner(ended.exits, 'r-b')?.active).toBe(false);
    expect(getPlayerKnowledge(ended, 'r-a').knownActiveExits).toEqual([]);

    // r-a exchanges with r-c, which is adjacent after a step onto (11,2).
    const together = place(ended, { 'r-c': { x: 11, y: 2, dir: 3 } });
    const merged = requestAndAccept(together, 'r-a', 'r-c', 'xch-1');
    expect(merged.outcomes[0]).toMatchObject({ result: 'applied' });
    for (const id of ['r-a', 'r-c']) {
      expect(merged.state.knowledge.get(id)!.discoveredExits.has(exit.exitId)).toBe(false);
      expect(getPlayerKnowledge(merged.state, id).knownActiveExits).toEqual([]);
    }
  });

  it('relays allowed knowledge through A -> B -> C without any position', () => {
    const base = threeRunners();
    const spawnA = floorsOf(base, 'r-a');
    const first = requestAndAccept(base, 'r-a', 'r-b', 'xch-1').state;
    const second = step(first, 103, [
      command('r-b', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-c' }),
    ]).state;
    const relayed = step(second, 104, [command('r-c', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-2' })]);
    expect(relayed.outcomes[0]).toMatchObject({ result: 'applied' });
    // C received what A knew, terrain only.
    for (const cell of spawnA) expect(floorsOf(relayed.state, 'r-c')).toContain(cell);
    const knowledge = getPlayerKnowledge(relayed.state, 'r-c');
    for (const entry of knowledge.knownTerrain) {
      expect(Object.keys(entry).sort()).toEqual(
        entry.kind === 'floor' ? ['kind', 'x', 'y'] : ['kind', 'side', 'x', 'y'],
      );
    }
    // No current position of A or B is part of C's knowledge fields.
    expect(Object.keys(knowledge).sort()).toEqual([
      'knownActiveExits',
      'knownTerrain',
      'mapVersion',
    ]);
  });

  it('rejects the accept and leaves no trace when the knowledge became equal', () => {
    const base = threeRunners();
    const opened = step(base, 101, [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
    ]).state;
    // Another legitimate path made both sides equal before the accept: each
    // holds the union, so neither loses its own sight and no side gains.
    const equal = equalize(opened, 'r-a', 'r-b');
    const versions = ['r-a', 'r-b'].map((id) => getPlayerKnowledge(equal, id).mapVersion);
    const result = step(equal, 102, [command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' })]);
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        matchId: 'match-1',
        actorId: 'r-b',
        result: 'rejected',
        code: 'NOT_ALLOWED',
      }),
    ]);
    // Session gone, knowledge and versions untouched, no completion event.
    expect(result.state.exchanges.size).toBe(0);
    expect(player(result.state, 'r-a').exchange).toBeNull();
    expect(player(result.state, 'r-b').exchange).toBeNull();
    expect(['r-a', 'r-b'].map((id) => getPlayerKnowledge(result.state, id).mapVersion)).toEqual(
      versions,
    );
    expect(completedEvents(result.events)).toEqual([]);
    expect(result.events.some((e) => e.type === 'HUNTER_MARKER')).toBe(false);
  });

  it('merges nothing and reports unchanged for an equal pair at the pure helper', () => {
    const base = threeRunners();
    const equal = equalize(base, 'r-a', 'r-b');
    const session = {
      exchangeId: 'xch-0',
      fromPlayerId: 'r-a',
      toPlayerId: 'r-b',
      requestedTick: 100,
      expiresAtTick: 140,
    } as const;
    expect(mergeKnowledge(equal, session)).toEqual({ status: 'unchanged' });

    // One-sided gain still merges, and reports which side changed.
    const oneSided = setKnowledge(equal, 'r-a', {
      floors: new Set([...equal.knowledge.get('r-a')!.floors, 4 * 32 + 4]),
    });
    const merged = mergeKnowledge(oneSided, session);
    if (merged.status !== 'merged') throw new Error('expected a merge');
    expect(merged.parties.map((p) => [p.playerId, p.changed])).toEqual([
      ['r-a', false],
      ['r-b', true],
    ]);
    expect(merged.parties[0].mapVersion).toBe(oneSided.knowledge.get('r-a')!.mapVersion);
    expect(merged.parties[1].mapVersion).toBe(oneSided.knowledge.get('r-b')!.mapVersion + 1);
    // The two past cells of the success tick come back for KN-08.
    expect(merged.cells).toEqual([
      { x: 10, y: 2 },
      { x: 11, y: 2 },
    ]);
  });
});

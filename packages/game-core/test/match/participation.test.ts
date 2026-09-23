import { describe, expect, it } from 'vitest';

import { getPlayerSelf, type MatchState } from '../../src/match/engine.js';
import { activeExits, exitOfOwner } from '../../src/match/exits/registry.js';
import { terminateRunner } from '../../src/match/participation.js';
import type { KnowledgeRecord } from '../../src/match/state.js';
import { command, player, startedMatch, step } from './match-fixture.js';

describe('personal end and exit closure', () => {
  it('fixes the first result only: CAPTURED then ESCAPED keeps CAPTURED and counts once', () => {
    const start = startedMatch(100);
    const first = terminateRunner(start, 'r-a', 'CAPTURED', 100);
    expect(first.changed).toBe(true);
    expect(player(first.state, 'r-a').status).toBe('CAPTURED');
    expect(first.state.counts).toEqual({ escaped: 0, captured: 1 });
    const second = terminateRunner(first.state, 'r-a', 'ESCAPED', 101);
    expect(second.changed).toBe(false);
    expect(second.state).toBe(first.state);
    expect(second.mediaIntents).toEqual([]);
    expect(player(second.state, 'r-a').status).toBe('CAPTURED');
    expect(second.state.counts).toEqual({ escaped: 0, captured: 1 });
    // Taggers are never terminated through this path.
    expect(terminateRunner(start, 't-a', 'CAPTURED', 100).changed).toBe(false);
  });

  it('closes the owner exit and bumps the map version of every runner who knew it', () => {
    const start = startedMatch(100);
    const exitId = exitOfOwner(start.exits, 'r-a')!.exitId;
    const knowledge = new Map<string, KnowledgeRecord>();
    for (const id of ['r-a', 'r-b', 'r-c']) {
      knowledge.set(id, {
        floors: new Set([5]),
        walls: new Set(),
        discoveredExits: new Set([exitId]),
        mapVersion: 3,
      });
    }
    knowledge.set('t-a', {
      floors: new Set(),
      walls: new Set(),
      discoveredExits: new Set(),
      mapVersion: 1,
    });
    const state: MatchState = { ...start, knowledge };
    const ended = terminateRunner(state, 'r-a', 'CAPTURED', 100).state;
    expect(ended.exits.get(exitId)?.active).toBe(false);
    expect(activeExits(ended.exits)).toHaveLength(2);
    for (const id of ['r-a', 'r-b', 'r-c']) {
      expect(ended.knowledge.get(id)?.mapVersion).toBe(4);
      // Terrain memory survives closure.
      expect(ended.knowledge.get(id)?.floors.has(5)).toBe(true);
    }
    expect(ended.knowledge.get('t-a')?.mapVersion).toBe(1);
    // No public event announces the closure to taggers.
    expect(terminateRunner(state, 'r-a', 'CAPTURED', 100).events).toEqual([]);
  });

  it('clears actions and intents, emits an idempotent RETIRE_PLAYER intent, and projects EndedSelf', () => {
    const start = startedMatch(100);
    const moving = step(start, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]).state;
    expect(player(moving, 'r-a').action).not.toBeNull();
    const ended = terminateRunner(moving, 'r-a', 'ESCAPED', 101);
    expect(player(ended.state, 'r-a')).toMatchObject({
      action: null,
      heldMove: null,
      nextAction: null,
      status: 'ESCAPED',
    });
    expect(ended.mediaIntents).toEqual([
      { type: 'RETIRE_PLAYER', playerId: 'r-a', reason: 'personal-ended' },
    ]);
    expect(getPlayerSelf(ended.state, 'r-a')).toEqual({
      playerId: 'r-a',
      role: 'runner',
      status: 'ESCAPED',
    });
    // The record remains part of the match; it is not deleted with the session.
    expect(ended.state.players.has('r-a')).toBe(true);
    expect(ended.state.order).toContain('r-a');
    // Repeating the same intent does not produce a second retirement.
    expect(terminateRunner(ended.state, 'r-a', 'ESCAPED', 102).mediaIntents).toEqual([]);
  });
});

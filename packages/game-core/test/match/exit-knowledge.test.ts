import { describe, expect, it } from 'vitest';

import { getPlayerKnowledge, type MatchState } from '../../src/match/engine.js';
import { exitOfOwner } from '../../src/match/exits/registry.js';
import { discoverExits, knownActiveExits } from '../../src/match/knowledge/exits.js';
import { terminateRunner } from '../../src/match/participation.js';
import { player, startedMatch, step } from './match-fixture.js';

/** Places a player at a cell/direction with no running action. */
function placed(
  state: MatchState,
  id: string,
  x: number,
  y: number,
  dir: 0 | 1 | 2 | 3,
): MatchState {
  const players = new Map(state.players);
  players.set(id, { ...player(state, id), cell: { x, y }, dir, action: null });
  return { ...state, players };
}

describe('exit discovery and disclosure', () => {
  // r-a's exit: wall (12,22) west face, approach (11,22). r-b's: wall (24,22) east face, approach (25,22).
  it('is not discovered by seeing a different face of the exit wall', () => {
    const start = startedMatch(100);
    // Stand north of the wall cell (12,22) at (12,21)? (12,21) is a wall column cell -> use (11,21) facing south:
    // sees the north face region? The exit face is the WEST face; standing at (11,20) facing south sees (12,21)/(12,22) west faces.
    // Instead stand at (13,22) facing west: sees the EAST face of (12,22) only.
    const east = step(placed(start, 'r-b', 13, 22, 3), 101).state;
    expect(getPlayerKnowledge(east, 'r-b').knownActiveExits).toEqual([]);
  });

  it('lets another runner discover an active exit by seeing its exact face and reveals owner without pose', () => {
    const start = startedMatch(100);
    const exit = exitOfOwner(start.exits, 'r-a')!;
    // r-b stands at (11,22) facing east: directly in front of the west face of (12,22).
    const seen = step(placed(start, 'r-b', 11, 22, 1), 101).state;
    const knowledge = getPlayerKnowledge(seen, 'r-b');
    expect(knowledge.knownActiveExits).toEqual([
      {
        exitId: exit.exitId,
        ownerId: 'r-a',
        wall: { x: 12, y: 22, side: 3 },
        approach: { x: 11, y: 22 },
      },
    ]);
    expect(JSON.stringify(knowledge)).not.toContain('poseKind');
    // Taggers standing in the same spot learn nothing about exits.
    const tagger = step(placed(start, 't-a', 11, 22, 1), 101).state;
    expect(getPlayerKnowledge(tagger, 't-a').knownActiveExits).toEqual([]);
    expect(JSON.stringify(getPlayerKnowledge(tagger, 't-a'))).not.toContain('exitId');
  });

  it('drops a closed exit from every runner while keeping terrain memory and bumping mapVersion', () => {
    const start = startedMatch(100);
    const exit = exitOfOwner(start.exits, 'r-a')!;
    const seen = step(placed(start, 'r-b', 11, 22, 1), 101).state;
    const beforeVersion = getPlayerKnowledge(seen, 'r-b').mapVersion;
    const beforeTerrain = getPlayerKnowledge(seen, 'r-b').knownTerrain.length;
    const closed = terminateRunner(seen, 'r-a', 'CAPTURED', 101).state;
    const after = getPlayerKnowledge(closed, 'r-b');
    expect(after.knownActiveExits).toEqual([]);
    expect(after.mapVersion).toBe(beforeVersion + 1);
    expect(after.knownTerrain.length).toBe(beforeTerrain);
    // The discovered id is remembered internally but never resurfaces while inactive.
    expect(closed.knowledge.get('r-b')?.discoveredExits.has(exit.exitId)).toBe(true);
    const later = step(closed, 102).state;
    expect(getPlayerKnowledge(later, 'r-b').knownActiveExits).toEqual([]);
  });

  it('pure helpers ignore taggers, unknown faces, and repeated discoveries', () => {
    const start = startedMatch(100);
    const record = start.knowledge.get('r-b')!;
    const face = { x: 12, y: 22, side: 3 as const };
    const surfaces = { visibleCells: [], visibleWallFaces: [face] };
    const discovered = discoverExits(record, 'runner', surfaces, start.exits);
    expect(discovered.discoveredExits.size).toBe(1);
    expect(discovered.mapVersion).toBe(record.mapVersion + 1);
    expect(discoverExits(discovered, 'runner', surfaces, start.exits)).toBe(discovered);
    expect(discoverExits(record, 'tagger', surfaces, start.exits)).toBe(record);
    expect(
      discoverExits(
        record,
        'runner',
        { visibleCells: [], visibleWallFaces: [{ ...face, side: 1 }] },
        start.exits,
      ),
    ).toBe(record);
    expect(knownActiveExits(discovered, 'tagger', start.exits)).toEqual([]);
    expect(knownActiveExits(discovered, 'runner', start.exits)).toHaveLength(1);
  });
});

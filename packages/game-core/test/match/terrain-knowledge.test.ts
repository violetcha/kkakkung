import { describe, expect, it } from 'vitest';

import { getPlayerKnowledge } from '../../src/match/engine.js';
import { initialTerrain, observeTerrain } from '../../src/match/knowledge/terrain.js';
import { command, createTestMatch, player, startedMatch, step } from './match-fixture.js';

describe('terrain knowledge', () => {
  it('starts a runner with its own cell plus first sight, not a whole region', () => {
    const state = createTestMatch();
    const knowledge = getPlayerKnowledge(state, 'r-a');
    const floors = knowledge.knownTerrain.filter((t) => t.kind === 'floor');
    expect(floors.some((f) => f.x === 2 && f.y === 2)).toBe(true);
    // Everything known is within the initial 3-cell cone from (2,2) facing north.
    expect(floors.every((f) => Math.abs(f.x - 2) <= 3 && f.y <= 2 && f.y >= 0)).toBe(true);
    expect(floors.length).toBeLessThan(15);
    expect(knowledge.knownTerrain.some((t) => t.kind === 'wall' && 'side' in t)).toBe(true);
    expect(knowledge.knownActiveExits).toEqual([]);
    expect(knowledge.mapVersion).toBeGreaterThanOrEqual(1);
  });

  it('starts a tagger with its whole territory terrain and no player positions', () => {
    const state = createTestMatch();
    const territory = state.layout.territories.find((t) => t.playerId === 't-a')!;
    const knowledge = getPlayerKnowledge(state, 't-a');
    const floorKeys = new Set(
      knowledge.knownTerrain.filter((t) => t.kind === 'floor').map((t) => `${t.x},${t.y}`),
    );
    for (const cell of territory.cells) expect(floorKeys.has(`${cell.x},${cell.y}`)).toBe(true);
    // Bordering wall faces of the territory are known with a side.
    expect(knowledge.knownTerrain.filter((t) => t.kind === 'wall').length).toBeGreaterThan(0);
    // Knowledge carries no player, exit, or equipment fields.
    for (const entry of knowledge.knownTerrain) {
      expect(Object.keys(entry).sort()).toEqual(
        entry.kind === 'floor' ? ['kind', 'x', 'y'] : ['kind', 'side', 'x', 'y'],
      );
    }
    expect(knowledge.knownActiveExits).toEqual([]);
  });

  it('keeps mapVersion stable on repeated identical sight and bumps it once per new observation', () => {
    const start = startedMatch(100);
    const v0 = getPlayerKnowledge(start, 'r-a').mapVersion;
    let state = step(start, 101).state;
    state = step(state, 102).state;
    expect(getPlayerKnowledge(state, 'r-a').mapVersion).toBe(v0);
    // Turn right: new faces/cells to the east come into view exactly once.
    let turned = step(state, 103, [command('r-a', 'TURN', { direction: 'right' })]).state;
    for (let tick = 104; tick <= 109; tick += 1) turned = step(turned, tick).state;
    const after = getPlayerKnowledge(turned, 'r-a');
    expect(after.mapVersion).toBeGreaterThan(v0);
    const before = new Set(
      getPlayerKnowledge(start, 'r-a').knownTerrain.map((t) => JSON.stringify(t)),
    );
    for (const entry of before)
      expect(after.knownTerrain.map((t) => JSON.stringify(t))).toContain(entry);
    const settled = step(turned, 110).state;
    expect(getPlayerKnowledge(settled, 'r-a').mapVersion).toBe(after.mapVersion);
  });

  it('pure helpers return the same record when nothing new is observed', () => {
    const state = createTestMatch();
    const topology = state.layout.topology;
    const record = initialTerrain(topology, { x: 2, y: 2 }, null);
    expect(record.mapVersion).toBe(1);
    const same = observeTerrain(topology, record, {
      visibleCells: [{ x: 2, y: 2 }],
      visibleWallFaces: [],
    });
    expect(same).toBe(record);
    const grown = observeTerrain(topology, record, {
      visibleCells: [{ x: 2, y: 1 }],
      visibleWallFaces: [{ x: 2, y: 0, side: 2 }],
    });
    expect(grown.mapVersion).toBe(2);
    expect(grown.floors.size).toBe(2);
    expect(grown.walls.size).toBe(1);
    expect(record.floors.size).toBe(1);
  });

  it('never mixes current visibility into memory: memory persists after looking away', () => {
    const start = startedMatch(100);
    let state = step(start, 101, [command('r-a', 'TURN', { direction: 'right' })]).state;
    for (let tick = 102; tick <= 107; tick += 1) state = step(state, tick).state;
    const knownEast = getPlayerKnowledge(state, 'r-a').knownTerrain.filter(
      (t) => t.kind === 'floor' && t.x > 2,
    );
    expect(knownEast.length).toBeGreaterThan(0);
    // Turn back north: east cells leave the current mask but remain known.
    state = step(state, 108, [command('r-a', 'TURN', { direction: 'left' })]).state;
    for (let tick = 109; tick <= 114; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-a').dir).toBe(0);
    const still = getPlayerKnowledge(state, 'r-a').knownTerrain.filter(
      (t) => t.kind === 'floor' && t.x > 2,
    );
    expect(still.length).toBe(knownEast.length);
  });
});

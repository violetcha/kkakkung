import { describe, expect, it } from 'vitest';

import { preparePracticeLayout } from '../../src/match/map/prepare-practice-layout.js';
import type { RosterEntry } from '../../src/match/types.js';
import { clone, loadPractice } from './helpers.js';

type PracticeFile = {
  practiceVersion: string;
  layouts: Record<
    'runner' | 'tagger',
    {
      layoutId: string;
      topology: { width: number; height: number; walkable: boolean[]; topologyVersion: string };
      players: { playerId: string; role: string; cell: { x: number; y: number }; dir: number }[];
      exits: unknown[];
      territories: { playerId: string; cells: { x: number; y: number }[] }[];
    }
  >;
};

const runners: RosterEntry[] = [
  { playerId: 'p-z', role: 'runner' },
  { playerId: 'p-a', role: 'runner' },
  { playerId: 'p-m', role: 'runner' },
];

describe('practice-v1 layout preparation', () => {
  it('binds one to three same-role players to the stable slots in default string order', () => {
    const raw = loadPractice() as PracticeFile;
    const before = JSON.stringify(raw);
    const one = preparePracticeLayout(raw, [runners[0]!], 'runner');
    expect(one.status).toBe('ready');
    if (one.status !== 'ready') return;
    expect(one.layout.players).toEqual([
      { playerId: 'p-z', role: 'runner', cell: { x: 2, y: 2 }, dir: 2 },
    ]);
    expect(one.layout.exits).toEqual([]);
    expect(one.layout.territories).toEqual([]);
    const three = preparePracticeLayout(raw, runners, 'runner');
    expect(three.status).toBe('ready');
    if (three.status !== 'ready') return;
    // Sorted ids: p-a -> runner-1, p-m -> runner-2, p-z -> runner-3.
    expect(three.layout.players.map((p) => p.playerId)).toEqual(['p-a', 'p-m', 'p-z']);
    expect(three.layout.players.map((p) => p.cell)).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 12 },
      { x: 12, y: 12 },
    ]);
    expect(JSON.stringify(three.layout)).not.toMatch(/"runner-[123]"/);
    expect(JSON.stringify(raw)).toBe(before);
    expect(three.layout.topology.width).toBe(16);
  });

  it('gives taggers their own start cells and territories, isolated from the runner layout', () => {
    const raw = loadPractice() as PracticeFile;
    const taggers = preparePracticeLayout(
      raw,
      [
        { playerId: 't-b', role: 'tagger' },
        { playerId: 't-a', role: 'tagger' },
      ],
      'tagger',
    );
    expect(taggers.status).toBe('ready');
    if (taggers.status !== 'ready') return;
    expect(taggers.layout.players.map((p) => p.playerId)).toEqual(['t-a', 't-b']);
    expect(taggers.layout.territories.map((t) => t.playerId)).toEqual(['t-a', 't-b']);
    expect(taggers.layout.territories.every((t) => t.cells.length > 0)).toBe(true);
    const runnerCells = new Set(raw.layouts.runner.players.map((p) => `${p.cell.x},${p.cell.y}`));
    for (const p of taggers.layout.players)
      expect(runnerCells.has(`${p.cell.x},${p.cell.y}`)).toBe(false);
  });

  it('rejects four players, mixed roles, duplicate ids, and empty rosters with a path', () => {
    const raw = loadPractice();
    expect(
      preparePracticeLayout(
        raw,
        ['a', 'b', 'c', 'd'].map((id) => ({ playerId: id, role: 'runner' as const })),
        'runner',
      ),
    ).toEqual({ status: 'invalid', code: 'INVALID_PRACTICE_LAYOUT', path: ['players'] });
    expect(
      preparePracticeLayout(raw, [runners[0]!, { playerId: 'x', role: 'tagger' }], 'runner'),
    ).toMatchObject({ status: 'invalid', path: ['players', 1, 'role'] });
    expect(preparePracticeLayout(raw, [runners[0]!, runners[0]!], 'runner')).toMatchObject({
      status: 'invalid',
      path: ['players', 1, 'playerId'],
    });
    expect(preparePracticeLayout(raw, [], 'runner')).toMatchObject({ status: 'invalid' });
  });

  it('rejects bad slots, wall starts, blocked facing, and broken topology', () => {
    const base = loadPractice() as PracticeFile;
    const badSlot = clone(base);
    badSlot.layouts.runner.players[0]!.playerId = 'runner-9';
    expect(preparePracticeLayout(badSlot, runners, 'runner')).toMatchObject({
      status: 'invalid',
      path: ['layouts', 'runner', 'players', 0, 'playerId'],
    });
    const wallStart = clone(base);
    wallStart.layouts.runner.players[0]!.cell = { x: 0, y: 0 };
    expect(preparePracticeLayout(wallStart, runners, 'runner')).toMatchObject({
      status: 'invalid',
      path: ['layouts', 'runner', 'players', 0, 'cell'],
    });
    const facingWall = clone(base);
    facingWall.layouts.runner.players[0]!.dir = 3; // (2,2) facing west -> (1,2) is passage; use (1,1)
    facingWall.layouts.runner.players[0]!.cell = { x: 1, y: 1 };
    expect(preparePracticeLayout(facingWall, runners, 'runner')).toMatchObject({
      status: 'invalid',
      path: ['layouts', 'runner', 'players', 0, 'dir'],
    });
    const broken = clone(base);
    broken.layouts.runner.topology.walkable[0] = true; // outer ring passage
    expect(preparePracticeLayout(broken, runners, 'runner')).toMatchObject({
      status: 'invalid',
      path: ['layouts', 'runner', 'topology', 'walkable', 0],
    });
    const withExit = clone(base);
    withExit.layouts.runner.exits.push({});
    expect(preparePracticeLayout(withExit, runners, 'runner')).toMatchObject({
      status: 'invalid',
      path: ['layouts', 'runner', 'exits'],
    });
    expect(preparePracticeLayout(null, runners, 'runner')).toMatchObject({ status: 'invalid' });
  });

  it('does not apply match-only constraints (6 players, 3 exits, distances) to the small map', () => {
    const raw = loadPractice();
    const two = preparePracticeLayout(raw, runners.slice(0, 2), 'runner');
    expect(two.status).toBe('ready');
    if (two.status !== 'ready') return;
    expect(two.layout.players).toHaveLength(2);
    expect(two.layout.exits).toHaveLength(0);
  });
});

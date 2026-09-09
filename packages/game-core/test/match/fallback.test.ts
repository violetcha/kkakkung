import { describe, expect, it } from 'vitest';

import {
  bindFallbackPlayers,
  certifyFallback,
  createLayoutSelector,
  selectWithFallback,
} from '../../src/match/map/select-with-fallback.js';
import { selectLayout } from '../../src/match/map/select-layout.js';
import { validateTuning } from '../../src/match/tuning.js';
import type {
  FallbackLayout,
  LayoutConstraints,
  LayoutSelectionInput,
  LayoutSelectionResult,
  MatchLayout,
  RosterEntry,
} from '../../src/match/types.js';
import { loadFallback, loadTuning, masterTemplate } from './helpers.js';

const tuning = validateTuning(loadTuning());
if (!tuning.ok) throw new Error('tuning invalid');
const constraints: LayoutConstraints = tuning.template.layout;
const template = masterTemplate();

const sessionPlayers: RosterEntry[] = [
  { playerId: 'session-r-b', role: 'runner' },
  { playerId: 'session-t-a', role: 'tagger' },
  { playerId: 'session-r-Z', role: 'runner' },
  { playerId: 'session-t-10', role: 'tagger' },
  { playerId: 'session-r-2', role: 'runner' },
  { playerId: 'session-t-Z', role: 'tagger' },
];

type FallbackFile = { fallbacks: FallbackLayout[] };

function identityFallback(): FallbackLayout {
  const file = loadFallback() as FallbackFile;
  const found = file.fallbacks.find((f) => f.variantId === 'r0');
  if (!found) throw new Error('r0 fallback missing');
  return found;
}

function input(overrides: Partial<LayoutSelectionInput> = {}): LayoutSelectionInput {
  return {
    template,
    players: sessionPlayers,
    seed: 204,
    maxAttempts: 256,
    fallback: identityFallback(),
    ...overrides,
  };
}

/** Constraints no layout can satisfy, so every online attempt fails. */
const impossible: LayoutConstraints = { ...constraints, minRunnerDistance: 10_000 };

describe('slot binding', () => {
  it('binds slots to role-sorted session ids without touching the inputs', () => {
    const stored = identityFallback().layout;
    const before = JSON.stringify(stored);
    const bound = bindFallbackPlayers(stored, sessionPlayers);
    expect(JSON.stringify(stored)).toBe(before);
    expect(bound).not.toBeNull();
    if (!bound) return;
    const byId = new Map(bound.players.map((p) => [p.playerId, p]));
    expect([...byId.keys()].sort()).toEqual(
      [
        'session-r-2',
        'session-r-Z',
        'session-r-b',
        'session-t-10',
        'session-t-Z',
        'session-t-a',
      ].sort(),
    );
    // tagger-1 -> session-t-10, tagger-2 -> session-t-Z, tagger-3 -> session-t-a
    expect(byId.get('session-t-10')!.cell).toEqual({ x: 8, y: 16 });
    expect(byId.get('session-t-Z')!.cell).toEqual({ x: 16, y: 12 });
    expect(byId.get('session-t-a')!.cell).toEqual({ x: 25, y: 16 });
    // runner-1 -> session-r-2, runner-2 -> session-r-Z, runner-3 -> session-r-b
    expect(byId.get('session-r-2')!.cell).toEqual({ x: 2, y: 2 });
    expect(byId.get('session-r-Z')!.cell).toEqual({ x: 29, y: 2 });
    expect(byId.get('session-r-b')!.cell).toEqual({ x: 16, y: 30 });
    expect(bound.exits.map((e) => e.ownerId)).toEqual([
      'session-r-2',
      'session-r-Z',
      'session-r-b',
    ]);
    expect(bound.territories.map((t) => t.playerId)).toEqual([
      'session-t-10',
      'session-t-Z',
      'session-t-a',
    ]);
    const leftovers = JSON.stringify(bound).match(/"(tagger|runner)-[1-3]"/g);
    expect(leftovers).toBeNull();
    expect(bindFallbackPlayers(stored, [...sessionPlayers].reverse())).toEqual(bound);
  });

  it('returns null for missing slots, wrong slot roles, bad rosters, and unknown references', () => {
    const stored = identityFallback().layout;
    expect(
      bindFallbackPlayers({ ...stored, players: stored.players.slice(0, 5) }, sessionPlayers),
    ).toBeNull();
    expect(
      bindFallbackPlayers(
        {
          ...stored,
          players: stored.players.map((p) =>
            p.playerId === 'tagger-1' ? { ...p, role: 'runner' as const } : p,
          ),
        },
        sessionPlayers,
      ),
    ).toBeNull();
    expect(
      bindFallbackPlayers(
        stored,
        sessionPlayers.map((p) =>
          p.playerId === 'session-t-10' ? { ...p, role: 'runner' as const } : p,
        ),
      ),
    ).toBeNull();
    expect(
      bindFallbackPlayers(stored, [...sessionPlayers.slice(0, 5), sessionPlayers[0]!]),
    ).toBeNull();
    expect(
      bindFallbackPlayers(
        {
          ...stored,
          exits: stored.exits.map((e, i) => (i === 0 ? { ...e, ownerId: 'runner-9' } : e)),
        },
        sessionPlayers,
      ),
    ).toBeNull();
    expect(
      bindFallbackPlayers(
        {
          ...stored,
          territories: stored.territories.map((t, i) =>
            i === 0 ? { ...t, playerId: 'runner-1' } : t,
          ),
        },
        sessionPlayers,
      ),
    ).toBeNull();
  });
});

describe('certifyFallback', () => {
  it('certifies the stored identity fallback for the current roster', () => {
    const result = certifyFallback(input(), constraints);
    expect(result.status).toBe('selected');
    if (result.status !== 'selected') return;
    expect(result.source).toBe('fallback');
    expect(result.layout.players.map((p) => p.playerId).sort()).toEqual(
      sessionPlayers.map((p) => p.playerId).sort(),
    );
  });

  it('fails when any of the four source fields differs', () => {
    const fallback = identityFallback();
    for (const field of ['templateId', 'templateVersion', 'templateHash', 'variantId'] as const) {
      const result = certifyFallback(
        input({ fallback: { ...fallback, [field]: `${fallback[field]}x` } }),
        constraints,
      );
      expect(result).toEqual({ status: 'unavailable', code: 'LAYOUT_UNAVAILABLE' });
    }
  });

  it('fails when the template terrain changed even though the source fields still match', () => {
    const walkable = [...template.topology.walkable];
    // Wall the fixture path cell (11,23) and (10,22) ... block the approach (11,22) entirely.
    const w = template.topology.width;
    for (const [x, y] of [
      [11, 21],
      [11, 23],
      [10, 22],
    ] as const) {
      walkable[y * w + x] = false;
    }
    const changed = { ...template, topology: { ...template.topology, walkable } };
    const result = certifyFallback(input({ template: changed }), constraints);
    expect(result).toEqual({ status: 'unavailable', code: 'LAYOUT_UNAVAILABLE' });
  });

  it('fails for a start outside its assigned region and for a roster with wrong role counts', () => {
    const fallback = identityFallback();
    const moved: MatchLayout = {
      ...fallback.layout,
      players: fallback.layout.players.map((p) =>
        p.playerId === 'runner-1' ? { ...p, cell: { x: 10, y: 2 } } : p,
      ),
    };
    expect(
      certifyFallback(input({ fallback: { ...fallback, layout: moved } }), constraints).status,
    ).toBe('unavailable');
    const badRoster = sessionPlayers.map((p) =>
      p.playerId === 'session-t-10' ? { ...p, role: 'runner' as const } : p,
    );
    expect(certifyFallback(input({ players: badRoster }), constraints).status).toBe('unavailable');
  });
});

describe('selectWithFallback generator', () => {
  it('returns the certified fallback immediately when maxAttempts is 0', () => {
    const generator = selectWithFallback(input({ maxAttempts: 0 }), constraints, 8);
    const first = generator.next();
    expect(first.done).toBe(true);
    expect(first.value).toMatchObject({ status: 'selected', source: 'fallback' });
  });

  it('examines at most 8 candidates per next() and carries state between yields', () => {
    const generator = selectWithFallback(input({ maxAttempts: 17 }), impossible, 8);
    const first = generator.next();
    expect(first).toEqual({ done: false, value: { attempted: 8, batchAttempts: 8 } });
    const second = generator.next();
    expect(second).toEqual({ done: false, value: { attempted: 16, batchAttempts: 8 } });
    const third = generator.next();
    expect(third.done).toBe(true);
    // Online search exhausted; the fallback is certified with the same impossible constraints -> unavailable.
    expect(third.value).toEqual({ status: 'unavailable', code: 'LAYOUT_UNAVAILABLE' });
    const again = selectWithFallback(input({ maxAttempts: 17 }), impossible, 8);
    expect([again.next(), again.next(), again.next()]).toEqual([first, second, third]);
  });

  it('falls back to the certified layout when online attempts are exhausted', () => {
    // Online selection is impossible only because of the runner distance constraint,
    // but the fallback was certified with the real constraints.
    const generator = selectWithFallback(input({ maxAttempts: 3 }), constraints, 8);
    const onlineFirst = generator.next();
    expect(onlineFirst.done).toBe(true);
    expect(onlineFirst.value).toMatchObject({ status: 'selected' });
  });

  it('stops after return(certifiedResult) without further attempts', () => {
    const certified = certifyFallback(input(), constraints);
    const generator = selectWithFallback(input({ maxAttempts: 64 }), impossible, 8);
    expect(generator.next().done).toBe(false);
    const closed = generator.return(certified);
    expect(closed).toEqual({ done: true, value: certified });
    expect(generator.next()).toEqual({ done: true, value: undefined });
  });

  it('is deterministic for the same seed and roster order and yields an online layout that revalidates', () => {
    const run = (): LayoutSelectionResult => {
      const generator = selectWithFallback(input({ seed: 9 }), constraints, 8);
      let step = generator.next();
      while (!step.done) step = generator.next();
      return step.value;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.status).toBe('selected');
    if (a.status !== 'selected') return;
    expect(a.source).toBe('online');
    const direct = selectLayout(template, sessionPlayers, 9, 256, constraints);
    expect(direct.ok && direct.layout).toEqual(a.layout);
  });

  it('exposes the EXEC-CONTRACT-3 port through createLayoutSelector', () => {
    const selector = createLayoutSelector(tuning.template);
    expect(selector.certifyFallback(input()).status).toBe('selected');
    const generator = selector.selectWithFallback(input({ maxAttempts: 8 }));
    const first = generator.next();
    expect(first.done).toBe(true);
    expect(() => selectWithFallback(input(), constraints, 0).next()).toThrow(RangeError);
  });
});

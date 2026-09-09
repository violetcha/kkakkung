import { describe, expect, it } from 'vitest';

import {
  activeExitAtFace,
  activeExits,
  closeExit,
  createExitRegistry,
  exitOfOwner,
  toKnownExit,
} from '../../src/match/exits/registry.js';
import type { LayoutExit } from '../../src/match/types.js';
import { masterTemplate } from './helpers.js';

const topology = masterTemplate().topology;
const runners = ['r1', 'r2', 'r3'];
const exits: LayoutExit[] = [
  {
    exitId: 'e1',
    ownerId: 'r1',
    wall: { x: 12, y: 22, side: 3 },
    approach: { x: 11, y: 22 },
    poseKind: 'left',
  },
  {
    exitId: 'e2',
    ownerId: 'r2',
    wall: { x: 24, y: 22, side: 1 },
    approach: { x: 25, y: 22 },
    poseKind: 'right',
  },
  {
    exitId: 'e3',
    ownerId: 'r3',
    wall: { x: 6, y: 10, side: 1 },
    approach: { x: 7, y: 10 },
    poseKind: 'y',
  },
];

describe('exit registry creation', () => {
  it('gives each of three runners one exit with distinct approach cells', () => {
    const result = createExitRegistry(topology, exits, runners);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.size).toBe(3);
    expect(exitOfOwner(result.registry, 'r2')?.approach).toEqual({ x: 25, y: 22 });
    expect(exitOfOwner(result.registry, 'r2')?.poseKind).toBe('right');
    expect(activeExits(result.registry)).toHaveLength(3);
    expect(toKnownExit(exitOfOwner(result.registry, 'r1')!)).toEqual({
      exitId: 'e1',
      ownerId: 'r1',
      wall: { x: 12, y: 22, side: 3 },
      approach: { x: 11, y: 22 },
    });
    expect(Object.keys(toKnownExit(exitOfOwner(result.registry, 'r1')!))).not.toContain('poseKind');
  });

  it('rejects two exits on the same approach cell and exits on the outer wall', () => {
    const sameApproach = createExitRegistry(
      topology,
      exits.map((e, i) =>
        i === 1
          ? { ...e, wall: { x: 12, y: 22, side: 3 as const }, approach: { x: 11, y: 22 } }
          : e,
      ),
      runners,
    );
    expect(sameApproach.ok).toBe(false);
    if (!sameApproach.ok)
      expect(['DUPLICATE_APPROACH', 'DUPLICATE_WALL']).toContain(sameApproach.error.code);
    const outer = createExitRegistry(
      topology,
      exits.map((e, i) =>
        i === 0 ? { ...e, wall: { x: 5, y: 0, side: 2 as const }, approach: { x: 5, y: 1 } } : e,
      ),
      runners,
    );
    expect(outer).toMatchObject({ ok: false, error: { code: 'OUTER_WALL' } });
  });

  it('rejects owner/count/approach mismatches and passage walls', () => {
    expect(createExitRegistry(topology, exits.slice(0, 2), runners)).toMatchObject({
      ok: false,
      error: { code: 'EXIT_COUNT' },
    });
    expect(
      createExitRegistry(
        topology,
        exits.map((e, i) => (i === 1 ? { ...e, ownerId: 'r1' } : e)),
        runners,
      ),
    ).toMatchObject({ ok: false, error: { code: 'DUPLICATE_OWNER' } });
    expect(
      createExitRegistry(
        topology,
        exits.map((e, i) => (i === 1 ? { ...e, ownerId: 'ghost' } : e)),
        runners,
      ),
    ).toMatchObject({ ok: false, error: { code: 'UNKNOWN_OWNER' } });
    expect(
      createExitRegistry(
        topology,
        exits.map((e, i) => (i === 0 ? { ...e, approach: { x: 13, y: 22 } } : e)),
        runners,
      ),
    ).toMatchObject({ ok: false, error: { code: 'APPROACH_MISMATCH' } });
    expect(
      createExitRegistry(
        topology,
        exits.map((e, i) =>
          i === 0
            ? { ...e, wall: { x: 11, y: 22, side: 3 as const }, approach: { x: 10, y: 22 } }
            : e,
        ),
        runners,
      ),
    ).toMatchObject({ ok: false, error: { code: 'NOT_WALL' } });
  });
});

describe('exit closing', () => {
  it('closes once, keeps the record and pose, and never reassigns the owner', () => {
    const created = createExitRegistry(topology, exits, runners);
    if (!created.ok) throw new Error('registry');
    const first = closeExit(created.registry, 'r1');
    expect(first.closedExitId).toBe('e1');
    expect(first.registry.get('e1')).toMatchObject({
      active: false,
      ownerId: 'r1',
      poseKind: 'left',
    });
    expect(activeExits(first.registry).map((e) => e.exitId)).toEqual(['e2', 'e3']);
    const second = closeExit(first.registry, 'r1');
    expect(second.closedExitId).toBeNull();
    expect(second.registry).toBe(first.registry);
    expect(closeExit(first.registry, 'nobody').closedExitId).toBeNull();
    // Original registry untouched.
    expect(created.registry.get('e1')?.active).toBe(true);
    expect(activeExitAtFace(first.registry, { x: 12, y: 22, side: 3 })).toBeNull();
    expect(activeExitAtFace(first.registry, { x: 24, y: 22, side: 1 })?.exitId).toBe('e2');
    // Neighboring face of the same wall cell does not match.
    expect(activeExitAtFace(first.registry, { x: 24, y: 22, side: 0 })).toBeNull();
  });
});

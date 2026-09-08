import { describe, expect, it } from 'vitest';
import { RematchCoordinator } from '../../src/rooms/RematchCoordinator.js';

const roles = new Map([
  ['a', 'runner' as const],
  ['b', 'runner' as const],
  ['c', 'runner' as const],
  ['d', 'tagger' as const],
  ['e', 'tagger' as const],
  ['f', 'tagger' as const],
]);
const remaining = ['a', 'b', 'c', 'd', 'e'];

describe('RematchCoordinator', () => {
  it('accepts only the host in RESULT/ABORTED and plans same/swap/lobby roles', () => {
    const rematch = new RematchCoordinator();
    expect(
      rematch.apply({
        actorId: 'a',
        hostId: 'a',
        phase: 'PLAYING',
        mode: 'same',
        currentRoles: roles,
        remainingPlayers: remaining,
      }),
    ).toMatchObject({ result: 'rejected', code: 'INVALID_PHASE' });
    expect(
      rematch.apply({
        actorId: 'b',
        hostId: 'a',
        phase: 'RESULT',
        mode: 'same',
        currentRoles: roles,
        remainingPlayers: remaining,
      }),
    ).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    const swap = rematch.apply({
      actorId: 'a',
      hostId: 'a',
      phase: 'RESULT',
      mode: 'swap',
      currentRoles: roles,
      remainingPlayers: remaining,
    });
    expect(swap.result).toBe('applied');
    expect([...swap.plan!.entries()]).toEqual([
      ['a', 'tagger'],
      ['b', 'tagger'],
      ['c', 'tagger'],
      ['d', 'runner'],
      ['e', 'runner'],
    ]);
    // A repeated request is idempotent and does not overwrite the plan.
    expect(
      rematch.apply({
        actorId: 'a',
        hostId: 'a',
        phase: 'RESULT',
        mode: 'lobby',
        currentRoles: roles,
        remainingPlayers: remaining,
      }).mode,
    ).toBe('swap');
    expect(rematch.canStart({ mediaRetirementConfirmed: false })).toBe(false);
    expect(rematch.canStart({ mediaRetirementConfirmed: true })).toBe(true);
    expect(rematch.take()?.mode).toBe('swap');
    expect(rematch.pending).toBeNull();
  });

  it('keeps roles for same and clears the plan for lobby', () => {
    const rematch = new RematchCoordinator();
    const same = rematch.apply({
      actorId: 'a',
      hostId: 'a',
      phase: 'ABORTED',
      mode: 'same',
      currentRoles: roles,
      remainingPlayers: remaining,
    });
    expect(same.plan?.get('a')).toBe('runner');
    expect(same.plan?.has('f')).toBe(false);
    rematch.take();
    const lobby = rematch.apply({
      actorId: 'a',
      hostId: 'a',
      phase: 'ABORTED',
      mode: 'lobby',
      currentRoles: roles,
      remainingPlayers: remaining,
    });
    expect(lobby).toMatchObject({ result: 'applied', mode: 'lobby', plan: null });
  });
});

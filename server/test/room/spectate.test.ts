/**
 * S15P21C204-269. Who an ended runner watches. Pure reads of the core frame: no rules change.
 */
import { describe, expect, it } from 'vitest';
import type { GameSubject } from '../../src/game/ports.js';
import {
  chooseSpectateTarget,
  isSpectator,
  receivesMedia,
  spectateCandidates,
  spectatorLinks,
} from '../../src/game/Spectate.js';

const subject = (
  playerId: string,
  role: GameSubject['role'],
  status: GameSubject['status'] = 'ACTIVE',
): GameSubject => ({ playerId, role, status, cell: { x: 1, y: 1 }, dir: 0, action: null });

const roster = (over: Partial<Record<string, GameSubject['status']>> = {}) => [
  subject('t1', 'tagger', over.t1),
  subject('t2', 'tagger', over.t2),
  subject('t3', 'tagger', over.t3),
  subject('r1', 'runner', over.r1),
  subject('r2', 'runner', over.r2),
  subject('r3', 'runner', over.r3),
];

describe('spectate target choice', () => {
  it('lets only an ended runner spectate, and only surviving runners are candidates', () => {
    const frame = roster({ r1: 'CAPTURED' });
    expect(isSpectator(frame, 'r1')).toBe(true);
    expect(isSpectator(frame, 'r2')).toBe(false);
    expect(isSpectator(frame, 't1')).toBe(false);
    expect(spectateCandidates(frame, 'r1')).toEqual(['r2', 'r3']);
    expect(chooseSpectateTarget(frame, 'r2', null)).toBeNull();
    expect(chooseSpectateTarget(frame, 't1', 'r2')).toBeNull();
  });

  it('honours a chosen surviving runner, else falls back to roster order', () => {
    const frame = roster({ r1: 'CAPTURED' });
    expect(chooseSpectateTarget(frame, 'r1', undefined)).toBe('r2');
    expect(chooseSpectateTarget(frame, 'r1', 'r3')).toBe('r3');
    // A tagger, oneself or an unknown id is never a target.
    expect(chooseSpectateTarget(frame, 'r1', 't1')).toBe('r2');
    expect(chooseSpectateTarget(frame, 'r1', 'r1')).toBe('r2');
    expect(chooseSpectateTarget(frame, 'r1', 'ghost')).toBe('r2');
  });

  it('moves on when the chosen target ends, and stops when no runner survives', () => {
    expect(chooseSpectateTarget(roster({ r1: 'CAPTURED', r3: 'ESCAPED' }), 'r1', 'r3')).toBe('r2');
    expect(
      chooseSpectateTarget(roster({ r1: 'CAPTURED', r2: 'CAPTURED', r3: 'ESCAPED' }), 'r1', 'r2'),
    ).toBeNull();
  });

  it('links every ended runner for the media frame, an escaped one included', () => {
    const links = spectatorLinks(
      roster({ r1: 'CAPTURED', r3: 'ESCAPED' }),
      new Map([['r3', 'r2']]),
    );
    expect(links).toEqual([
      { playerId: 'r1', targetId: 'r2' },
      { playerId: 'r3', targetId: 'r2' },
    ]);
    expect(spectatorLinks(roster(), new Map())).toEqual([]);
  });
});

// S15P21C204-380. The room half of media eligibility: ACTIVE players, and watching ended runners.
describe('media eligibility', () => {
  it('lets an ACTIVE player and a watching ended runner take a grant while spectating is on', () => {
    const frame = roster({ r1: 'CAPTURED' });
    expect(receivesMedia(frame, 'r2', undefined, true)).toBe(true);
    expect(receivesMedia(frame, 't1', undefined, false)).toBe(true);
    expect(receivesMedia(frame, 'r1', undefined, true)).toBe(true);
  });

  it('refuses an ended runner outside a running game or with nobody left to watch', () => {
    expect(receivesMedia(roster({ r1: 'CAPTURED' }), 'r1', undefined, false)).toBe(false);
    const allEnded = roster({ r1: 'CAPTURED', r2: 'ESCAPED', r3: 'CAPTURED' });
    expect(receivesMedia(allEnded, 'r1', undefined, true)).toBe(false);
    expect(receivesMedia(roster(), 'ghost', undefined, true)).toBe(false);
  });
});

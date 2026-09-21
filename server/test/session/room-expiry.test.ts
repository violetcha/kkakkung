import { describe, expect, it } from 'vitest';
import { RoomExpiry, selectHost } from '../../src/session/RoomExpiry.js';

describe('RoomExpiry', () => {
  it('expires idle or session-less waiting rooms but never a running match', () => {
    const expiry = new RoomExpiry(10_000, 10_000);
    expect(
      expiry.decide({
        phase: 'LOBBY',
        connectedCount: 2,
        liveSessionCount: 2,
        lastActivityMs: 0,
        nowMs: 9_999,
      }),
    ).toBe('keep');
    expect(
      expiry.decide({
        phase: 'LOBBY',
        connectedCount: 2,
        liveSessionCount: 2,
        lastActivityMs: 0,
        nowMs: 10_000,
      }),
    ).toBe('expire-idle');
    expect(
      expiry.decide({
        phase: 'DEVICE_CHECK',
        connectedCount: 0,
        liveSessionCount: 1,
        lastActivityMs: 0,
        nowMs: 10_000,
      }),
    ).toBe('expire-empty');
    expect(
      expiry.decide({
        phase: 'DEVICE_CHECK',
        connectedCount: 5,
        liveSessionCount: 5,
        lastActivityMs: 0,
        phaseStartedAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe('recover-device-check');
    expect(
      expiry.decide({
        phase: 'LOBBY',
        connectedCount: 0,
        liveSessionCount: 0,
        lastActivityMs: 0,
        nowMs: 1,
      }),
    ).toBe('expire-sessions');
    expect(
      expiry.decide({
        phase: 'PLAYING',
        connectedCount: 0,
        liveSessionCount: 0,
        lastActivityMs: 0,
        nowMs: 999_999,
      }),
    ).toBe('keep');
  });

  it('records missing configuration instead of inventing an idle TTL', () => {
    const expiry = new RoomExpiry(null);
    expect(expiry.productionReady).toBe(false);
    expect(
      expiry.decide({
        phase: 'LOBBY',
        connectedCount: 1,
        liveSessionCount: 1,
        lastActivityMs: 0,
        nowMs: 10_000_000,
      }),
    ).toBe('keep');
    expect(() => new RoomExpiry(0)).toThrow('INVALID_ROOM_IDLE_TTL');
  });

  it('caps preparation and ended phases from phase entry even when activity keeps arriving', () => {
    const expiry = new RoomExpiry(600_000);
    for (const phase of ['DEVICE_CHECK', 'RESULT', 'ABORTED'] as const) {
      const input = {
        phase,
        connectedCount: 6,
        liveSessionCount: 6,
        lastActivityMs: 299_999,
        phaseStartedAtMs: 0,
        nowMs: 299_999,
      };
      expect(expiry.remainingMs(input)).toBe(1);
      expect(expiry.decide(input)).toBe('keep');
      expect(expiry.decide({ ...input, nowMs: 300_000 })).toBe(
        phase === 'DEVICE_CHECK' ? 'recover-device-check' : 'expire-idle',
      );
    }
    for (const phase of ['TEAM_PRACTICE', 'GAME_LOADING', 'COUNTDOWN', 'PLAYING'] as const)
      expect(expiry.remainingMs({ phase, lastActivityMs: 0, nowMs: 10_000_000 })).toBeNull();
  });

  it('delegates host to the earliest connected live participant', () => {
    const players = [
      { playerId: 'a', joinOrder: 0, connected: false, live: true },
      { playerId: 'c', joinOrder: 2, connected: true, live: true },
      { playerId: 'b', joinOrder: 1, connected: true, live: true },
    ];
    expect(selectHost(players, 'a')).toBe('b');
    expect(selectHost(players, 'c')).toBe('c');
    expect(
      selectHost(
        players.map((p) => ({ ...p, connected: false })),
        'a',
      ),
    ).toBeNull();
  });
});

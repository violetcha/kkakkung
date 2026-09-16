import { describe, expect, it } from 'vitest';
import { roomRosterSchema } from '@kkakkung/protocol/game-messages';
import { LobbyCoordinator } from '../../src/rooms/LobbyCoordinator.js';

function lobby(count: number) {
  const coordinator = new LobbyCoordinator({ random: () => 0.25 });
  for (let i = 0; i < count; i++) coordinator.add(`p${i}`, `닉${i}`, i);
  return coordinator;
}

describe('LobbyCoordinator', () => {
  it('waits in LOBBY below six players and returns from DEVICE_CHECK when someone leaves', () => {
    const two = lobby(2);
    expect(two.evaluate('LOBBY')).toBe('stay');
    const five = lobby(5);
    expect(five.evaluate('LOBBY')).toBe('stay');
    const six = lobby(6);
    expect(six.evaluate('LOBBY')).toBe('to-device-check');
    six.setConnected('p3', false);
    expect(six.evaluate('DEVICE_CHECK')).toBe('to-lobby');
  });

  it('rejects READY outside DEVICE_CHECK and applies only the sender own report idempotently', () => {
    const six = lobby(6);
    expect(six.applyReady('p0', true, 'LOBBY')).toEqual({
      result: 'rejected',
      code: 'INVALID_PHASE',
    });
    expect(six.applyReady('p0', true, 'DEVICE_CHECK')).toEqual({ result: 'applied', code: null });
    expect(six.applyReady('p0', true, 'DEVICE_CHECK')).toEqual({ result: 'applied', code: null });
    expect(six.applyReady('ghost', true, 'DEVICE_CHECK')).toEqual({
      result: 'rejected',
      code: 'NOT_ACTIVE',
    });
    expect(
      six
        .list()
        .filter((p) => p.ready)
        .map((p) => p.playerId),
    ).toEqual(['p0']);
    expect(six.evaluate('DEVICE_CHECK')).toBe('stay');
    for (let i = 1; i < 6; i++) six.applyReady(`p${i}`, true, 'DEVICE_CHECK');
    expect(six.evaluate('DEVICE_CHECK')).toBe('all-ready');
    expect(six.applyReady('p2', false, 'DEVICE_CHECK')).toEqual({ result: 'applied', code: null });
    expect(six.evaluate('DEVICE_CHECK')).toBe('stay');
  });

  it('assigns exactly three runners and three taggers, honouring a rematch plan for remaining players', () => {
    const six = lobby(6);
    const roles = six.assignRoles(null);
    expect([...roles.values()].filter((r) => r === 'runner')).toHaveLength(3);
    expect([...roles.values()].filter((r) => r === 'tagger')).toHaveLength(3);
    const plan = new Map([
      ['p0', 'tagger' as const],
      ['p1', 'tagger' as const],
      ['p2', 'runner' as const],
    ]);
    const planned = six.assignRoles(plan);
    expect(planned.get('p0')).toBe('tagger');
    expect(planned.get('p1')).toBe('tagger');
    expect(planned.get('p2')).toBe('runner');
    expect([...planned.values()].filter((r) => r === 'tagger')).toHaveLength(3);
    expect(() => lobby(5).assignRoles(null)).toThrow('ROLE_ASSIGNMENT_REQUIRES_FULL_ROOM');
  });

  it('marks a server-owned participant ready without a client report', () => {
    const six = lobby(5);
    six.add('demo-puppet-1', '인형 1', 100);
    expect(six.markSystemReady('demo-puppet-1')).toBe(true);
    expect(six.markSystemReady('nobody')).toBe(false);
    expect(six.evaluate('LOBBY')).toBe('to-device-check');
    for (let i = 0; i < 5; i++) six.applyReady(`p${i}`, true, 'DEVICE_CHECK');
    // The puppet's readiness counts like anyone else's, so the room can move on.
    expect(six.evaluate('DEVICE_CHECK')).toBe('all-ready');
  });

  it('publishes a roster without roles or coordinates and tracks the host', () => {
    const six = lobby(3);
    six.applyReady('p1', true, 'DEVICE_CHECK');
    const roster = six.roster('match-1', 7, 'DEVICE_CHECK');
    expect(roomRosterSchema.parse(roster)).toEqual(roster);
    expect(roster.hostId).toBe('p0');
    expect(roster.players.map((p) => p.ready)).toEqual([false, true, false]);
    expect(JSON.stringify(roster)).not.toMatch(/role|"x"|"y"|exit/);
    six.setConnected('p0', false);
    expect(six.host).toBe('p1');
  });
});

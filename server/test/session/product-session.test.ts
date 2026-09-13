import { describe, expect, it } from 'vitest';
import { ProductSessionStore, SESSION_LIMITS } from '../../src/session/ProductSessionStore.js';

function store() {
  let now = 1_000_000;
  const sessions = new ProductSessionStore({ now: () => now });
  return { sessions, advance: (ms: number) => (now += ms), now: () => now };
}

describe('ProductSessionStore', () => {
  it('bounds first admission by invitation expiry and preserves the claimed player lease', () => {
    const h = store();
    const issue = () =>
      h.sessions.issue({
        nickname: 'n',
        inviteId: 'inv',
        roomCode: 'ABC234',
        admissionDeadlineEpochMs: h.now() + 1000,
      });
    const pending = issue();
    const joined = issue();
    expect(h.sessions.claimConnection(joined.sessionId, 'joined')).toBe('claimed');
    h.advance(1000);
    expect(h.sessions.authenticate(pending.sessionToken)).toBeNull();
    expect(h.sessions.claimConnection(pending.sessionId, 'late')).toBe('invalid');
    expect(h.sessions.authenticate(joined.sessionToken)).not.toBeNull();
    for (const deadline of [h.now(), -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() =>
        h.sessions.issue({
          nickname: 'n',
          inviteId: 'inv',
          roomCode: 'ABC234',
          admissionDeadlineEpochMs: deadline,
        }),
      ).toThrow('INVALID_ADMISSION_DEADLINE');
  });
  it('issues random ids, authenticates without consuming and refuses a second concurrent connection', () => {
    const h = store();
    const a = h.sessions.issue({ nickname: '같은이름', inviteId: 'inv', roomCode: 'ABC234' });
    const b = h.sessions.issue({ nickname: '같은이름', inviteId: 'inv', roomCode: 'ABC234' });
    expect(a.playerId).not.toBe(b.playerId);
    expect(h.sessions.authenticate(a.sessionToken)?.playerId).toBe(a.playerId);
    expect(h.sessions.authenticate(a.sessionToken)?.playerId).toBe(a.playerId);
    expect(h.sessions.authenticate('not-issued')).toBeNull();
    expect(h.sessions.claimConnection(a.sessionId, 'conn-1')).toBe('claimed');
    expect(h.sessions.claimConnection(a.sessionId, 'conn-2')).toBe('busy');
    expect(h.sessions.claimConnection(a.sessionId, 'conn-1')).toBe('claimed');
    expect(h.sessions.activeConnection(a.sessionId)).toBe('conn-1');
    h.sessions.releaseConnection(a.sessionId, 'conn-2');
    expect(h.sessions.activeConnection(a.sessionId)).toBe('conn-1');
    h.sessions.releaseConnection(a.sessionId, 'conn-1');
    expect(h.sessions.claimConnection(a.sessionId, 'conn-2')).toBe('claimed');
  });

  it('extends the lease on real activity only and never beyond two hours from issue', () => {
    const h = store();
    const issued = h.sessions.issue({ nickname: 'n', inviteId: 'inv', roomCode: 'ABC234' });
    expect(issued.expiresAt).toBe(h.now() + SESSION_LIMITS.leaseTtlMs);
    h.sessions.claimConnection(issued.sessionId, 'first');
    h.advance(SESSION_LIMITS.leaseTtlMs - 1);
    expect(h.sessions.authenticate(issued.sessionToken)).not.toBeNull();
    // Presenting the token does not extend; the lease expires at the deadline.
    h.advance(1);
    expect(h.sessions.authenticate(issued.sessionToken)).toBeNull();
    const second = h.sessions.issue({ nickname: 'n', inviteId: 'inv', roomCode: 'ABC234' });
    h.sessions.claimConnection(second.sessionId, 'second');
    for (let i = 0; i < 10; i++) {
      h.advance(SESSION_LIMITS.leaseTtlMs - 1000);
      h.sessions.touch(second.sessionId);
    }
    const auth = h.sessions.get(second.sessionId);
    expect(auth).toBeNull();
  });

  it('expires an unclaimed admission without shortening the lease of a claimed session', () => {
    const h = store();
    const abandoned = h.sessions.issue({ nickname: 'a', inviteId: 'inv', roomCode: 'ABC234' });
    const joined = h.sessions.issue({ nickname: 'b', inviteId: 'inv', roomCode: 'ABC234' });
    h.advance(SESSION_LIMITS.admissionTtlMs - 1);
    expect(h.sessions.authenticate(abandoned.sessionToken)).not.toBeNull();
    expect(h.sessions.claimConnection(joined.sessionId, 'connection')).toBe('claimed');
    h.advance(1);
    expect(h.sessions.authenticate(abandoned.sessionToken)).toBeNull();
    expect(h.sessions.claimConnection(abandoned.sessionId, 'late')).toBe('invalid');
    expect(h.sessions.authenticate(joined.sessionToken)).not.toBeNull();
    h.sessions.releaseConnection(joined.sessionId, 'connection');
    h.sessions.prune();
    expect(h.sessions.size).toBe(1);
  });

  it('invalidates sessions on room end and refuses rejoin with the old token', () => {
    const h = store();
    const a = h.sessions.issue({ nickname: 'a', inviteId: 'inv', roomCode: 'ABC234' });
    const other = h.sessions.issue({ nickname: 'b', inviteId: 'inv', roomCode: 'ZZZ234' });
    h.sessions.claimConnection(a.sessionId, 'c1');
    h.sessions.invalidateRoom('ABC234');
    expect(h.sessions.authenticate(a.sessionToken)).toBeNull();
    expect(h.sessions.claimConnection(a.sessionId, 'c2')).toBe('invalid');
    expect(h.sessions.authenticate(other.sessionToken)).not.toBeNull();
    expect(h.sessions.sessionsInRoom('ABC234')).toEqual([]);
    h.sessions.prune();
    expect(h.sessions.size).toBe(1);
  });
});

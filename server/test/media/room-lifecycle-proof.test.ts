import { AccessToken } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import {
  confirmRoomSnapshot,
  createdRoomSnapshot,
  matchesRoomSnapshot,
  probeTokenWindow,
  requireValidProbeToken,
  verifyRecreatedRoomAccess,
  waitForDeletionWindow,
  type LifecycleObservation,
  type ProbeRoom,
} from './cloud/room-lifecycle-proof.js';

const names = ['source', 'face', 'receiver'];
const oldRooms = names.map((name) => ({ name, sid: `old-${name}` }));
const newRooms = names.map((name) => ({ name, sid: `new-${name}` }));
const oldSnapshot = createdRoomSnapshot(names, oldRooms);
const newSnapshot = createdRoomSnapshot(names, newRooms, oldSnapshot);

function clockFixture(deadline = Infinity) {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    clock: {
      now: () => now,
      guard: () => {
        if (now >= deadline) throw new Error('UNJOINED_PROBE_DEADLINE');
      },
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    },
  };
}

describe('same-name room recreation proof', () => {
  it('requires exact name/SID pairs even when a stale inventory has the expected length', () => {
    expect(matchesRoomSnapshot(oldRooms, newSnapshot)).toBe(false);
    expect(matchesRoomSnapshot([...newRooms].reverse(), newSnapshot)).toBe(true);
    expect(matchesRoomSnapshot([newRooms[0]!, newRooms[0]!, newRooms[2]!], newSnapshot)).toBe(
      false,
    );
    expect(matchesRoomSnapshot(newRooms.slice(1), newSnapshot)).toBe(false);
    expect(
      matchesRoomSnapshot([...newRooms, { name: 'foreign', sid: 'foreign' }], newSnapshot),
    ).toBe(false);
  });

  it.each([
    ['duplicate name', [newRooms[0]!, newRooms[0]!, newRooms[2]!]],
    ['foreign name', [newRooms[0]!, newRooms[1]!, { name: 'foreign', sid: 'new-foreign' }]],
    ['empty SID', [newRooms[0]!, newRooms[1]!, { name: names[2]!, sid: '' }]],
    ['duplicate SID', [newRooms[0]!, newRooms[1]!, { name: names[2]!, sid: newRooms[1]!.sid }]],
    ['missing room', newRooms.slice(1)],
  ] as const)('rejects %s in create acknowledgements', (_reason, rooms) => {
    expect(() => createdRoomSnapshot(names, rooms, oldSnapshot)).toThrow(
      'UNJOINED_PROBE_INVALID_ROOM_CREATION',
    );
  });

  it('rejects a deleted SID returned by create, including a SID previously owned by another room', () => {
    for (const room of oldRooms) {
      const response = [...newRooms.slice(0, 2), { name: names[2]!, sid: room.sid }];
      expect(() => createdRoomSnapshot(names, response, oldSnapshot)).toThrow(
        'UNJOINED_PROBE_REUSED_ROOM_SID',
      );
    }
  });

  it('observes a delayed new incarnation with at most three read-only attempts', async () => {
    const { clock, sleeps } = clockFixture();
    const observations: LifecycleObservation[] = [];
    const snapshots: ProbeRoom[][] = [[], oldRooms, newRooms];
    let reads = 0;
    await confirmRoomSnapshot({
      phase: 'recreation',
      expected: newSnapshot,
      previous: oldSnapshot,
      clock,
      read: async () => snapshots[reads++]!,
      record: (entry) => observations.push(entry),
    });
    expect(reads).toBe(3);
    expect(sleeps).toEqual([1000, 1000, 1000, 1000]);
    expect(observations).toEqual([
      { phase: 'recreation', attempt: 1, matched: false, newSid: false, elapsedMs: 0 },
      { phase: 'recreation', attempt: 2, matched: false, newSid: false, elapsedMs: 2000 },
      { phase: 'recreation', attempt: 3, matched: true, newSid: true, elapsedMs: 4000 },
    ]);
    expect(JSON.stringify(observations)).not.toContain('new-source');
    expect(JSON.stringify(observations)).not.toContain('old-source');
  });

  it('keeps a permanently stale/missing/duplicate inventory unconfirmed after the read cap', async () => {
    for (const rooms of [oldRooms, [], [newRooms[0]!, newRooms[0]!, newRooms[2]!]]) {
      const { clock } = clockFixture();
      let reads = 0;
      await expect(
        confirmRoomSnapshot({
          phase: 'recreation',
          expected: newSnapshot,
          previous: oldSnapshot,
          clock,
          read: async () => {
            reads++;
            return rooms;
          },
          record: () => {},
        }),
      ).rejects.toThrow('UNJOINED_PROBE_RECREATION_UNCONFIRMED');
      expect(reads).toBe(3);
    }
  });

  it('does not retry an API error or reinterpret it as absent rooms', async () => {
    const { clock } = clockFixture();
    let reads = 0;
    await expect(
      confirmRoomSnapshot({
        phase: 'deletion',
        expected: new Map(),
        clock,
        read: async () => {
          reads++;
          throw new Error('unavailable');
        },
        record: () => {},
      }),
    ).rejects.toThrow('unavailable');
    expect(reads).toBe(1);
  });

  it('rejects a matching response completed after the probe deadline', async () => {
    const { clock, advance } = clockFixture(5000);
    const observations: LifecycleObservation[] = [];
    await expect(
      confirmRoomSnapshot({
        phase: 'recreation',
        expected: newSnapshot,
        previous: oldSnapshot,
        clock,
        read: async () => {
          advance(5000);
          return newRooms;
        },
        record: (entry) => observations.push(entry),
      }),
    ).rejects.toThrow('UNJOINED_PROBE_DEADLINE');
    expect(observations).toEqual([]);
  });

  it('waits 120 seconds after the deletion ACK without any API call or long unchecked sleep', async () => {
    const { clock, sleeps, advance } = clockFixture();
    advance(500);
    await waitForDeletionWindow(0, clock);
    expect(clock.now()).toBe(120_000);
    expect(sleeps).toHaveLength(120);
    expect(Math.max(...sleeps)).toBe(1000);
    expect(sleeps.at(-1)).toBe(500);
  });

  it('aborts stabilization at the existing deadline instead of extending the probe', async () => {
    const { clock, sleeps } = clockFixture(12_000);
    await expect(waitForDeletionWindow(0, clock)).rejects.toThrow('UNJOINED_PROBE_DEADLINE');
    expect(clock.now()).toBe(12_000);
    expect(sleeps).toHaveLength(12);
  });
});

describe('revocation result token validity', () => {
  it('reads the actual pinned SDK nbf/exp claims without changing its 300-second lifetime', async () => {
    const token = new AccessToken('qa-key', 'qa-secret-not-a-real-credential', {
      identity: 'qa',
      ttl: 300,
    });
    token.addGrant({ roomJoin: true, room: 'qa-only' });
    const window = probeTokenWindow(await token.toJwt());
    expect(window.expiresAtEpochMs - window.notBeforeEpochMs).toBe(300_000);
    expect(() => requireValidProbeToken(window, window.notBeforeEpochMs, 10_000)).not.toThrow();
  });

  it('never treats an expired or not-yet-valid token denial as revocation success', () => {
    const window = { notBeforeEpochMs: 1000, expiresAtEpochMs: 301_000 };
    for (const now of [999, 301_000, 301_001, NaN, Infinity])
      expect(() => requireValidProbeToken(window, now)).toThrow(
        'UNJOINED_PROBE_TOKEN_WINDOW_EXCEEDED',
      );
    expect(() => requireValidProbeToken(window, 291_000, 10_000)).toThrow(
      'UNJOINED_PROBE_TOKEN_WINDOW_EXCEEDED',
    );
    expect(() => requireValidProbeToken(window, 290_999, 10_000)).not.toThrow();
    // Even when the pre-connect check passed, a late response must fail the post-connect check.
    expect(() => requireValidProbeToken(window, 300_999)).not.toThrow();
    expect(() => requireValidProbeToken(window, 301_000)).toThrow(
      'UNJOINED_PROBE_TOKEN_WINDOW_EXCEEDED',
    );
  });

  it('requires numeric finite SDK claim boundaries and emits no raw JWT on decoding errors', () => {
    for (const payload of [
      {},
      { nbf: 10, exp: 9 },
      { nbf: '10', exp: 20 },
      { nbf: 10, exp: 20.5 },
      null,
    ]) {
      const jwt = `private.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.secret`;
      expect(() => probeTokenWindow(jwt)).toThrow('UNJOINED_PROBE_INVALID_TOKEN_WINDOW');
    }
    expect(() => probeTokenWindow('secret-without-claims')).toThrow(
      'UNJOINED_PROBE_INVALID_TOKEN_WINDOW',
    );
  });
});

describe('final recreation acceptance', () => {
  it('keeps acceptance false when the final SID check fails after both SDK checks passed', async () => {
    let accepted = false;
    await expect(
      (async () => {
        accepted = await verifyRecreatedRoomAccess({
          rejectedTokens: async () => true,
          connectedControls: async () => true,
          finalRooms: async () => {
            throw new Error('UNJOINED_PROBE_FINAL_UNCONFIRMED');
          },
        });
      })(),
    ).rejects.toThrow('UNJOINED_PROBE_FINAL_UNCONFIRMED');
    expect(accepted).toBe(false);
  });

  it.each([
    [false, true],
    [true, false],
    [true, true],
  ])(
    'requires revoked=%s and controls=%s, then observes the final rooms',
    async (rejected, connected) => {
      const calls: string[] = [];
      expect(
        await verifyRecreatedRoomAccess({
          rejectedTokens: async () => {
            calls.push('revoked');
            return rejected;
          },
          connectedControls: async () => {
            calls.push('controls');
            return connected;
          },
          finalRooms: async () => {
            calls.push('rooms');
          },
        }),
      ).toBe(rejected && connected);
      expect(calls).toEqual(['revoked', 'controls', 'rooms']);
    },
  );
});

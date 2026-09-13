import { describe, expect, it, vi } from 'vitest';
import { checksum } from '../../src/operations/CheckpointStore.js';
import type { JournalEntry, JournalRecord } from '../../src/operations/OperationJournal.js';
import {
  PreviousGenerationCleanup,
  ownsMediaRoom,
  type CleanupRunInput,
} from '../../src/operations/PreviousGenerationCleanup.js';

const oldEpoch = '11111111-1111-4111-8111-111111111111';
const currentEpoch = '99999999-9999-4999-8999-999999999999';
const room = `qa-e--${oldEpoch}--22222222-2222-4222-8222-222222222222`;
const otherRoom = `qa-e--${oldEpoch}--33333333-3333-4333-8333-333333333333`;
const record: JournalRecord = {
  namespace: 'qa-e',
  roomName: room,
  serverEpoch: oldEpoch,
  state: 'PREPARED',
  identity: 'identity-a',
  matchId: 'match-a',
  mediaInstanceId: 'instance-a',
  reservationId: 'reservation-a',
  generation: 1,
  issuedAtEpochMs: 1000,
  expiresAtEpochMs: 2000,
};
const entry = (value: JournalRecord = record, seq = 1): JournalEntry => {
  const payload = { version: 1 as const, seq, record: value };
  return { ...payload, checksum: checksum(payload) };
};
const input = (records: readonly JournalEntry[] = [entry()]): CleanupRunInput => ({
  records,
  historyComplete: true,
  singleWriter: true,
  serverEpoch: currentEpoch,
});
type Options = ConstructorParameters<typeof PreviousGenerationCleanup>[0];
function setup() {
  const options = {
    namespace: 'qa-e',
    listRooms: vi.fn<Options['listRooms']>(async () => []),
    listParticipants: vi.fn<Options['listParticipants']>(async () => []),
    revoke: vi.fn<Options['revoke']>(async () => true),
    deleteRoom: vi.fn<Options['deleteRoom']>(async () => {}),
    checkpoint: vi.fn<Options['checkpoint']>(async () => {}),
    onUnresolved: vi.fn<NonNullable<Options['onUnresolved']>>(),
  };
  return { cleanup: new PreviousGenerationCleanup(options), ...options };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('previous generation cleanup ownership and replay', () => {
  it('requires exact namespace and crypto UUID v4 room components', () => {
    expect(ownsMediaRoom('qa-e', room)).toBe(true);
    for (const candidate of [
      room.replace('qa-e', 'qa-extra'),
      room.replace('qa-e', 'other'),
      room.replace(oldEpoch, '11111111-1111-1111-8111-111111111111'),
      room.replace('4222-8222', '4222-7222'),
      `${room}-suffix`,
      `prefix-${room}`,
      'qa-e--malformed',
    ])
      expect(ownsMediaRoom('qa-e', candidate)).toBe(false);
    expect(() => new PreviousGenerationCleanup({ ...setup(), namespace: 'qa--e' })).toThrow(
      'INVALID_NAMESPACE',
    );
  });

  it('revokes, deletes and verifies a recorded-only PREPARED room despite an empty global list', async () => {
    const s = setup();
    expect(await s.cleanup.run(input())).toEqual({
      recordedIdentities: 1,
      observedParticipants: 0,
      revoked: 1,
      unresolved: 0,
      ownedRoomsRemaining: 0,
      historyComplete: true,
    });
    expect(s.revoke).toHaveBeenCalledWith(
      { roomName: room, identity: record.identity, record },
      expect.objectContaining({ beforeDispatch: expect.any(Function) }),
    );
    expect(s.listParticipants.mock.calls.map(([name]) => name)).toEqual([room, room]);
    expect(s.deleteRoom).toHaveBeenCalledWith(room, expect.any(Object));
    expect(s.revoke.mock.invocationCallOrder[0]).toBeLessThan(
      s.deleteRoom.mock.invocationCallOrder[0]!,
    );
    expect(s.deleteRoom.mock.invocationCallOrder[0]).toBeLessThan(
      s.listRooms.mock.invocationCallOrder[1]!,
    );
    expect(s.listParticipants.mock.invocationCallOrder[1]).toBeLessThan(
      s.checkpoint.mock.invocationCallOrder[0]!,
    );
    expect(s.onUnresolved).not.toHaveBeenCalled();
  });

  it('also discovers unrecorded participants in a recorded-only room before deletion', async () => {
    const s = setup();
    s.listParticipants.mockResolvedValueOnce([{ identity: 'unrecorded' }]);
    expect(await s.cleanup.run(input())).toMatchObject({
      observedParticipants: 1,
      revoked: 2,
      historyComplete: false,
    });
    expect(
      s.revoke.mock.calls.some(
        ([target]) => target.identity === 'unrecorded' && target.record === null,
      ),
    ).toBe(true);
    expect(s.onUnresolved).toHaveBeenCalledOnce();
  });

  it('cleans unknown owned participants while preserving incomplete issuance history', async () => {
    const s = setup();
    s.listRooms.mockResolvedValueOnce([{ name: room }]);
    s.listParticipants.mockResolvedValueOnce([
      { identity: 'observed-a' },
      { identity: 'observed-b' },
    ]);
    expect(await s.cleanup.run(input([]))).toMatchObject({
      recordedIdentities: 0,
      observedParticipants: 2,
      revoked: 2,
      unresolved: 0,
      historyComplete: false,
    });
    expect(s.deleteRoom).toHaveBeenCalledOnce();
    expect(s.revoke.mock.calls.every(([target]) => target.record === null)).toBe(true);
  });

  it('keeps inherited incomplete history locked after successful observed cleanup', async () => {
    const s = setup();
    s.listRooms.mockResolvedValueOnce([{ name: room }]);
    const result = await s.cleanup.run({ ...input([]), historyComplete: false });
    expect(result).toMatchObject({ historyComplete: false, unresolved: 0 });
    expect(s.deleteRoom).toHaveBeenCalledOnce();
    expect(s.onUnresolved).toHaveBeenCalledWith(result);
  });

  it('never queries or mutates another service or a lookalike namespace', async () => {
    const s = setup();
    s.listRooms.mockResolvedValue([
      { name: room.replace('qa-e', 'other') },
      { name: room.replace('qa-e', 'qa-extra') },
      { name: room.toUpperCase() },
    ]);
    expect(await s.cleanup.run(input([]))).toMatchObject({ unresolved: 0, historyComplete: true });
    expect(s.listParticipants).not.toHaveBeenCalled();
    expect(s.revoke).not.toHaveBeenCalled();
    expect(s.deleteRoom).not.toHaveBeenCalled();
  });

  it.each(['initial', 'final'] as const)(
    'locks ambiguous own-prefix rooms in the %s listing',
    async (phase) => {
      const s = setup();
      if (phase === 'initial') s.listRooms.mockResolvedValueOnce([{ name: 'qa-e--malformed' }]);
      else
        s.listRooms.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'qa-e--malformed' }]);
      expect(await s.cleanup.run(input([]))).toMatchObject({
        historyComplete: false,
        unresolved: 1,
      });
      expect(s.listParticipants).not.toHaveBeenCalled();
      expect(s.deleteRoom).not.toHaveBeenCalled();
    },
  );

  it('does not treat a new owned room discovered at final listing as complete history', async () => {
    const s = setup();
    s.listRooms.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: otherRoom }]);
    expect(await s.cleanup.run(input([]))).toMatchObject({
      historyComplete: false,
      ownedRoomsRemaining: 1,
    });
    expect(s.listParticipants).toHaveBeenCalledWith(otherRoom, expect.any(Object));
    expect(s.deleteRoom).not.toHaveBeenCalled();
  });

  it('never touches rooms in the current server epoch', async () => {
    const s = setup();
    const currentRoom = room.replace(oldEpoch, currentEpoch);
    s.listRooms.mockResolvedValue([{ name: currentRoom }]);
    expect(await s.cleanup.run(input([]))).toMatchObject({
      historyComplete: false,
      ownedRoomsRemaining: 1,
    });
    expect(s.listParticipants).not.toHaveBeenCalled();
    expect(s.revoke).not.toHaveBeenCalled();
    expect(s.deleteRoom).not.toHaveBeenCalled();
  });

  it('preserves a pending older generation sharing a remote identity with a REVOKED generation', async () => {
    const s = setup();
    const newer = { ...record, generation: 2, state: 'REVOKED' as const };
    expect(await s.cleanup.run(input([entry(), entry(newer, 2)]))).toMatchObject({
      recordedIdentities: 1,
      revoked: 1,
      unresolved: 0,
    });
    expect(s.revoke.mock.calls[0]![0].record?.generation).toBe(1);
  });

  it('retries observed REVOKED identities and retains all generation evidence', async () => {
    const s = setup();
    const old = { ...record, state: 'REVOKED' as const };
    const newer = { ...record, generation: 2 };
    s.listParticipants.mockResolvedValueOnce([{ identity: record.identity }]);
    expect(await s.cleanup.run(input([entry(old), entry(newer, 2)]))).toMatchObject({ revoked: 2 });
    expect(s.revoke.mock.calls.map(([target]) => target.record?.state)).toEqual([
      'PREPARED',
      'REVOKED',
    ]);
  });

  it('deduplicates repeated Cloud rows without duplicate removal or deletion', async () => {
    const s = setup();
    s.listRooms.mockResolvedValueOnce([{ name: room }, { name: room }]);
    s.listParticipants.mockResolvedValueOnce([
      { identity: record.identity },
      { identity: record.identity },
    ]);
    expect(await s.cleanup.run(input())).toMatchObject({ observedParticipants: 1, revoked: 1 });
    expect(s.revoke).toHaveBeenCalledOnce();
    expect(s.deleteRoom).toHaveBeenCalledOnce();
  });

  it.each([
    ['checksum', () => [{ ...entry(), checksum: 'corrupt' }]],
    ['nonincreasing sequence', () => [entry(), entry(record, 1)]],
    ['namespace', () => [entry({ ...record, namespace: 'other' })]],
    ['room epoch', () => [entry({ ...record, serverEpoch: currentEpoch })]],
    [
      'same-generation ownership drift',
      () => [entry(), entry({ ...record, matchId: 'different' }, 2)],
    ],
    [
      'REVOKED regression',
      () => [entry({ ...record, state: 'REVOKED' as const }), entry(record, 2)],
    ],
  ] as const)('rejects %s corruption before Cloud dispatch', async (_label, corrupt) => {
    const s = setup();
    expect(await s.cleanup.run(input(corrupt()))).toMatchObject({
      historyComplete: false,
      unresolved: 1,
    });
    expect(s.listRooms).not.toHaveBeenCalled();
    expect(s.checkpoint).not.toHaveBeenCalled();
  });

  it('uses the latest valid same-generation record and accepts gaps from compaction', async () => {
    const s = setup();
    const latest = { ...record, state: 'REVOKING' as const };
    expect(await s.cleanup.run(input([entry(record, 2), entry(latest, 8)]))).toMatchObject({
      revoked: 1,
    });
    expect(s.revoke.mock.calls[0]![0].record?.state).toBe('REVOKING');
  });
});

describe('previous generation cleanup failure boundaries', () => {
  it('refuses a second writer and does not create a checkpoint', async () => {
    const s = setup();
    expect(await s.cleanup.run({ ...input(), singleWriter: false })).toMatchObject({
      historyComplete: false,
      unresolved: 1,
    });
    expect(s.listRooms).not.toHaveBeenCalled();
    expect(s.checkpoint).not.toHaveBeenCalled();
    expect(s.onUnresolved).toHaveBeenCalledOnce();
  });

  it('still retires known targets when the initial global list times out, retaining the lock', async () => {
    const s = setup();
    s.listRooms.mockRejectedValueOnce(new Error('timeout'));
    const report = await s.cleanup.run(input());
    expect(report).toMatchObject({ revoked: 1, historyComplete: true });
    expect(report.unresolved).toBeGreaterThan(0);
    expect(s.onUnresolved).toHaveBeenCalledOnce();
    expect(s.revoke).toHaveBeenCalledOnce();
    expect(s.checkpoint).toHaveBeenCalledOnce();
  });

  it('does not delete a room if its participant enumeration fails', async () => {
    const s = setup();
    s.listParticipants.mockRejectedValueOnce(new Error('timeout'));
    expect(await s.cleanup.run(input())).toMatchObject({ revoked: 1 });
    expect(s.deleteRoom).not.toHaveBeenCalled();
    expect(s.onUnresolved).toHaveBeenCalledOnce();
  });

  it.each(['false', 'reject'] as const)(
    'locks %s revocation while safely deleting independent rooms',
    async (failure) => {
      const s = setup();
      const second = {
        ...record,
        roomName: otherRoom,
        identity: 'identity-b',
        reservationId: 'reservation-b',
      };
      if (failure === 'false') s.revoke.mockResolvedValueOnce(false);
      else s.revoke.mockRejectedValueOnce(new Error('timeout'));
      expect(await s.cleanup.run(input([entry(), entry(second, 2)]))).toMatchObject({
        revoked: 1,
        unresolved: 1,
      });
      expect(s.deleteRoom.mock.calls.map(([name]) => name)).toEqual([otherRoom]);
    },
  );

  it('keeps a failed delete unresolved even when the final list is empty', async () => {
    const s = setup();
    s.deleteRoom.mockRejectedValueOnce(new Error('timeout'));
    expect(await s.cleanup.run(input())).toMatchObject({ revoked: 1, unresolved: 1 });
  });

  it('does not accept empty earlier snapshots when final global listing fails', async () => {
    const s = setup();
    s.listRooms.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('timeout'));
    const result = await s.cleanup.run(input());
    expect(result.unresolved).toBeGreaterThan(0);
    expect(s.listParticipants).toHaveBeenCalledTimes(2);
    expect(s.checkpoint).toHaveBeenCalledWith(result, expect.any(Object));
  });

  it('detects participants remaining after an acknowledged delete despite a final empty global list', async () => {
    const s = setup();
    s.listParticipants
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ identity: record.identity }]);
    expect(await s.cleanup.run(input())).toMatchObject({ unresolved: 1, ownedRoomsRemaining: 0 });
  });

  it('marks unknown final participants as lost issuance history', async () => {
    const s = setup();
    s.listParticipants
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ identity: 'late-unknown' }]);
    expect(await s.cleanup.run(input())).toMatchObject({ unresolved: 1, historyComplete: false });
  });

  it('treats malformed Cloud participant data as unconfirmed and does not delete that room', async () => {
    const s = setup();
    s.listParticipants.mockResolvedValueOnce([{ identity: '' }]);
    expect((await s.cleanup.run(input())).unresolved).toBeGreaterThan(0);
    expect(s.deleteRoom).not.toHaveBeenCalled();
  });

  it('does not report durable completion if checkpointing fails', async () => {
    const s = setup();
    s.checkpoint.mockRejectedValueOnce(new Error('disk full'));
    expect(await s.cleanup.run(input())).toMatchObject({ unresolved: 1, historyComplete: false });
    expect(s.onUnresolved).toHaveBeenCalledOnce();
  });

  it('contains notification failures without changing the failure report', async () => {
    const s = setup();
    s.onUnresolved.mockImplementation(() => {
      throw new Error('exporter');
    });
    expect(await s.cleanup.run({ ...input([]), historyComplete: false })).toMatchObject({
      historyComplete: false,
    });
  });
});

describe('previous generation cleanup lifecycle and persisted observations', () => {
  it('rejects concurrent passes and permits a later recovery pass', async () => {
    const s = setup();
    const pending = deferred<readonly { name: string }[]>();
    s.listRooms.mockReturnValueOnce(pending.promise);
    const first = s.cleanup.run(input());
    await expect(s.cleanup.run(input())).rejects.toThrow('CLEANUP_IN_PROGRESS');
    pending.resolve([]);
    await first;
    expect(await s.cleanup.run(input())).toMatchObject({ unresolved: 0 });
    expect(s.revoke).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch anything for an already aborted bootstrap', async () => {
    const s = setup();
    const abort = new AbortController();
    abort.abort();
    expect(await s.cleanup.run({ ...input(), signal: abort.signal })).toMatchObject({
      unresolved: 1,
    });
    expect(s.listRooms).not.toHaveBeenCalled();
    expect(s.checkpoint).not.toHaveBeenCalled();
  });

  it.each(['list', 'participants', 'revoke', 'delete'] as const)(
    'stops after a late %s response when bootstrap closes',
    async (phase) => {
      const s = setup();
      const abort = new AbortController();
      const pending = deferred<never>();
      let reached!: () => void;
      const started = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const wait = () => {
        reached();
        return pending.promise;
      };
      if (phase === 'list') s.listRooms.mockImplementationOnce(wait);
      if (phase === 'participants') s.listParticipants.mockImplementationOnce(wait);
      if (phase === 'revoke') s.revoke.mockImplementationOnce(wait);
      if (phase === 'delete') s.deleteRoom.mockImplementationOnce(wait);
      const work = s.cleanup.run({ ...input(), signal: abort.signal });
      await started;
      abort.abort();
      const counts = [
        s.listRooms.mock.calls.length,
        s.listParticipants.mock.calls.length,
        s.revoke.mock.calls.length,
        s.deleteRoom.mock.calls.length,
      ];
      pending.resolve((phase === 'revoke' ? true : []) as never);
      expect(await work).toMatchObject({ historyComplete: false });
      expect([
        s.listRooms.mock.calls.length,
        s.listParticipants.mock.calls.length,
        s.revoke.mock.calls.length,
        s.deleteRoom.mock.calls.length,
      ]).toEqual(counts);
      expect(s.checkpoint).not.toHaveBeenCalled();
    },
  );

  it('passes the live dispatch guard and signal into every callback', async () => {
    const s = setup();
    const abort = new AbortController();
    let allowed = true;
    await s.cleanup.run({ ...input(), signal: abort.signal, beforeDispatch: () => allowed });
    const contexts = [
      ...s.listRooms.mock.calls.map(([context]) => context),
      ...s.listParticipants.mock.calls.map(([, context]) => context),
      ...s.revoke.mock.calls.map(([, context]) => context),
      ...s.deleteRoom.mock.calls.map(([, context]) => context),
      ...s.checkpoint.mock.calls.map(([, context]) => context),
    ];
    expect(
      contexts.every((context) => context.signal === abort.signal && context.beforeDispatch()),
    ).toBe(true);
    allowed = false;
    expect(contexts.every((context) => !context.beforeDispatch())).toBe(true);
  });

  it('stops before saving when the writer guard changes after the final query', async () => {
    const s = setup();
    let writable = true;
    s.listRooms.mockResolvedValueOnce([]).mockImplementationOnce(async () => {
      writable = false;
      return [];
    });
    expect(await s.cleanup.run({ ...input([]), beforeDispatch: () => writable })).toMatchObject({
      unresolved: 1,
    });
    expect(s.checkpoint).not.toHaveBeenCalled();
  });

  it('restores unknown persisted targets even when Cloud omits their rooms', async () => {
    const s = setup();
    expect(
      await s.cleanup.run({
        ...input([]),
        observedTargets: [{ roomName: room, identity: 'persisted-unknown' }],
      }),
    ).toMatchObject({ recordedIdentities: 0, revoked: 1, historyComplete: false });
    expect(s.revoke.mock.calls[0]![0]).toEqual({
      roomName: room,
      identity: 'persisted-unknown',
      record: null,
    });
    expect(s.deleteRoom).toHaveBeenCalledWith(room, expect.any(Object));
    expect(s.listParticipants).toHaveBeenCalledTimes(2);
  });

  it('prefers real generation evidence over duplicate persisted observations', async () => {
    const s = setup();
    expect(
      await s.cleanup.run({
        ...input(),
        observedTargets: [
          { roomName: room, identity: record.identity },
          { roomName: room, identity: record.identity },
        ],
      }),
    ).toMatchObject({ revoked: 1, historyComplete: false });
    expect(s.revoke.mock.calls[0]![0].record).toEqual(record);
  });

  it.each([
    { roomName: room.replace('qa-e', 'other'), identity: 'unknown' },
    { roomName: 'qa-e--malformed', identity: 'unknown' },
    { roomName: room, identity: '' },
  ])('rejects unsafe persisted observation %j before dispatch', async (target) => {
    const s = setup();
    expect(await s.cleanup.run({ ...input([]), observedTargets: [target] })).toMatchObject({
      historyComplete: false,
    });
    expect(s.listRooms).not.toHaveBeenCalled();
    expect(s.revoke).not.toHaveBeenCalled();
  });
});

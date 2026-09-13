import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { checksum } from '../../src/operations/CheckpointStore.js';
import type { JournalEntry, JournalRecord } from '../../src/operations/OperationJournal.js';
import {
  PreviousGenerationCleanup,
  type CleanupCallContext,
  type CleanupRunInput,
} from '../../src/operations/PreviousGenerationCleanup.js';

const epoch = '11111111-1111-4111-8111-111111111111';
const currentEpoch = '99999999-9999-4999-8999-999999999999';
const room = (index: number) =>
  `qa-e--${epoch}--22222222-2222-4222-8222-${index.toString(16).padStart(12, '0')}`;
function input(count: number, signal?: AbortSignal): CleanupRunInput {
  const records: JournalEntry[] = Array.from({ length: count }, (_, index) => {
    const record: JournalRecord = {
      namespace: 'qa-e',
      roomName: room(index),
      serverEpoch: epoch,
      state: 'REVOKED',
      identity: `identity-${index}`,
      matchId: `match-${index}`,
      mediaInstanceId: `instance-${index}`,
      reservationId: `reservation-${index}`,
      generation: 1,
      issuedAtEpochMs: 1000,
      expiresAtEpochMs: 2000,
    };
    const payload = { version: 1 as const, seq: index + 1, record };
    return { ...payload, checksum: checksum(payload) };
  });
  return { records, historyComplete: true, singleWriter: true, serverEpoch: currentEpoch, signal };
}
type Options = ConstructorParameters<typeof PreviousGenerationCleanup>[0];
function options() {
  return {
    namespace: 'qa-e',
    listRooms: vi.fn<Options['listRooms']>(async () => []),
    listParticipants: vi.fn<Options['listParticipants']>(async () => []),
    revoke: vi.fn<Options['revoke']>(async () => true),
    deleteRoom: vi.fn<Options['deleteRoom']>(async () => {}),
    checkpoint: vi.fn<Options['checkpoint']>(async () => {}),
  };
}
const flush = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe('bounded startup room recovery', () => {
  it('reuses only verified retired absence and revalidates that proof after both inventories', async () => {
    const s = options();
    const proof = vi.fn(() => true);
    expect(
      await new PreviousGenerationCleanup({ ...s, canReuseRetiredRoom: proof }).run(input(240)),
    ).toMatchObject({ historyComplete: true, unresolved: 0, ownedRoomsRemaining: 0 });
    expect(s.listRooms).toHaveBeenCalledTimes(2);
    expect(s.listParticipants).not.toHaveBeenCalled();
    expect(s.deleteRoom).not.toHaveBeenCalled();
    expect(proof).toHaveBeenCalledTimes(480);
  });

  it.each([
    'reappeared',
    'invalid-inventory',
    'failed-inventory',
    'changed-proof',
    'cancelled',
  ] as const)(
    'does not complete an expired room when the final observation is %s',
    async (failure) => {
      const s = options();
      const abort = new AbortController();
      let proven = true;
      s.listRooms.mockImplementation(async () => {
        if (s.listRooms.mock.calls.length === 1) return [];
        if (failure === 'reappeared') return [{ name: room(0) }];
        if (failure === 'invalid-inventory') return [{}] as { name: string }[];
        if (failure === 'failed-inventory') throw new Error('transport failed');
        if (failure === 'changed-proof') proven = false;
        if (failure === 'cancelled') abort.abort();
        return [];
      });
      const report = await new PreviousGenerationCleanup({
        ...s,
        canReuseRetiredRoom: () => proven,
      }).run(input(1, abort.signal));
      expect(report.unresolved).toBeGreaterThan(0);
      if (failure !== 'failed-inventory') expect(report.historyComplete).toBe(false);
      if (failure === 'reappeared')
        expect(s.listParticipants).toHaveBeenCalledWith(room(0), expect.any(Object));
    },
  );

  it('does not reuse an unrevoked record or an initially observed room even if the callback returns true', async () => {
    const s = options();
    s.listRooms.mockResolvedValueOnce([{ name: room(0) }]);
    const original = input(2);
    const records = original.records.map((entry, index) => {
      const payload = {
        version: 1 as const,
        seq: entry.seq,
        record: {
          ...entry.record,
          state: index === 1 ? ('PREPARED' as const) : ('REVOKED' as const),
        },
      };
      return { ...payload, checksum: checksum(payload) };
    });
    expect(
      await new PreviousGenerationCleanup({ ...s, canReuseRetiredRoom: () => true }).run({
        ...original,
        records,
      }),
    ).toMatchObject({ unresolved: 0, historyComplete: true });
    expect(s.listParticipants).toHaveBeenCalledTimes(4);
    expect(s.deleteRoom).toHaveBeenCalledTimes(2);
    expect(s.revoke).toHaveBeenCalledOnce();
  });
  it('checks all 78 historical rooms within 62 rather than 236 simulated seconds', async () => {
    vi.useFakeTimers({ now: 0 });
    const s = options();
    let active = 0;
    let peak = 0;
    let phase: 'initial' | 'final' = 'initial';
    const initial = new Set<string>();
    const deleted = new Set<string>();
    const final = new Set<string>();
    const network = async () => {
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      active--;
    };
    s.listRooms.mockImplementation(async () => {
      if (s.listRooms.mock.calls.length === 2) {
        expect(deleted.size).toBe(78);
        phase = 'final';
      }
      await network();
      return [];
    });
    s.listParticipants.mockImplementation(async (name) => {
      if (phase === 'final') expect(deleted.size).toBe(78);
      await network();
      (phase === 'initial' ? initial : final).add(name);
      return [];
    });
    s.deleteRoom.mockImplementation(async (name) => {
      expect(initial.size).toBe(78);
      await network();
      deleted.add(name);
    });
    s.checkpoint.mockImplementation(async () => {
      expect(final.size).toBe(78);
      expect(active).toBe(0);
    });
    const done = new PreviousGenerationCleanup(s).run(input(78));
    await vi.runAllTimersAsync();
    expect(await done).toMatchObject({
      historyComplete: true,
      unresolved: 0,
      ownedRoomsRemaining: 0,
    });
    expect(Date.now()).toBe(62_000);
    expect(peak).toBe(4);
    expect(s.listParticipants).toHaveBeenCalledTimes(156);
    expect(s.deleteRoom).toHaveBeenCalledTimes(78);
    expect(s.listRooms).toHaveBeenCalledTimes(2);
    expect(s.revoke).not.toHaveBeenCalled();
    expect(s.checkpoint).toHaveBeenCalledOnce();
  });

  it('does not start deletion or release sweep ownership while cancelled calls still settle', async () => {
    const s = options();
    const controller = new AbortController();
    const releases: (() => void)[] = [];
    const contexts: CleanupCallContext[] = [];
    s.listParticipants.mockImplementation(
      async (_name, context) =>
        new Promise<readonly { identity: string }[]>((resolve) => {
          contexts.push(context);
          releases.push(() => resolve([]));
        }),
    );
    const cleanup = new PreviousGenerationCleanup(s);
    let finished = false;
    const done = cleanup.run(input(20, controller.signal)).then((value) => {
      finished = true;
      return value;
    });
    await flush();
    expect(releases).toHaveLength(4);
    controller.abort();
    expect(contexts.every((context) => !context.beforeDispatch())).toBe(true);
    releases[0]!();
    await flush();
    expect(finished).toBe(false);
    await expect(cleanup.run(input(20))).rejects.toThrow('CLEANUP_IN_PROGRESS');
    for (const release of releases.slice(1)) release();
    expect(await done).toMatchObject({ historyComplete: false, unresolved: 1 });
    expect(s.listParticipants).toHaveBeenCalledTimes(4);
    expect(s.deleteRoom).not.toHaveBeenCalled();
    expect(s.checkpoint).not.toHaveBeenCalled();
    s.listParticipants.mockResolvedValue([]);
    expect(await cleanup.run(input(0))).toMatchObject({ historyComplete: true, unresolved: 0 });
  });

  it('keeps failed and unrecorded observations locked while draining the remaining rooms', async () => {
    const s = options();
    const visits = new Map<string, number>();
    s.listParticipants.mockImplementation(async (name) => {
      const count = (visits.get(name) ?? 0) + 1;
      visits.set(name, count);
      if (name === room(0) && count === 1) throw new Error('query failed');
      if (name === room(1) && count === 1) return [{ identity: 'unknown' }];
      return [];
    });
    expect(await new PreviousGenerationCleanup(s).run(input(9))).toMatchObject({
      historyComplete: false,
      observedParticipants: 1,
      revoked: 1,
      unresolved: 1,
    });
    expect(s.deleteRoom.mock.calls.map(([name]) => name)).not.toContain(room(0));
    expect(s.deleteRoom).toHaveBeenCalledTimes(8);
    expect([...visits.values()]).toEqual(Array(9).fill(2));
    expect(s.revoke).toHaveBeenCalledWith(
      { roomName: room(1), identity: 'unknown', record: null },
      expect.any(Object),
    );
    expect(s.checkpoint.mock.calls[0]![0]).toMatchObject({
      historyComplete: false,
      unresolved: 1,
    });
  });

  it('routes concurrent room work through the shared rolling API budget', async () => {
    vi.useFakeTimers({ now: 0 });
    const budget = new ApiBudget({
      monotonicNow: () => Date.now(),
      maxNormalCallsPer60s: 1,
      maxTotalCallsPer60s: 4,
    });
    const sent: number[] = [];
    let sequence = 0;
    const dispatch = async (method: string, target: string, context: CleanupCallContext) => {
      await budget.dispatch({
        requestId: String(++sequence),
        method,
        target,
        kind: 'query',
        priority: 'cleanup',
        deadlineMs: Date.now() + 61_000,
        beforeDispatch: context.beforeDispatch,
        signal: context.signal,
        run: async () => {
          sent.push(Date.now());
        },
      });
    };
    const s = options();
    s.listRooms.mockImplementation(async (context) => {
      await dispatch('listRooms', 'namespace', context);
      return [];
    });
    s.listParticipants.mockImplementation(async (name, context) => {
      await dispatch('listParticipants', name, context);
      return [];
    });
    s.deleteRoom.mockImplementation((name, context) => dispatch('deleteRoom', name, context));
    try {
      const done = new PreviousGenerationCleanup(s).run(input(3));
      await vi.runAllTimersAsync();
      expect(await done).toMatchObject({ historyComplete: true, unresolved: 0 });
      expect(sent).toHaveLength(11);
      for (const at of sent)
        expect(
          sent.filter((other) => other > at - 60_000 && other <= at).length,
        ).toBeLessThanOrEqual(4);
      expect(budget.getSnapshot()).toMatchObject({ inFlight: 0, pendingCleanup: 0 });
    } finally {
      budget.close();
    }
  });
});

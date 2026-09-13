import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import {
  UsageCheckpoint,
  validateOfficialBudget,
  validateUsageState,
} from '../../src/operations/UsageCheckpoint.js';
import { createUsageReservationId } from '../../src/operations/UsageReservationId.js';
import type { UsageRequest } from '../../src/operations/UsageCheckpoint.js';

const directories: string[] = [];
const official = {
  projectAlias: 'project-204',
  remainingMinutes: 1000,
  remainingBytes: 100000,
  checkedAtEpochMs: 1000,
  source: 'cloud-dashboard' as const,
  checkedBy: 'operator-e',
};
const request: UsageRequest = {
  reservationId: 'reservation-1',
  matchId: 'match-1',
  purpose: 'public',
  slots: 6,
  expectedMinutes: 5,
  expectedBytes: 1000,
  margin: 0.2,
};
async function setup(confirmed = true, providerQuota = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e-usage-'));
  directories.push(dir);
  let now = 1000;
  let allowed = true;
  const store = new UsageCheckpoint({ opsDataDir: dir, providerQuota });
  const options = {
    store,
    projectAlias: 'project-204',
    officialBudgetMaxAgeMs: 10000,
    providerQuota,
    now: () => now,
    canIssue: () => ({ allowed }),
  };
  const budget = new UsageBudget(options);
  await budget.restore({ allowInitializeMissing: true });
  if (confirmed) await budget.reconcileOfficial(official, { periodId: '2026-09', version: 1 });
  return {
    budget,
    store,
    options,
    dir,
    setNow: (value: number) => {
      now = value;
    },
    setAllowed: (value: boolean) => {
      allowed = value;
    },
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const target of directories.splice(0)) {
    if (
      !path.resolve(target).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(target).startsWith('kkakkung-e-usage-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('durable usage reservations', () => {
  it.each([false, true])(
    'reads an aggregate, rejects retired requests, and preserves live idempotence and totals (quota=%s)',
    async (providerQuota) => {
      const f = await setup(true, providerQuota);
      await f.budget.reserve(request);
      const old = await f.store.read();
      if (old.integrity !== 'ok') throw new Error('INVALID_FIXTURE');
      expect(Object.keys(old.checkpoint.state).sort()).toEqual(['official', 'reservations']);
      await f.budget.close();
      const compacted = {
        version: 1 as const,
        retiredThroughEpochMs: 1000,
        compactedAtEpochMs: 1000 + 86_400_000,
        reservationCount: 2,
        minutes: 72,
        bytes: 2400,
      };
      const now = compacted.compactedAtEpochMs + 1000;
      f.setNow(now);
      const store = new UsageCheckpoint({ opsDataDir: f.dir, providerQuota });
      await store.write({
        lastSeq: old.checkpoint.lastSeq + 1,
        state: {
          ...old.checkpoint.state,
          official: providerQuota
            ? null
            : {
                ...old.checkpoint.state.official!,
                checkpoint: { ...official, checkedAtEpochMs: now },
              },
          compacted,
        },
      });
      const budget = new UsageBudget({ ...f.options, store });
      await budget.restore();
      expect(budget.snapshot()).toMatchObject({
        integrity: 'ok',
        compacted,
        activeMinutes: 36,
        activeBytes: 1200,
        localEstimatedMinutes: 108,
        localEstimatedBytes: 3600,
      });
      expect((await budget.reserve(request)).status).toBe('duplicate');
      const before = await fs.readFile(store.filePath, 'utf8');
      for (const reservationId of ['old-legacy-id', createUsageReservationId(1000)])
        expect(await budget.reserve({ ...request, reservationId })).toMatchObject({
          status: 'rejected',
          code: 'UNRESOLVED_RETIREMENT',
        });
      expect(
        await budget.reserve({ ...request, reservationId: createUsageReservationId(now + 1) }),
      ).toMatchObject({ status: 'rejected', code: 'INVALID_REQUEST' });
      f.setNow(compacted.compactedAtEpochMs - 1);
      expect(await budget.reserve(request)).toMatchObject({ code: 'BUDGET_STALE' });
      f.setNow(now);
      expect(await fs.readFile(store.filePath, 'utf8')).toBe(before);
      expect(
        (await budget.reserve({ ...request, reservationId: createUsageReservationId(now) })).status,
      ).toBe('reserved');
      expect(budget.snapshot()).toMatchObject({
        compacted,
        activeMinutes: 72,
        localEstimatedMinutes: 144,
        localEstimatedBytes: 4800,
      });
      if (!providerQuota) expect(budget.snapshot().availableMinutes).toBe(928);
      await budget.markRetiring(request.reservationId);
      await budget.markRemoteConfirmed(request.reservationId);
      if (!providerQuota) {
        f.setNow(now + 1);
        await budget.reconcileOfficial(
          { ...official, checkedAtEpochMs: now + 1 },
          { periodId: '2026-09', version: 2 },
        );
        expect(
          await budget.releaseConfirmed(request.reservationId, {
            remoteConfirmed: true,
            periodId: '2026-09',
            version: 2,
          }),
        ).toBe(true);
      }
      await budget.close();
      const again = new UsageBudget({
        ...f.options,
        store: new UsageCheckpoint({ opsDataDir: f.dir, providerQuota }),
      });
      expect(await again.restore()).toMatchObject({
        compacted,
        activeMinutes: 36,
        localEstimatedMinutes: 144,
        localEstimatedBytes: 4800,
      });
      expect((await again.reserve(request)).status).toBe('rejected');
      await again.close();
    },
  );

  it.each([
    { version: 2 },
    { reservationCount: 0 },
    { reservationCount: 73 },
    { minutes: -1 },
    { bytes: Number.POSITIVE_INFINITY },
    { retiredThroughEpochMs: 1001 },
    { compactedAtEpochMs: null },
    { unexpected: 'value' },
  ])('rejects malformed compaction evidence without inventing totals: %j', (change) => {
    expect(() =>
      validateUsageState(
        {
          official: null,
          reservations: [],
          compacted: {
            version: 1,
            retiredThroughEpochMs: 1000,
            compactedAtEpochMs: 1000 + 86_400_000,
            reservationCount: 2,
            minutes: 72,
            bytes: 2400,
            ...change,
          },
        },
        true,
      ),
    ).toThrow('unexpected' in change ? 'INVALID_SCHEMA' : 'INVALID_USAGE_COMPACTION');
  });

  it('counts all six participants plus safety margin once and persists before success', async () => {
    const { budget, options } = await setup();
    const [first, second] = await Promise.all([
      budget.reserve(request),
      budget.reserve({ ...request }),
    ]);
    expect(first.status).toBe('reserved');
    expect(second.status).toBe('duplicate');
    expect(budget.snapshot()).toMatchObject({ activeMinutes: 36, activeBytes: 1200 });
    const restored = new UsageBudget(options);
    await restored.restore();
    expect(restored.snapshot().activeMinutes).toBe(36);
    expect(await restored.reserve({ ...request, expectedBytes: 2000 })).toEqual({
      status: 'rejected',
      code: 'ID_CONFLICT',
    });
  });
  it('rejects missing, stale, future, wrong project and placeholder official input', async () => {
    const { budget, setNow } = await setup(false);
    expect(await budget.reserve(request)).toEqual({
      status: 'rejected',
      code: 'BUDGET_UNCONFIRMED',
    });
    for (const value of [
      { ...official, checkedBy: 'dummy' },
      { ...official, token: 'secret' },
      { ...official, remainingBytes: -1 },
    ])
      expect(() => validateOfficialBudget(value)).toThrow();
    for (const value of [
      { ...official, projectAlias: 'other' },
      { ...official, checkedAtEpochMs: 1001 },
    ])
      expect(
        (await budget.reconcileOfficial(value, { periodId: '2026-09', version: 1 })).status,
      ).toBe('rejected');
    await budget.reconcileOfficial(official, { periodId: '2026-09', version: 1 });
    setNow(11001);
    expect(await budget.reserve(request)).toEqual({ status: 'rejected', code: 'BUDGET_STALE' });
  });
  it('rejects exhausted minutes and bytes without modifying memory or disk', async () => {
    const { budget, store } = await setup();
    const before = await fs.readFile(store.filePath, 'utf8');
    expect(await budget.reserve({ ...request, expectedMinutes: 200 })).toEqual({
      status: 'rejected',
      code: 'MINUTES_EXHAUSTED',
    });
    expect(await budget.reserve({ ...request, expectedBytes: 100000 })).toEqual({
      status: 'rejected',
      code: 'BYTES_EXHAUSTED',
    });
    expect(budget.snapshot().reservations).toHaveLength(0);
    expect(await fs.readFile(store.filePath, 'utf8')).toBe(before);
  });
  it('keeps development, load, public and reserve allocations separate', async () => {
    const { budget } = await setup();
    expect(
      await budget.reserve({ ...request, purpose: 'development', expectedMinutes: 40, margin: 0 }),
    ).toEqual({ status: 'rejected', code: 'BUCKET_EXHAUSTED' });
    expect((await budget.reserve({ ...request, expectedMinutes: 40, margin: 0 })).status).toBe(
      'reserved',
    );
  });
  it('does not release a retiring reservation until remote and newer official evidence both exist', async () => {
    const { budget, options, setNow } = await setup();
    await budget.reserve(request);
    setNow(2000);
    await budget.markRetiring(request.reservationId);
    expect(
      await budget.releaseConfirmed(request.reservationId, {
        remoteConfirmed: true,
        periodId: '2026-09',
        version: 1,
      }),
    ).toBe(false);
    const restored = new UsageBudget(options);
    await restored.restore();
    expect(restored.snapshot().activeMinutes).toBe(36);
    expect(await restored.reserve({ ...request, reservationId: 'new' })).toEqual({
      status: 'rejected',
      code: 'UNRESOLVED_RETIREMENT',
    });
    expect(await restored.markRemoteConfirmed(request.reservationId)).toBe(true);
    expect((await restored.reserve({ ...request, reservationId: 'next-generation' })).status).toBe(
      'reserved',
    );
    setNow(3000);
    await restored.reconcileOfficial(
      { ...official, checkedAtEpochMs: 3000, remainingMinutes: 960 },
      { periodId: '2026-09', version: 2 },
    );
    expect(
      await restored.releaseConfirmed(request.reservationId, {
        remoteConfirmed: false,
        periodId: '2026-09',
        version: 2,
      } as never),
    ).toBe(false);
    expect(
      await restored.releaseConfirmed(request.reservationId, {
        remoteConfirmed: true,
        periodId: '2026-09',
        version: 2,
      }),
    ).toBe(true);
    expect(restored.snapshot()).toMatchObject({ activeMinutes: 36, localEstimatedMinutes: 72 });
    expect(await restored.reserve(request)).toEqual({
      status: 'rejected',
      code: 'UNRESOLVED_RETIREMENT',
    });
  });
  it('rejects duplicate revision with different payload and does not double apply same evidence', async () => {
    const { budget } = await setup();
    expect(await budget.reconcileOfficial(official, { periodId: '2026-09', version: 1 })).toEqual({
      status: 'duplicate',
    });
    expect(
      await budget.reconcileOfficial(
        { ...official, remainingMinutes: 2000 },
        { periodId: '2026-09', version: 1 },
      ),
    ).toEqual({ status: 'rejected', code: 'REVISION_CONFLICT' });
  });
  it('treats missing historical checkpoint as locked instead of zero-initializing', async () => {
    const { options, store } = await setup();
    await fs.unlink(store.filePath);
    const restored = new UsageBudget({
      ...options,
      store: new UsageCheckpoint({ opsDataDir: path.dirname(store.filePath) }),
    });
    await restored.restore();
    expect(await restored.reconcileOfficial(official, { periodId: '2026-09', version: 1 })).toEqual(
      { status: 'rejected', code: 'USAGE_HISTORY_MISSING' },
    );
    expect(await restored.reserve(request)).toEqual({
      status: 'rejected',
      code: 'BUDGET_UNCONFIRMED',
    });
  });
  it('locks on durable-write failure and never returns a permit', async () => {
    const { budget, store } = await setup();
    vi.spyOn(store, 'write').mockRejectedValue(new Error('ENOSPC'));
    expect(await budget.reserve(request)).toEqual({ status: 'rejected', code: 'STORAGE_FAILURE' });
    expect(budget.snapshot()).toMatchObject({ activeMinutes: 0, writable: false });
  });
  it('rechecks admission after persistence and keeps a conservative reservation', async () => {
    const { budget, store, setAllowed } = await setup();
    const write = store.write.bind(store);
    vi.spyOn(store, 'write').mockImplementation(async (checkpoint) => {
      await write(checkpoint);
      setAllowed(false);
    });
    expect(await budget.reserve(request)).toEqual({ status: 'rejected', code: 'ISSUANCE_BLOCKED' });
    expect(budget.snapshot().activeMinutes).toBe(36);
    expect(await budget.reserve(request)).toEqual({ status: 'rejected', code: 'ISSUANCE_BLOCKED' });
  });
});

it('reuses frozen accounting until persistence and observes close immediately', async () => {
  const s = await setup();
  const first = s.budget.readSnapshot();
  expect(s.budget.readSnapshot().reservations).toBe(first.reservations);
  expect(() => {
    first.official!.checkpoint.remainingMinutes = 0;
  }).toThrow();
  await s.budget.reserve(request);
  const next = s.budget.readSnapshot();
  expect(next.reservations).not.toBe(first.reservations);
  expect(next.reservations).toHaveLength(1);
  await s.budget.close();
  expect(s.budget.readSnapshot().writable).toBe(false);
});
describe('provider quota with durable local accounting', () => {
  it('survives a month and checkpoint reload, releasing only after remote retirement confirmation', async () => {
    const f = await setup(false, true);
    expect(f.budget.snapshot()).toMatchObject({
      integrity: 'ok',
      official: null,
      budgetPolicy: 'provider-quota',
    });
    expect((await f.budget.reserve(request)).status).toBe('reserved');
    expect(await f.budget.markRemoteConfirmed(request.reservationId)).toBe(false);
    expect(await f.budget.markRetiring(request.reservationId)).toBe(true);
    expect(await f.budget.reserve({ ...request, reservationId: 'blocked' })).toMatchObject({
      code: 'UNRESOLVED_RETIREMENT',
    });
    f.setNow(30 * 86400000);
    const restored = new UsageBudget(f.options);
    await restored.restore();
    expect(restored.snapshot().reservations[0]?.status).toBe('RETIRING');
    expect(await restored.markRemoteConfirmed(request.reservationId)).toBe(true);
    expect(restored.snapshot()).toMatchObject({ activeMinutes: 0, official: null });
    expect((await restored.reserve({ ...request, reservationId: 'next-round' })).status).toBe(
      'reserved',
    );
    expect(
      (await restored.reconcileOfficial(official, { version: 2, periodId: '2026-10' })).status,
    ).toBe('rejected');
    f.setAllowed(false);
    expect(await restored.reserve({ ...request, reservationId: 'closed' })).toMatchObject({
      code: 'ISSUANCE_BLOCKED',
    });
    const again = new UsageBudget(f.options);
    expect((await again.restore()).reservations.map((r) => r.status)).toEqual([
      'RELEASED',
      'ACTIVE',
    ]);
  });
  it('never recreates missing/corrupt history without the one-use initialization proof', async () => {
    const f = await setup(false, true);
    await fs.unlink(path.join(f.dir, 'usage-checkpoint.json'));
    const missing = new UsageBudget(f.options);
    expect((await missing.restore()).integrity).toBe('missing');
    expect(await missing.reserve(request)).toMatchObject({ code: 'BUDGET_UNCONFIRMED' });
    await fs.writeFile(path.join(f.dir, 'usage-checkpoint.json'), '{}');
    const corrupt = new UsageBudget(f.options);
    expect((await corrupt.restore({ allowInitializeMissing: true })).integrity).toBe('corrupt');
    expect(await corrupt.reserve(request)).toMatchObject({ code: 'STORAGE_FAILURE' });
  });
  it('migrates existing official and awaiting records without rewriting the official report', async () => {
    const f = await setup();
    await f.budget.reserve(request);
    await f.budget.markRetiring(request.reservationId);
    await f.budget.markRemoteConfirmed(request.reservationId);
    f.setNow(30 * 86400000);
    const migrated = new UsageBudget({
      ...f.options,
      providerQuota: true,
      store: new UsageCheckpoint({ opsDataDir: f.dir, providerQuota: true }),
    });
    const before = await migrated.restore();
    expect(before.reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    expect(await migrated.markRemoteConfirmed(request.reservationId)).toBe(true);
    expect(migrated.snapshot().official).toEqual(before.official);
    expect(migrated.snapshot().reservations[0]?.status).toBe('RELEASED');
    expect((await migrated.reserve({ ...request, reservationId: 'after-migration' })).status).toBe(
      'reserved',
    );
  });
});

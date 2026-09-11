import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint, validateOfficialBudget } from '../../src/operations/UsageCheckpoint.js';
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
async function setup(confirmed = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e-usage-'));
  directories.push(dir);
  let now = 1000;
  let allowed = true;
  const store = new UsageCheckpoint({ opsDataDir: dir });
  const options = {
    store,
    projectAlias: 'project-204',
    officialBudgetMaxAgeMs: 10000,
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

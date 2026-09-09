import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import { createRecoveryBootstrap } from '../../src/operations/RecoveryBootstrap.js';
import { validateRetryIntent, type RetryIntent } from '../../src/operations/RevocationRetries.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint } from '../../src/operations/UsageCheckpoint.js';
import { deferred } from '../media/generation-fixtures.js';

const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const gates: (() => void)[] = [];
const request = {
  reservationId: 'lease-1',
  matchId: 'match-1',
  purpose: 'public' as const,
  slots: 6 as const,
  expectedMinutes: 5,
  expectedBytes: 1_000,
  margin: 0,
};
const intent: RetryIntent = {
  retirementId: 'retire-1',
  reservationId: 'lease-1',
  identity: 'identity-1',
  generation: 1,
  firstRetireEpochMs: 1_000,
  lastAttemptEpochMs: null,
  nextAttemptEpochMs: 2_000,
  attempt: 0,
  status: 'REVOKING',
  alarmed: false,
  providerWaitUnknown: false,
};
const official = (at: number) => ({
  projectAlias: 'shutdown-project',
  remainingMinutes: 1_000,
  remainingBytes: 1_000_000,
  checkedAtEpochMs: at,
  source: 'cloud-dashboard' as const,
  checkedBy: 'local-shutdown-operator',
});

async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e12-shutdown-'));
  directories.push(dir);
  return dir;
}

function resources(dir: string, clock = { now: 1_000 }) {
  const journal = new OperationJournal({ opsDataDir: dir });
  const usageStore = new UsageCheckpoint({ opsDataDir: dir, isWritable: () => journal.writable });
  const usage = new UsageBudget({
    store: usageStore,
    projectAlias: 'shutdown-project',
    officialBudgetMaxAgeMs: 60_000,
    now: () => clock.now,
    canIssue: () => ({ allowed: true }),
  });
  const retry = new CheckpointStore<readonly RetryIntent[]>({
    opsDataDir: dir,
    fileName: 'retry-checkpoint.json',
    isWritable: () => journal.writable,
    validate: (value) => {
      if (!Array.isArray(value)) throw new Error('INVALID_TEST_RETRY_CHECKPOINT');
      return value.map(validateRetryIntent);
    },
  });
  closers.push(async () => {
    await Promise.all([usage.close(), retry.close()]);
    await journal.close();
  });
  return { journal, usage, usageStore, retry, clock };
}

async function setup() {
  const dir = await directory();
  const stores = resources(dir);
  const bootstrap = createRecoveryBootstrap({
    namespace: 'shutdown',
    journal: stores.journal,
    usageBudget: stores.usage,
    retryCheckpoint: stores.retry,
    nowEpochMs: () => stores.clock.now,
    monotonicNow: () => 0,
    officialBudgetMaxAgeMs: 60_000,
    firstInstallationConfirmed: async () => true,
  });
  closers.push(() => bootstrap.close());
  await bootstrap.initialize();
  await bootstrap.completion();
  expect(
    await stores.usage.reconcileOfficial(official(1_000), { periodId: '2026-09', version: 1 }),
  ).toEqual({ status: 'applied' });
  return { dir, stores, bootstrap };
}

function holdRename(filePath: string) {
  const entered = deferred<void>();
  const gate = deferred<void>();
  gates.push(() => gate.resolve());
  const rename = fs.rename.bind(fs);
  let once = true;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    if (once && String(target) === filePath) {
      once = false;
      entered.resolve();
      await gate.promise;
    }
    await rename(source, target);
  });
  return { entered: entered.promise, release: () => gate.resolve() };
}

afterEach(async () => {
  for (const release of gates.splice(0)) release();
  for (const close of closers.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('kkakkung-e12-shutdown-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

describe('E-12 shutdown preserves one writer through every accepted checkpoint write', () => {
  it('drains usage before releasing the journal lease and never overwrites the next writer', async () => {
    const { dir, stores, bootstrap } = await setup();
    const gate = holdRename(stores.usageStore.filePath);
    stores.clock.now = 2_000;
    const writing = stores.usage.reconcileOfficial(official(2_000), {
      periodId: '2026-09',
      version: 2,
    });
    await gate.entered;
    let closed = false;
    const closing = bootstrap.close().then(() => {
      closed = true;
    });
    expect(stores.usage.snapshot().writable).toBe(false);
    expect(stores.retry.writable).toBe(false);
    const rival = resources(dir);
    expect(await rival.journal.restore()).toMatchObject({
      writable: false,
      reason: 'WRITER_CONFLICT',
    });
    expect(closed).toBe(false);
    expect(stores.journal.writable).toBe(true);
    gate.release();
    expect(await writing).toEqual({ status: 'applied' });
    await closing;
    const next = resources(dir, { now: 3_000 });
    expect((await next.journal.restore()).writable).toBe(true);
    expect((await next.usage.restore()).official?.version).toBe(2);
    expect(
      await next.usage.reconcileOfficial(official(3_000), { periodId: '2026-09', version: 3 }),
    ).toEqual({ status: 'applied' });
    const disk = await next.usageStore.read();
    expect(disk.integrity === 'ok' && disk.checkpoint.state.official?.version).toBe(3);
    expect(
      await stores.usage.reconcileOfficial(official(3_000), { periodId: '2026-09', version: 99 }),
    ).toEqual({ status: 'rejected', code: 'STORAGE_FAILURE' });
    expect(await next.usageStore.read()).toEqual(disk);
  });

  it('drains active and queued retry writes before releasing the writer and rejects new writes', async () => {
    const { dir, stores, bootstrap } = await setup();
    const gate = holdRename(stores.retry.filePath);
    const firstWrite = stores.retry.write({ lastSeq: 1, state: [intent] });
    await gate.entered;
    const queuedWrite = stores.retry.write({ lastSeq: 2, state: [{ ...intent, attempt: 1 }] });
    const closing = bootstrap.close();
    expect(stores.retry.writable).toBe(false);
    await expect(stores.retry.write({ lastSeq: 99, state: [] })).rejects.toThrow(
      'CHECKPOINT_NOT_WRITABLE',
    );
    const rival = resources(dir);
    expect(await rival.journal.restore()).toMatchObject({
      writable: false,
      reason: 'WRITER_CONFLICT',
    });
    expect(stores.journal.writable).toBe(true);
    gate.release();
    await Promise.all([firstWrite, queuedWrite, closing]);
    const next = resources(dir);
    expect((await next.journal.restore()).writable).toBe(true);
    const old = await next.retry.read();
    expect(old.integrity === 'ok' && old.checkpoint.lastSeq).toBe(2);
    await next.retry.write({ lastSeq: 3, state: [{ ...intent, attempt: 2 }] });
    const disk = await next.retry.read();
    expect(disk.integrity === 'ok' && disk.checkpoint.lastSeq).toBe(3);
    await expect(stores.retry.write({ lastSeq: 100, state: [] })).rejects.toThrow(
      'CHECKPOINT_NOT_WRITABLE',
    );
    expect(await next.retry.read()).toEqual(disk);
  });

  it('stops every public usage mutation synchronously and waits for an already accepted queue', async () => {
    const { stores } = await setup();
    expect((await stores.usage.reserve(request)).status).toBe('reserved');
    stores.clock.now = 2_000;
    const gate = holdRename(stores.usageStore.filePath);
    const first = stores.usage.reconcileOfficial(official(2_000), {
      periodId: '2026-09',
      version: 2,
    });
    await gate.entered;
    stores.clock.now = 3_000;
    const second = stores.usage.reconcileOfficial(official(3_000), {
      periodId: '2026-09',
      version: 3,
    });
    const closing = stores.usage.close();
    expect(stores.usage.close()).toBe(closing);
    expect(stores.usage.snapshot().writable).toBe(false);
    expect(await stores.usage.reserve(request)).toEqual({
      status: 'rejected',
      code: 'STORAGE_FAILURE',
    });
    expect(
      await stores.usage.reconcileOfficial(official(3_000), { periodId: '2026-09', version: 4 }),
    ).toEqual({ status: 'rejected', code: 'STORAGE_FAILURE' });
    expect(await stores.usage.markRetiring('lease-1')).toBe(false);
    expect(await stores.usage.markRemoteConfirmed('lease-1')).toBe(false);
    expect(
      await stores.usage.releaseConfirmed('lease-1', {
        remoteConfirmed: true,
        periodId: '2026-09',
        version: 2,
      }),
    ).toBe(false);
    const restore = vi.spyOn(stores.usageStore, 'read');
    expect((await stores.usage.restore({ allowInitializeMissing: true })).writable).toBe(false);
    expect(restore).not.toHaveBeenCalled();
    gate.release();
    expect(await first).toEqual({ status: 'applied' });
    expect(await second).toEqual({ status: 'applied' });
    await closing;
    expect(stores.usageStore.writable).toBe(false);
    expect(stores.usage.snapshot().official?.version).toBe(3);
    expect(stores.usage.snapshot().activeMinutes).toBe(30);
  });

  it('closes a checkpoint once and preserves accepted writes even when close precedes their execution', async () => {
    const dir = await directory();
    const checkpoint = new CheckpointStore<number>({
      opsDataDir: dir,
      fileName: 'direct-checkpoint.json',
      validate: (value) => {
        if (!Number.isSafeInteger(value)) throw new Error('INVALID_TEST_NUMBER');
        return value as number;
      },
    });
    closers.push(() => checkpoint.close());
    const first = checkpoint.write({ lastSeq: 1, state: 1 });
    const second = checkpoint.write({ lastSeq: 2, state: 2 });
    const closing = checkpoint.close();
    expect(checkpoint.close()).toBe(closing);
    expect(checkpoint.writable).toBe(false);
    await expect(checkpoint.write({ lastSeq: 3, state: 3 })).rejects.toThrow(
      'CHECKPOINT_NOT_WRITABLE',
    );
    await Promise.all([first, second, closing]);
    expect(await checkpoint.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: { lastSeq: 2, state: 2 },
    });
  });
});

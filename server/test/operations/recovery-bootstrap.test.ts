import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import { OperationJournal, type JournalRecord } from '../../src/operations/OperationJournal.js';
import {
  createRecoveryBootstrap,
  type RecoveryBootstrapOptions,
} from '../../src/operations/RecoveryBootstrap.js';
import type { CleanupReport } from '../../src/operations/RecoveryState.js';
import type { RetryIntent } from '../../src/operations/RevocationRetries.js';
import { validateRetryCheckpoint } from '../../src/operations/RevocationRetryBindings.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint } from '../../src/operations/UsageCheckpoint.js';
import { deferred } from '../media/generation-fixtures.js';

const EPOCH = 1_800_000_000_000;
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const cleaned: CleanupReport = {
  recordedIdentities: 1,
  observedParticipants: 1,
  revoked: 1,
  unresolved: 0,
  ownedRoomsRemaining: 0,
  historyComplete: true,
};
const prepared: JournalRecord = {
  state: 'PREPARED',
  namespace: 'e12-fixture',
  matchId: 'match-1',
  mediaInstanceId: 'practice-1',
  roomName: 'e12-fixture--old-room',
  serverEpoch: 'old-epoch',
  identity: 'old-identity',
  generation: 1,
  issuedAtEpochMs: EPOCH,
  expiresAtEpochMs: EPOCH + 300_000,
  reservationId: 'lease-1',
  atEpochMs: EPOCH,
};

async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e12-bootstrap-'));
  directories.push(dir);
  return dir;
}

function resources(dir: string, now = { epoch: EPOCH + 1000, monotonic: 50 }) {
  const journal = new OperationJournal({ opsDataDir: dir });
  const usageStore = new UsageCheckpoint({ opsDataDir: dir, isWritable: () => journal.writable });
  const usage = new UsageBudget({
    store: usageStore,
    projectAlias: 'local-fixture',
    officialBudgetMaxAgeMs: 60_000,
    now: () => now.epoch,
    canIssue: () => ({ allowed: true }),
  });
  const retry = new CheckpointStore<readonly RetryIntent[]>({
    opsDataDir: dir,
    fileName: 'retry-checkpoint.json',
    validate: validateRetryCheckpoint,
    isWritable: () => journal.writable,
  });
  closers.push(async () => {
    await retry.close();
    await usageStore.close();
    await journal.close();
  });
  return { journal, usage, usageStore, retry, now };
}

function boot(
  stores: ReturnType<typeof resources>,
  options: Partial<RecoveryBootstrapOptions> = {},
) {
  const cleanup = vi.fn(async () => cleaned);
  const bootstrap = createRecoveryBootstrap({
    namespace: 'e12-fixture',
    journal: stores.journal,
    usageBudget: stores.usage,
    retryCheckpoint: stores.retry,
    nowEpochMs: () => stores.now.epoch,
    monotonicNow: () => stores.now.monotonic,
    officialBudgetMaxAgeMs: 60_000,
    beginCleanup: cleanup,
    ...options,
  });
  closers.push(() => bootstrap.close());
  return { bootstrap, cleanup };
}

async function seed(record: JournalRecord = prepared) {
  const dir = await directory();
  const stores = resources(dir, { epoch: EPOCH, monotonic: 0 });
  await stores.journal.restore();
  await stores.usage.restore({ allowInitializeMissing: true });
  expect(
    await stores.usage.reconcileOfficial(
      {
        projectAlias: 'local-fixture',
        remainingMinutes: 1000,
        remainingBytes: 1_000_000,
        checkedAtEpochMs: EPOCH,
        source: 'cloud-dashboard',
        checkedBy: 'local-fixture-operator',
      },
      { periodId: '2026-09', version: 1 },
    ),
  ).toEqual({ status: 'applied' });
  expect(
    (
      await stores.usage.reserve({
        reservationId: 'lease-1',
        matchId: 'match-1',
        purpose: 'public',
        slots: 6,
        expectedMinutes: 5,
        expectedBytes: 1000,
        margin: 0,
      })
    ).status,
  ).toBe('reserved');
  const appended = await stores.journal.append(record);
  await stores.journal.close();
  return { dir, record, appended, journalPath: stores.journal.filePath };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
  for (const dir of directories.splice(0)) {
    if (
      !path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(dir).startsWith('kkakkung-e12-bootstrap-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('E-12 real local storage recovery; no Cloud calls', () => {
  it('constructs synchronously with closed admission and restores an old epoch once while cleanup waits', async () => {
    const { dir } = await seed();
    const stores = resources(dir);
    const restore = vi.spyOn(stores.journal, 'restore');
    const gate = deferred<CleanupReport>();
    const cleanup = vi.fn(() => gate.promise);
    const { bootstrap } = boot(stores, { beginCleanup: cleanup });
    expect(restore).not.toHaveBeenCalled();
    expect(bootstrap.getReadiness().state).toBe('RECOVERING');
    expect(bootstrap.getAdmission()).toBe('DRAINING');
    const first = bootstrap.initialize();
    expect(bootstrap.initialize()).toBe(first);
    const initial = await first;
    expect(initial).toMatchObject({
      status: 'initialized',
      readiness: { state: 'RECOVERING', unresolvedCount: 1 },
      admission: 'DRAINING',
    });
    expect(restore).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(bootstrap.initialize()).toBe(first);
    expect(bootstrap.serverEpoch).not.toBe(prepared.serverEpoch);
    expect(bootstrap.serverEpoch).toMatch(/^[0-9a-f-]{36}$/);
    expect(bootstrap.recovered()?.pendingRecords[0]?.record).toMatchObject(prepared);
    expect(stores.usage.snapshot()).toMatchObject({ activeMinutes: 30 });
    expect(JSON.stringify(bootstrap.getReadiness())).not.toContain(prepared.identity);
    gate.resolve(cleaned);
    await bootstrap.completion();
    expect(bootstrap.getReadiness().state).toBe('READY');
    expect(bootstrap.getAdmission()).toBe('DRAINING');
    expect(initial).toMatchObject({ readiness: { state: 'RECOVERING' }, admission: 'DRAINING' });
    expect(Object.isFrozen(initial)).toBe(true);
    expect(stores.usage.snapshot().activeMinutes).toBe(30);
  });

  it('preserves missing history and surviving usage instead of trusting empty files', async () => {
    const { dir, journalPath } = await seed();
    await fs.unlink(journalPath);
    const stores = resources(dir);
    const firstInstall = vi.fn(async () => true);
    const { bootstrap, cleanup } = boot(stores, { firstInstallationConfirmed: firstInstall });
    expect(await bootstrap.initialize()).toMatchObject({
      status: 'initialized',
      readiness: { state: 'LOCKED', historyComplete: false },
    });
    await bootstrap.completion();
    expect(cleanup).not.toHaveBeenCalled();
    expect(stores.usage.snapshot().activeMinutes).toBe(30);
    expect(bootstrap.getReadiness().reasonCodes).toContain('JOURNAL_HISTORY_MISSING');
  });

  it.each([false, true])(
    'requires external first-install evidence (%s) and still needs official budget',
    async (confirmed) => {
      const dir = await directory();
      const stores = resources(dir);
      const confirmation = vi.fn(async () => confirmed);
      const { bootstrap } = boot(stores, { firstInstallationConfirmed: confirmation });
      expect(await bootstrap.initialize()).toMatchObject({
        status: 'initialized',
        readiness: { state: 'LOCKED', historyComplete: confirmed },
        admission: 'DRAINING',
      });
      await bootstrap.completion();
      expect(confirmation).toHaveBeenCalledOnce();
      expect(bootstrap.getReadiness().reasonCodes).toContain('BUDGET_UNCONFIRMED');
      expect(stores.usage.snapshot().integrity).toBe('missing');
    },
  );

  it('never enables first-install reset when journal identities survive a missing usage file', async () => {
    const { dir } = await seed();
    await fs.unlink(path.join(dir, 'usage-checkpoint.json'));
    const stores = resources(dir);
    const confirmation = vi.fn(async () => true);
    const { bootstrap, cleanup } = boot(stores, { firstInstallationConfirmed: confirmation });
    expect(await bootstrap.initialize()).toMatchObject({
      status: 'initialized',
      readiness: { state: 'LOCKED', historyComplete: false },
    });
    expect(confirmation).not.toHaveBeenCalled();
    await bootstrap.completion();
    expect(cleanup).not.toHaveBeenCalled();
    expect(bootstrap.recovered()?.pendingRecords).toHaveLength(1);
  });

  it.each(['partial', 'corrupt'] as const)(
    'exposes %s state without erasing the input bytes or starting cleanup',
    async (kind) => {
      const { dir, journalPath: file } = await seed();
      if (kind === 'partial') await fs.appendFile(file, '{"version":1');
      else {
        const entry = JSON.parse((await fs.readFile(file, 'utf8')).trim());
        entry.checksum = '0'.repeat(64);
        await fs.writeFile(file, JSON.stringify(entry) + '\n');
      }
      const original = await fs.readFile(file);
      const stores = resources(dir);
      const { bootstrap, cleanup } = boot(stores);
      expect(await bootstrap.initialize()).toMatchObject({
        status: 'initialized',
        readiness: { state: 'LOCKED' },
      });
      expect(bootstrap.state.snapshot().integrity).toBe(kind);
      await bootstrap.completion();
      expect(cleanup).not.toHaveBeenCalled();
      expect(await fs.readFile(file)).toEqual(original);
      expect(stores.usage.snapshot().activeMinutes).toBe(30);
    },
  );

  it('reports writer conflict as fatal without disturbing the existing writer', async () => {
    const { dir } = await seed();
    const first = resources(dir);
    expect((await first.journal.restore()).writable).toBe(true);
    const second = resources(dir);
    const { bootstrap, cleanup } = boot(second);
    expect(await bootstrap.initialize()).toEqual({ status: 'fatal', code: 'WRITER_CONFLICT' });
    expect(cleanup).not.toHaveBeenCalled();
    await bootstrap.close();
    expect(first.journal.writable).toBe(true);
    expect(await first.journal.append({ ...prepared, atEpochMs: EPOCH + 2000 })).toMatchObject({
      durable: true,
    });
  });

  it('reports an unusable volume as fatal instead of an observable successful initialization', async () => {
    const dir = await directory();
    const blocked = path.join(dir, 'not-a-directory');
    await fs.writeFile(blocked, 'local fixture');
    const stores = resources(blocked);
    const { bootstrap, cleanup } = boot(stores);
    expect(await bootstrap.initialize()).toEqual({
      status: 'fatal',
      code: 'INITIALIZATION_FAILED',
    });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('waits for local initialization on close, never starts cleanup, and reuses the close promise', async () => {
    const { dir } = await seed();
    const stores = resources(dir);
    const gate = deferred<void>();
    const entered = deferred<void>();
    const originalRestore = stores.journal.restore.bind(stores.journal);
    vi.spyOn(stores.journal, 'restore').mockImplementation(async () => {
      entered.resolve();
      await gate.promise;
      return originalRestore();
    });
    const journalClose = vi.spyOn(stores.journal, 'close');
    const { bootstrap, cleanup } = boot(stores);
    const initializing = bootstrap.initialize();
    await entered.promise;
    const closing = bootstrap.close();
    expect(bootstrap.close()).toBe(closing);
    expect(journalClose).not.toHaveBeenCalled();
    gate.resolve();
    expect(await initializing).toEqual({ status: 'fatal', code: 'INITIALIZATION_FAILED' });
    await closing;
    expect(journalClose).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    expect(bootstrap.initialize()).toBe(initializing);
  });

  it('aborts a delayed cleanup dispatch without awaiting an unresponsive network callback', async () => {
    const { dir } = await seed();
    const stores = resources(dir);
    const wait = deferred<void>();
    const network = vi.fn();
    const cleanup = vi.fn<NonNullable<RecoveryBootstrapOptions['beginCleanup']>>(async (input) => {
      await wait.promise;
      if (input.beforeDispatch()) network();
      expect(input.signal.aborted).toBe(true);
      return cleaned;
    });
    const { bootstrap } = boot(stores, { beginCleanup: cleanup });
    await bootstrap.initialize();
    await bootstrap.close();
    wait.resolve();
    expect(await bootstrap.completion()).toBeNull();
    expect(network).not.toHaveBeenCalled();
    expect(bootstrap.getReadiness().state).toBe('LOCKED');
    expect(bootstrap.getReadiness().reasonCodes).toContain('CLOSED');
  });

  it('locks after cleanup failure, keeps initialize memoized, and never exposes raw error text', async () => {
    const { dir } = await seed();
    const stores = resources(dir);
    const cleanup = vi.fn(async () => {
      throw new Error('fixture-private-data-must-not-leak');
    });
    const { bootstrap } = boot(stores, { beginCleanup: cleanup });
    const first = bootstrap.initialize();
    await first;
    await bootstrap.completion();
    expect(bootstrap.initialize()).toBe(first);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(bootstrap.getReadiness().reasonCodes).toContain('CLEANUP_FAILED');
    expect(JSON.stringify(bootstrap.getReadiness())).not.toContain('fixture-private-data');
  });

  it('treats an absent cleanup adapter as pending integration rather than successful recovery', async () => {
    const { dir } = await seed();
    const { bootstrap } = boot(resources(dir), { beginCleanup: undefined });
    await bootstrap.initialize();
    await bootstrap.completion();
    expect(bootstrap.getReadiness().state).toBe('LOCKED');
    expect(bootstrap.getReadiness().reasonCodes).toContain('CLEANUP_NOT_CONFIGURED');
  });

  it('does not let a new official checkpoint overwrite lost usage history', async () => {
    const { dir } = await seed();
    await fs.unlink(path.join(dir, 'usage-checkpoint.json'));
    const stores = resources(dir);
    const { bootstrap } = boot(stores, { firstInstallationConfirmed: async () => true });
    await bootstrap.initialize();
    expect(
      await stores.usage.reconcileOfficial(
        {
          projectAlias: 'local-fixture',
          remainingMinutes: 1000,
          remainingBytes: 1_000_000,
          checkedAtEpochMs: EPOCH + 1000,
          source: 'cloud-dashboard',
          checkedBy: 'local-fixture-operator',
        },
        { periodId: '2026-09', version: 2 },
      ),
    ).toMatchObject({ status: 'rejected' });
    bootstrap.refreshBudget();
    expect(bootstrap.getReadiness().state).toBe('LOCKED');
  });

  it('rejects invalid configuration and a reused non-UUID epoch synchronously', async () => {
    const stores = resources(await directory());
    expect(() => boot(stores, { namespace: 'wrong--namespace' })).toThrow(
      'INVALID_RECOVERY_CONFIGURATION',
    );
    expect(() => boot(stores, { officialBudgetMaxAgeMs: 0 })).toThrow(
      'INVALID_RECOVERY_CONFIGURATION',
    );
    expect(() => boot(stores, { serverEpoch: 'old-epoch' })).toThrow(
      'INVALID_RECOVERY_CONFIGURATION',
    );
  });

  it('memoizes fatal close-before-initialize without acquiring a writer', async () => {
    const stores = resources(await directory());
    const restore = vi.spyOn(stores.journal, 'restore');
    const { bootstrap } = boot(stores);
    await bootstrap.close();
    const first = bootstrap.initialize();
    expect(bootstrap.initialize()).toBe(first);
    expect(await first).toEqual({ status: 'fatal', code: 'INITIALIZATION_FAILED' });
    expect(restore).not.toHaveBeenCalled();
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import { OperationJournal, type JournalRecord } from '../../src/operations/OperationJournal.js';
import {
  createRecoveryBootstrap,
  type RecoveryBootstrapOptions,
  type RecoveryCleanupInput,
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
const gates: (() => void)[] = [];
const report: CleanupReport = {
  recordedIdentities: 1,
  observedParticipants: 1,
  revoked: 1,
  unresolved: 0,
  ownedRoomsRemaining: 0,
  historyComplete: true,
};
const record: JournalRecord = {
  state: 'PREPARED',
  namespace: 'e13-lifecycle',
  matchId: 'match-1',
  mediaInstanceId: 'practice-1',
  roomName: 'e13-lifecycle--old-room',
  serverEpoch: 'old-epoch',
  identity: 'old-identity',
  generation: 1,
  issuedAtEpochMs: EPOCH,
  expiresAtEpochMs: EPOCH + 300_000,
  reservationId: 'lease-1',
  atEpochMs: EPOCH,
};
const official = (version: number) => ({
  projectAlias: 'e13-lifecycle-project',
  remainingMinutes: 1000,
  remainingBytes: 1_000_000,
  checkedAtEpochMs: EPOCH + version,
  source: 'cloud-dashboard' as const,
  checkedBy: 'local-fixture-operator',
});

async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e13-lifecycle-'));
  directories.push(dir);
  return dir;
}

function resources(dir: string) {
  const journal = new OperationJournal({ opsDataDir: dir });
  const usageStore = new UsageCheckpoint({ opsDataDir: dir, isWritable: () => journal.writable });
  const usage = new UsageBudget({
    store: usageStore,
    projectAlias: 'e13-lifecycle-project',
    officialBudgetMaxAgeMs: 60_000,
    now: () => EPOCH + 100,
    canIssue: () => ({ allowed: true }),
  });
  const retry = new CheckpointStore<readonly RetryIntent[]>({
    opsDataDir: dir,
    fileName: 'retry-checkpoint.json',
    validate: validateRetryCheckpoint,
    isWritable: () => journal.writable,
  });
  const cleanupStore = new CheckpointStore<number>({
    opsDataDir: dir,
    fileName: 'cleanup-lifecycle-checkpoint.json',
    validate: (value) => {
      if (!Number.isSafeInteger(value)) throw new Error('INVALID_TEST_CHECKPOINT');
      return value as number;
    },
    isWritable: () => journal.writable,
  });
  closers.push(async () => {
    await Promise.all([usage.close(), retry.close(), cleanupStore.close()]);
    await journal.close();
  });
  return { journal, usageStore, usage, retry, cleanupStore };
}

function boot(
  stores: ReturnType<typeof resources>,
  options: Partial<RecoveryBootstrapOptions> = {},
) {
  const cleanup = vi.fn(async (_input: RecoveryCleanupInput) => report);
  const bootstrap = createRecoveryBootstrap({
    namespace: 'e13-lifecycle',
    journal: stores.journal,
    usageBudget: stores.usage,
    retryCheckpoint: stores.retry,
    nowEpochMs: () => EPOCH + 100,
    monotonicNow: () => 0,
    officialBudgetMaxAgeMs: 60_000,
    beginCleanup: cleanup,
    closeCleanup: () => stores.cleanupStore.close(),
    ...options,
  });
  // Explicit close failures are asserted by the test; cleanup still releases test resources.
  closers.push(() => bootstrap.close().catch(() => {}));
  return { bootstrap, cleanup };
}

async function seed() {
  const dir = await directory();
  const stores = resources(dir);
  await stores.journal.restore();
  await stores.usage.restore({ allowInitializeMissing: true });
  expect(
    await stores.usage.reconcileOfficial(official(1), { periodId: '2026-09', version: 1 }),
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
  await stores.journal.append(record);
  await Promise.all([stores.usage.close(), stores.retry.close(), stores.cleanupStore.close()]);
  await stores.journal.close();
  return {
    dir,
    journalPath: stores.journal.filePath,
    usagePath: stores.usageStore.filePath,
    retryPath: stores.retry.filePath,
  };
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
      !path.basename(resolved).startsWith('kkakkung-e13-lifecycle-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

describe('E-13 bootstrap cleanup eligibility with real local storage', () => {
  it.each([false, true])(
    'missing journal cleanup requires explicit opt-in (%s) and never repairs history',
    async (enabled) => {
      const { dir, journalPath } = await seed();
      await fs.unlink(journalPath);
      const stores = resources(dir);
      const { bootstrap, cleanup } = boot(stores, { allowIncompleteHistoryCleanup: enabled });
      expect(await bootstrap.initialize()).toMatchObject({
        status: 'initialized',
        readiness: {
          state: 'LOCKED',
          historyComplete: false,
        },
      });
      const completed = await bootstrap.completion();
      if (enabled) {
        expect(cleanup).toHaveBeenCalledOnce();
        const input = cleanup.mock.calls[0]![0];
        expect(input.historyComplete).toBe(false);
        expect(input.beforeDispatch()).toBe(true);
        expect(completed?.historyComplete).toBe(false);
      } else {
        expect(cleanup).not.toHaveBeenCalled();
        expect(completed).toBe(null);
      }
      expect(bootstrap.getReadiness()).toMatchObject({ state: 'LOCKED', historyComplete: false });
      expect(bootstrap.getAdmission()).toBe('DRAINING');
      expect(stores.usage.snapshot().activeMinutes).toBe(30);
    },
  );

  it('can revoke recorded identities with missing usage while preserving the budget lock', async () => {
    const { dir, usagePath } = await seed();
    await fs.unlink(usagePath);
    const stores = resources(dir);
    const { bootstrap, cleanup } = boot(stores, { allowIncompleteHistoryCleanup: true });
    await bootstrap.initialize();
    expect((await bootstrap.completion())?.historyComplete).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup.mock.calls[0]![0].pendingRecords[0]?.record.identity).toBe(record.identity);
    expect(cleanup.mock.calls[0]![0].beforeDispatch()).toBe(true);
    expect(bootstrap.getReadiness()).toMatchObject({ state: 'LOCKED', historyComplete: false });
    expect(bootstrap.getReadiness().reasonCodes).toContain('USAGE_HISTORY_MISSING');
    expect(stores.usage.snapshot().integrity).toBe('missing');
  });

  it('marks a reservation mismatch as incomplete even if both files have valid checksums', async () => {
    const { dir } = await seed();
    const altered = resources(dir);
    await altered.journal.restore();
    await altered.journal.append({
      ...record,
      identity: 'unknown-reservation-identity',
      reservationId: 'unknown-lease',
    });
    await altered.journal.close();
    const stores = resources(dir);
    const { bootstrap, cleanup } = boot(stores, { allowIncompleteHistoryCleanup: true });
    await bootstrap.initialize();
    await bootstrap.completion();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup.mock.calls[0]![0].historyComplete).toBe(false);
    expect(bootstrap.getReadiness()).toMatchObject({ state: 'LOCKED', historyComplete: false });
    expect(bootstrap.getReadiness().reasonCodes).toContain('RESERVATION_HISTORY_MISMATCH');
  });

  it.each(['journal', 'usage', 'retry'] as const)(
    'does not permit cleanup of corrupt %s evidence despite opt-in',
    async (kind) => {
      const seeded = await seed();
      const target =
        kind === 'journal'
          ? seeded.journalPath
          : kind === 'usage'
            ? seeded.usagePath
            : seeded.retryPath;
      await fs.writeFile(target, '{"invalid":');
      const original = await fs.readFile(target);
      const stores = resources(seeded.dir);
      const { bootstrap, cleanup } = boot(stores, { allowIncompleteHistoryCleanup: true });
      await bootstrap.initialize();
      await bootstrap.completion();
      expect(cleanup).not.toHaveBeenCalled();
      expect(bootstrap.getReadiness().state).toBe('LOCKED');
      expect(await fs.readFile(target)).toEqual(original);
    },
  );

  it('does not start cleanup when the journal writer is already owned', async () => {
    const { dir } = await seed();
    const owner = resources(dir);
    expect((await owner.journal.restore()).writable).toBe(true);
    const rival = resources(dir);
    const { bootstrap, cleanup } = boot(rival, { allowIncompleteHistoryCleanup: true });
    expect(await bootstrap.initialize()).toEqual({ status: 'fatal', code: 'WRITER_CONFLICT' });
    await bootstrap.completion();
    expect(cleanup).not.toHaveBeenCalled();
    expect(owner.journal.writable).toBe(true);
  });

  it('rechecks usage storage after a cleanup queue wait', async () => {
    const { dir, journalPath } = await seed();
    await fs.unlink(journalPath);
    const stores = resources(dir);
    const gate = deferred<CleanupReport>();
    gates.push(() => gate.resolve(report));
    const cleanup = vi.fn((_input: RecoveryCleanupInput) => gate.promise);
    const { bootstrap } = boot(stores, {
      allowIncompleteHistoryCleanup: true,
      beginCleanup: cleanup,
    });
    await bootstrap.initialize();
    const input = cleanup.mock.calls[0]![0];
    expect(input.beforeDispatch()).toBe(true);
    await stores.usage.close();
    expect(input.beforeDispatch()).toBe(false);
    gate.resolve(report);
    await bootstrap.completion();
    expect(bootstrap.getReadiness().state).toBe('LOCKED');
  });
});

describe('E-13 cleanup checkpoint closes before the shared journal writer is released', () => {
  it('drains accepted cleanup renames and prevents stale writes over the next writer', async () => {
    const { dir } = await seed();
    const stores = resources(dir);
    let cleanupInput: RecoveryCleanupInput | undefined;
    const { bootstrap } = boot(stores, {
      beginCleanup: async (input) => {
        cleanupInput = input;
        return report;
      },
      closeCleanup: () => {
        expect(cleanupInput?.signal.aborted).toBe(true);
        expect(cleanupInput?.beforeDispatch()).toBe(false);
        return stores.cleanupStore.close();
      },
    });
    await bootstrap.initialize();
    await bootstrap.completion();
    const gate = holdRename(stores.cleanupStore.filePath);
    const first = stores.cleanupStore.write({ lastSeq: 1, state: 1 });
    await gate.entered;
    const queued = stores.cleanupStore.write({ lastSeq: 2, state: 2 });
    const closing = bootstrap.close();
    expect(bootstrap.close()).toBe(closing);
    expect(stores.cleanupStore.writable).toBe(false);
    await expect(stores.cleanupStore.write({ lastSeq: 99, state: 99 })).rejects.toThrow(
      'CHECKPOINT_NOT_WRITABLE',
    );
    const rival = resources(dir);
    expect(await rival.journal.restore()).toMatchObject({
      reason: 'WRITER_CONFLICT',
      writable: false,
    });
    expect(stores.journal.writable).toBe(true);
    gate.release();
    await Promise.all([first, queued, closing]);
    const next = resources(dir);
    expect((await next.journal.restore()).writable).toBe(true);
    expect(await next.cleanupStore.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: { lastSeq: 2, state: 2 },
    });
    await next.cleanupStore.write({ lastSeq: 3, state: 3 });
    const disk = await next.cleanupStore.read();
    await expect(stores.cleanupStore.write({ lastSeq: 100, state: 100 })).rejects.toThrow(
      'CHECKPOINT_NOT_WRITABLE',
    );
    expect(await next.cleanupStore.read()).toEqual(disk);
  });

  it.each(['throw', 'reject'] as const)(
    'drains other checkpoint writes and releases the lease even if cleanup close %ss',
    async (failure) => {
      const { dir } = await seed();
      const stores = resources(dir);
      const expected = new Error('CLEANUP_CLOSE_FAILURE');
      const cleanupClose = vi.fn(() => {
        if (failure === 'throw') throw expected;
        return Promise.reject(expected);
      });
      const { bootstrap } = boot(stores, { closeCleanup: cleanupClose });
      await bootstrap.initialize();
      await bootstrap.completion();
      const gate = holdRename(stores.usageStore.filePath);
      const writing = stores.usage.reconcileOfficial(official(2), {
        periodId: '2026-09',
        version: 2,
      });
      await gate.entered;
      const closing = bootstrap.close();
      const rejected = expect(closing).rejects.toBe(expected);
      expect(cleanupClose).toHaveBeenCalledOnce();
      expect(stores.retry.writable).toBe(false);
      expect(stores.usage.snapshot().writable).toBe(false);
      const rival = resources(dir);
      expect(await rival.journal.restore()).toMatchObject({
        reason: 'WRITER_CONFLICT',
        writable: false,
      });
      expect(stores.journal.writable).toBe(true);
      gate.release();
      expect(await writing).toEqual({ status: 'applied' });
      await rejected;
      const next = resources(dir);
      expect((await next.journal.restore()).writable).toBe(true);
      expect((await next.usage.restore()).official?.version).toBe(2);
      expect(bootstrap.close()).toBe(closing);
      expect(cleanupClose).toHaveBeenCalledOnce();
    },
  );
});

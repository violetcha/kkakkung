import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveKitGateway, type GatewayClient } from '../../src/media/LiveKitGateway.js';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import { DurableRetention } from '../../src/operations/DurableRetention.js';
import { planDurableRetention, RETENTION_MS } from '../../src/operations/DurableRetentionPlan.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import {
  RecoveryCleanupBindings,
  validateCleanupCheckpoint,
} from '../../src/operations/RecoveryCleanupBindings.js';
import { reconcileRecoveryRecords } from '../../src/operations/RecoveryRecords.js';
import { RevocationRetryBindings } from '../../src/operations/RevocationRetryBindings.js';
import type { RetryIntent } from '../../src/operations/RevocationRetries.js';
import { SharedRetryCheckpoint } from '../../src/operations/SharedRetryCheckpoint.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint, type UsageReservation } from '../../src/operations/UsageCheckpoint.js';
import { createUsageReservationId } from '../../src/operations/UsageReservationId.js';
import { deferred, localCapability } from '../media/generation-fixtures.js';

const EPOCH = 1_800_000_000_000;
const closers: (() => Promise<void>)[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
  for (const dir of directories.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('kkakkung-durable-retention-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function fixture(count = 2, lateRelease = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-durable-retention-'));
  directories.push(dir);
  let now = EPOCH + RETENTION_MS + 3000;
  let ownership = true;
  let canStart = true;
  const journal = new OperationJournal({ opsDataDir: dir });
  await journal.restore();
  const store = new UsageCheckpoint({
    opsDataDir: dir,
    providerQuota: true,
    isWritable: () => journal.writable,
  });
  const reservations: UsageReservation[] = [];
  const intents: RetryIntent[] = [];
  const roots: string[] = [];
  const serverEpoch = randomUUID();
  for (let i = 0; i < count; i++) {
    const root = createUsageReservationId(EPOCH);
    roots.push(root);
    for (const id of [root, `${root}:1`])
      reservations.push({
        request: {
          reservationId: id,
          matchId: `match-${i}`,
          purpose: 'public',
          slots: 6,
          expectedMinutes: 5,
          expectedBytes: 1000,
          margin: 0,
        },
        minutes: 30,
        bytes: 1000,
        status: 'RELEASED',
        createdAtEpochMs: EPOCH,
        retiringAtEpochMs: EPOCH + 1000,
        retiringAfterVersion: 1,
        retiringPeriodId: 'provider-quota',
        remoteConfirmedAtEpochMs: EPOCH + 3000,
        releasedAtEpochMs: EPOCH + 3000,
      });
    const intent: RetryIntent = {
      retirementId: randomUUID(),
      reservationId: root,
      identity: randomUUID(),
      generation: 1,
      firstRetireEpochMs: EPOCH + 1000,
      lastAttemptEpochMs: EPOCH + 3000,
      nextAttemptEpochMs: null,
      attempt: 1,
      status: 'REVOKED',
      alarmed: false,
      providerWaitUnknown: false,
    };
    intents.push(intent);
    await journal.append({
      state: 'REVOKED',
      namespace: 'e-fixture',
      matchId: `match-${i}`,
      mediaInstanceId: 'game',
      serverEpoch,
      roomName: `e-fixture--${serverEpoch}--${randomUUID()}`,
      identity: intent.identity,
      generation: 1,
      reservationId: root,
      issuedAtEpochMs: EPOCH,
      expiresAtEpochMs: EPOCH + 60_000,
      atEpochMs: EPOCH + 3000,
      retirementId: intent.retirementId,
      attempt: 1,
      firstRetireAtEpochMs: EPOCH + 1000,
    });
  }
  if (lateRelease) {
    for (let index = reservations.length - 2; index < reservations.length; index++)
      reservations[index] = {
        ...reservations[index]!,
        status: 'ACTIVE',
        retiringAtEpochMs: null,
        retiringAfterVersion: null,
        retiringPeriodId: null,
        remoteConfirmedAtEpochMs: null,
        releasedAtEpochMs: null,
      };
  }
  await store.write({ lastSeq: 1, state: { official: null, reservations } });
  const usage = new UsageBudget({
    store,
    projectAlias: 'local-fixture',
    officialBudgetMaxAgeMs: 60_000,
    providerQuota: true,
    now: () => now,
    canIssue: () => ({ allowed: true }),
  });
  await usage.restore();
  const shared = new SharedRetryCheckpoint({
    opsDataDir: dir,
    isWritable: () => journal.writable,
    isRetiredReservation: (root) => usage.isRetiredReservation(root),
  });
  await shared.write({ lastSeq: journal.snapshot().lastSeq, state: intents });
  const cleanupCheckpoint = new CheckpointStore({
    opsDataDir: dir,
    fileName: 'cleanup-checkpoint.json',
    validate: validateCleanupCheckpoint,
    isWritable: () => journal.writable,
  });
  const api = new ApiBudget({
    monotonicNow: () => now - EPOCH,
    maxNormalCallsPer60s: 600,
    maxTotalCallsPer60s: 900,
  });
  const listRooms = vi.fn(async () => []);
  const listParticipants = vi.fn(async () => []);
  const unavailable = async () => {
    throw new Error('UNEXPECTED_CLOUD_MUTATION');
  };
  const gateway = new LiveKitGateway(
    { httpUrl: 'https://fixture.invalid', apiKey: 'fixture', apiSecret: 'fixture' },
    api,
    {
      monotonicNow: () => now - EPOCH,
      clientFactory: () =>
        ({
          listRooms,
          listParticipants,
          deleteRoom: async () => {},
          removeParticipant: unavailable,
          createRoom: unavailable,
          getParticipant: unavailable,
          updateParticipant: unavailable,
          updateSubscriptions: unavailable,
        }) as GatewayClient,
    },
  );
  const failure = vi.fn();
  const recovery = new RecoveryCleanupBindings({
    namespace: 'e-fixture',
    projectAlias: 'local-fixture',
    namespaceOwnershipConfirmed: () => ownership,
    journal,
    retryCheckpoint: shared,
    cleanupCheckpoint,
    usageBudget: usage,
    gateway,
    capability: () => localCapability,
    epochNowMs: () => now,
    monotonicNow: () => now - EPOCH,
    onUnresolved: failure,
  });
  const current = new RevocationRetryBindings({
    namespace: 'e-fixture',
    journal,
    checkpoint: shared,
    initialCheckpoint: { lastSeq: 0, state: [] },
    usageBudget: usage,
    gateway,
    generations: () => [],
    capability: () => localCapability,
    monotonicNow: () => now - EPOCH,
    epochNowMs: () => now,
    stopPermissions: () => {},
    onOccupancyEnded: async () => {},
    lockIssuance: failure,
    onUnresolved: failure,
  });
  const snapshot = journal.snapshot();
  const reconciled = reconcileRecoveryRecords({
    namespace: 'e-fixture',
    journal: {
      ...snapshot,
      integrity: 'ok',
      unresolved: false,
    },
    usage: usage.snapshot(),
    retryCheckpoint: await shared.read(),
    epochNowMs: now,
    monotonicNow: now - EPOCH,
  });
  expect(reconciled.reasonCodes).toEqual([]);
  const report = await recovery.run({
    ...reconciled,
    reservations: usage.snapshot().reservations,
    historyComplete: true,
    singleWriter: true,
    serverEpoch: randomUUID(),
    signal: new AbortController().signal,
    beforeDispatch: () => ownership && journal.writable,
  });
  expect(report).toMatchObject({ historyComplete: true, unresolved: 0, ownedRoomsRemaining: 0 });
  const retention = new DurableRetention({
    journal,
    usageBudget: usage,
    retryCheckpoint: shared,
    owners: [current, recovery],
    now: () => now,
    monotonicNow: () => now - EPOCH,
    canStart: () => canStart,
    ownershipConfirmed: () => ownership,
    onFailure: failure,
  });
  const close = async () => {
    await retention.close().catch(() => {});
    await current.close();
    await recovery.close();
    await usage.close();
    await shared.close();
    await journal.close();
    api.close();
  };
  closers.push(close);
  return {
    dir,
    journal,
    store,
    usage,
    shared,
    recovery,
    current,
    retention,
    roots,
    intents,
    failure,
    close,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    setOwnership: (value: boolean) => {
      ownership = value;
    },
    setCanStart: (value: boolean) => {
      canStart = value;
    },
    listRooms,
    listParticipants,
  };
}

async function reopen(f: Awaited<ReturnType<typeof fixture>>) {
  await f.close();
  const journal = new OperationJournal({ opsDataDir: f.dir });
  const restored = await journal.restore();
  const store = new UsageCheckpoint({ opsDataDir: f.dir, providerQuota: true });
  const usage = new UsageBudget({
    store,
    projectAlias: 'local-fixture',
    providerQuota: true,
    officialBudgetMaxAgeMs: 60_000,
    now: f.now,
    canIssue: () => ({ allowed: true }),
  });
  const saved = await usage.restore();
  const shared = new SharedRetryCheckpoint({
    opsDataDir: f.dir,
    isWritable: () => journal.writable,
    isRetiredReservation: (root) => usage.isRetiredReservation(root),
  });
  const retry = await shared.read();
  const result = reconcileRecoveryRecords({
    namespace: 'e-fixture',
    journal: restored,
    usage: saved,
    retryCheckpoint: retry,
    epochNowMs: f.now(),
    monotonicNow: 0,
  });
  await shared.close();
  await usage.close();
  await journal.close();
  return { saved, retry, result, restored };
}

describe('automatic durable retirement compaction with real journal and both retry owners', () => {
  it('keeps a lease newly confirmed by recovery while compacting older released groups', async () => {
    const f = await fixture(2, true);
    expect(await f.retention.run()).toMatchObject({
      roots: 1,
      records: 1,
      retries: 1,
      reservations: 2,
    });
    expect(f.usage.snapshot().reservations.map((r) => r.request.reservationId)).toEqual([
      f.roots[1],
      `${f.roots[1]}:1`,
    ]);
    expect(f.recovery.retries.snapshot()).toHaveLength(1);
    expect((await reopen(f)).result.reasonCodes).toEqual([]);
  });
  it('compacts only after 24h, preserves totals, clears both snapshots and reopens with a durable boundary', async () => {
    const f = await fixture();
    const totals = f.usage.snapshot();
    f.advance(-1);
    expect((await f.retention.run()).status).toBe('skipped');
    expect(f.journal.snapshot().records).toHaveLength(2);
    f.advance(60_001);
    expect(await f.retention.run()).toEqual({
      status: 'compacted',
      roots: 2,
      records: 2,
      retries: 2,
      reservations: 4,
    });
    expect(f.recovery.retries.snapshot()).toHaveLength(0);
    expect(f.current.retries.snapshot()).toHaveLength(0);
    expect(f.usage.snapshot()).toMatchObject({
      reservations: [],
      localEstimatedMinutes: totals.localEstimatedMinutes,
      localEstimatedBytes: totals.localEstimatedBytes,
      activeMinutes: 0,
      compacted: { reservationCount: 4 },
    });
    expect((await f.recovery.reconcile()).unresolved).toBe(0);
    expect(f.failure).not.toHaveBeenCalled();
    const reopened = await reopen(f);
    expect(reopened.result.reasonCodes).toEqual([]);
    expect(reopened.restored).toMatchObject({ lastSeq: 2, integrity: 'ok', records: [] });
    expect(reopened.saved.compacted?.reservationCount).toBe(4);
  });

  it('limits one pass to 256 roots and resumes the remainder after the next minute', async () => {
    const f = await fixture(257);
    expect(await f.retention.run()).toMatchObject({ roots: 256, records: 256, reservations: 512 });
    expect(f.usage.snapshot().reservations).toHaveLength(2);
    expect((await f.retention.run()).status).toBe('skipped');
    f.advance(60_000);
    expect(await f.retention.run()).toMatchObject({ roots: 1, reservations: 2 });
    expect((await reopen(f)).result.reasonCodes).toEqual([]);
  }, 60_000);

  it.each(['journal', 'retry', 'usage'] as const)(
    'reopens a crash after the %s boundary with the remaining compaction evidence intact',
    async (boundary) => {
      const f = await fixture();
      const snapshots = {
        journal: f.journal.compact.bind(f.journal),
        retry: f.shared.compactConfirmed.bind(f.shared),
        usage: f.usage.compactReleased.bind(f.usage),
      };
      const interrupt = () => {
        throw new Error('SIMULATED_PROCESS_LOSS_AFTER_DURABLE_WRITE');
      };
      if (boundary === 'journal')
        vi.spyOn(f.journal, 'compact').mockImplementation(async (...args) => {
          await snapshots.journal(...args);
          return interrupt();
        });
      if (boundary === 'retry')
        vi.spyOn(f.shared, 'compactConfirmed').mockImplementation(async (...args) => {
          await snapshots.retry(...args);
          return interrupt();
        });
      if (boundary === 'usage')
        vi.spyOn(f.usage, 'compactReleased').mockImplementation(async (...args) => {
          await snapshots.usage(...args);
          return interrupt();
        });
      await expect(f.retention.run()).rejects.toThrow('SIMULATED_PROCESS_LOSS');
      expect(f.failure).toHaveBeenCalledOnce();
      vi.restoreAllMocks();
      const reopened = await reopen(f);
      expect(reopened.result.reasonCodes).toEqual([]);
      expect(reopened.saved.localEstimatedMinutes).toBe(120);
      expect(reopened.saved.reservations).toHaveLength(boundary === 'usage' ? 0 : 4);
      expect(reopened.result.pendingRecords).toHaveLength(0);
    },
  );

  it('shares a delayed pass and rejects ownership loss before pruning retry or usage', async () => {
    const f = await fixture();
    const writing = deferred<void>();
    const release = deferred<void>();
    const compact = f.journal.compact.bind(f.journal);
    vi.spyOn(f.journal, 'compact').mockImplementation(async (...args) => {
      const result = await compact(...args);
      writing.resolve();
      await release.promise;
      return result;
    });
    const first = f.retention.run();
    expect(f.retention.run()).toBe(first);
    await writing.promise;
    f.setOwnership(false);
    release.resolve();
    await expect(first).rejects.toThrow('RETENTION_OWNERSHIP_LOST');
    expect(f.usage.snapshot().reservations).toHaveLength(4);
    expect(f.shared.snapshot().intents).toHaveLength(2);
    vi.restoreAllMocks();
    expect((await reopen(f)).result.reasonCodes).toEqual([]);
  });

  it.each(['revocation-checkpoint.json', 'usage-checkpoint.json'])(
    'preserves the prior durable file on %s rename failure',
    async (fileName) => {
      const f = await fixture();
      const rename = fs.rename.bind(fs);
      vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
        if (String(target) === path.join(f.dir, fileName))
          throw Object.assign(new Error('SIMULATED_DISK_FAILURE'), { code: 'EIO' });
        return rename(source, target);
      });
      await expect(f.retention.run()).rejects.toThrow();
      expect(f.failure).toHaveBeenCalled();
      vi.restoreAllMocks();
      const reopened = await reopen(f);
      expect(reopened.result.reasonCodes).toEqual([]);
      expect(reopened.saved.reservations).toHaveLength(4);
      expect(reopened.saved.localEstimatedBytes).toBe(4000);
      expect(
        planDurableRetention({
          reservations: reopened.saved.reservations,
          records: reopened.result.records,
          intents: reopened.result.retryIntents,
          now: f.now(),
        }).size,
      ).toBe(2);
    },
  );

  it('rejects a backwards wall clock and does not repeat a failed maintenance pass', async () => {
    const f = await fixture();
    const read = f.shared.read.bind(f.shared);
    vi.spyOn(f.shared, 'read').mockImplementation(async () => {
      const value = await read();
      f.advance(-1);
      return value;
    });
    await expect(f.retention.run()).rejects.toThrow('RETENTION_OWNERSHIP_LOST');
    expect((await f.retention.run()).status).toBe('skipped');
    expect(f.journal.snapshot().records).toHaveLength(2);
    expect(f.usage.snapshot().reservations).toHaveLength(4);
  });

  it('defers while games are active and rejects a stale full snapshot after compaction', async () => {
    const f = await fixture();
    f.setCanStart(false);
    expect((await f.retention.run()).status).toBe('skipped');
    f.setCanStart(true);
    await f.retention.run();
    await expect(f.shared.write({ lastSeq: 2, state: f.intents })).rejects.toThrow(
      'RETRY_RESERVATION_COMPACTED',
    );
    const file = JSON.parse(
      await fs.readFile(path.join(f.dir, 'revocation-checkpoint.json'), 'utf8'),
    );
    expect(file.state).toEqual([]);
  });

  it('does not select a changed scope, unexpired token, pending retry, or unreconciled slice', async () => {
    const f = await fixture();
    const records = f.journal.snapshot().records;
    const reservations = f.usage.snapshot().reservations;
    const select = (patch: Partial<Parameters<typeof planDurableRetention>[0]>) =>
      planDurableRetention({
        records,
        reservations,
        intents: f.intents,
        now: f.now(),
        ...patch,
      });
    expect(
      select({
        records: records.map((entry) => ({
          ...entry,
          record: { ...entry.record, expiresAtEpochMs: f.now() + 1 },
        })),
      }).size,
    ).toBe(0);
    expect(
      select({ intents: f.intents.map((intent) => ({ ...intent, status: 'UNRESOLVED' })) }).size,
    ).toBe(0);
    expect(
      select({ reservations: reservations.map((r) => ({ ...r, status: 'AWAITING_OFFICIAL' })) })
        .size,
    ).toBe(0);
    expect(
      select({
        records: records.map((entry) => ({
          ...entry,
          record: { ...entry.record, matchId: 'foreign' },
        })),
      }).size,
    ).toBe(0);
    expect(select({ now: EPOCH }).size).toBe(0);
  });
});

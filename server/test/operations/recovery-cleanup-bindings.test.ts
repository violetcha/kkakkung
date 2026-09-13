import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityReport } from '../../src/media/CloudCapabilityProbe.js';
import { LiveKitGateway, type GatewayClient } from '../../src/media/LiveKitGateway.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import {
  OperationJournal,
  type JournalEntry,
  type JournalRecord,
} from '../../src/operations/OperationJournal.js';
import { createRecoveryBootstrap } from '../../src/operations/RecoveryBootstrap.js';
import { OperationsAudit } from '../../src/operations/OperationsAudit.js';
import { OperationsBindings } from '../../src/operations/OperationsBindings.js';
import { OperationsController } from '../../src/operations/OperationsController.js';
import {
  RecoveryCleanupBindings,
  validateCleanupCheckpoint,
  type CleanupCheckpointState,
} from '../../src/operations/RecoveryCleanupBindings.js';
import type { CleanupReport } from '../../src/operations/RecoveryState.js';
import type { RetryIntent } from '../../src/operations/RevocationRetries.js';
import { validateRetryCheckpoint } from '../../src/operations/RevocationRetryBindings.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint } from '../../src/operations/UsageCheckpoint.js';
import {
  deferred,
  localCapability,
  localConfiguration,
  practiceFrame,
  prepareRequest,
} from '../media/generation-fixtures.js';

const EPOCH = 1_800_000_000_000;
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const releases: (() => void)[] = [];

function resources(dir: string, clock: { ms: number }, providerQuota = false) {
  const journal = new OperationJournal({ opsDataDir: dir });
  const usageStore = new UsageCheckpoint({ opsDataDir: dir, isWritable: () => journal.writable });
  const usage = new UsageBudget({
    store: usageStore,
    projectAlias: 'local-fixture',
    officialBudgetMaxAgeMs: 3_600_000,
    now: () => EPOCH + clock.ms,
    canIssue: () => ({ allowed: true }),
    providerQuota,
  });
  const retry = new CheckpointStore<readonly RetryIntent[]>({
    opsDataDir: dir,
    fileName: 'retry-checkpoint.json',
    validate: validateRetryCheckpoint,
    isWritable: () => journal.writable,
  });
  const cleanupCheckpoint = new CheckpointStore<CleanupCheckpointState>({
    opsDataDir: dir,
    fileName: 'cleanup-checkpoint.json',
    validate: validateCleanupCheckpoint,
    isWritable: () => journal.writable,
  });
  closers.push(async () => {
    await Promise.all([usage.close(), retry.close(), cleanupCheckpoint.close()]);
    await journal.close();
  });
  return { journal, usage, usageStore, retry, cleanupCheckpoint };
}

async function seed(
  state: 'PREPARED' | 'REVOKED' = 'PREPARED',
  historicalRooms = 1,
  released = false,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e13-bindings-'));
  directories.push(dir);
  const seedClock = { ms: 0 };
  const stores = resources(dir, seedClock);
  await stores.journal.restore();
  await stores.usage.restore({ allowInitializeMissing: true });
  expect(
    await stores.usage.reconcileOfficial(
      {
        projectAlias: 'local-fixture',
        remainingMinutes: 5000,
        remainingBytes: 10_000_000_000,
        checkedAtEpochMs: EPOCH,
        source: 'cloud-dashboard',
        checkedBy: 'local-fixture-operator',
      },
      { periodId: '2026-09', version: 1 },
    ),
  ).toEqual({ status: 'applied' });
  const registry = new MediaGenerationRegistry('e-fixture');
  registry.observe(practiceFrame);
  const generation = registry.allocate(prepareRequest, EPOCH);
  expect(
    (
      await stores.usage.reserve({
        reservationId: generation.reservationId,
        matchId: 'm',
        purpose: 'public',
        slots: 6,
        expectedMinutes: 5,
        expectedBytes: 1000,
        margin: 0,
      })
    ).status,
  ).toBe('reserved');
  const record: JournalRecord = {
    state,
    namespace: 'e-fixture',
    matchId: 'm',
    mediaInstanceId: 'practice',
    roomName: generation.roomName,
    serverEpoch: generation.serverEpoch,
    identity: generation.identity,
    generation: generation.generation,
    issuedAtEpochMs: generation.issuedAtEpochMs,
    expiresAtEpochMs: generation.expiresAtEpochMs,
    reservationId: generation.reservationId,
    atEpochMs: EPOCH,
  };
  await stores.journal.append(record);
  for (let index = 1; index < historicalRooms; index++) {
    await stores.journal.append({
      ...record,
      roomName: `e-fixture--${record.serverEpoch}--${randomUUID()}`,
      identity: randomUUID(),
    });
  }
  if (released) {
    expect(await stores.usage.markRetiring(generation.reservationId)).toBe(true);
    expect(await stores.usage.markRemoteConfirmed(generation.reservationId)).toBe(true);
    seedClock.ms++;
    expect(
      await stores.usage.reconcileOfficial(
        { ...stores.usage.snapshot().official!.checkpoint, checkedAtEpochMs: EPOCH + seedClock.ms },
        {
          periodId: '2026-09',
          version: 2,
        },
      ),
    ).toEqual({ status: 'applied' });
    expect(
      await stores.usage.releaseConfirmed(generation.reservationId, {
        remoteConfirmed: true,
        periodId: '2026-09',
        version: 2,
      }),
    ).toBe(true);
  }
  await Promise.all([stores.usage.close(), stores.retry.close(), stores.cleanupCheckpoint.close()]);
  await stores.journal.close();
  return { dir, record };
}

function fixture(
  seeded: Awaited<ReturnType<typeof seed>>,
  options: {
    capability?: CapabilityReport | null;
    ownership?: boolean;
    totalLimit?: number;
    normalLimit?: number;
    startMs?: number;
    firstInstallationConfirmed?: () => Promise<boolean>;
    providerQuota?: boolean;
  } = {},
) {
  const clock = { ms: options.startMs ?? 0 };
  const stores = resources(seeded.dir, clock, options.providerQuota);
  const timers = new Set<{ callback: () => void; at: number }>();
  const timing = {
    setTimer: (callback: () => void, delay: number) => {
      const timer = { callback, at: clock.ms + delay };
      timers.add(timer);
      return timer;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as { callback: () => void; at: number });
    },
  };
  const advance = (ms: number) => {
    clock.ms += ms;
    for (const timer of [...timers].sort((a, b) => a.at - b.at))
      if (timer.at <= clock.ms && timers.delete(timer)) timer.callback();
  };
  const api = new ApiBudget({
    monotonicNow: () => clock.ms,
    maxNormalCallsPer60s: options.normalLimit ?? 600,
    maxTotalCallsPer60s: options.totalLimit ?? 900,
    ...timing,
  });
  const rooms = new Map<string, Set<string>>([[seeded.record.roomName, new Set()]]);
  const listed = new Set<string>();
  const events: string[] = [];
  // Mock Cloud transport only. Registry, gateway, API budget, journals, bootstrap and bindings are real.
  const listRooms = vi.fn<GatewayClient['listRooms']>(async () => {
    events.push('listRooms');
    return [...listed].map((name) => ({ name })) as Awaited<ReturnType<GatewayClient['listRooms']>>;
  });
  const listParticipants = vi.fn<GatewayClient['listParticipants']>(async (room) => {
    events.push(`list:${room}`);
    return [...(rooms.get(room) ?? [])].map((identity) => ({ identity })) as Awaited<
      ReturnType<GatewayClient['listParticipants']>
    >;
  });
  const remove = vi.fn<GatewayClient['removeParticipant']>(async (room, identity) => {
    events.push(`remove:${identity}`);
    rooms.get(room)?.delete(identity);
  });
  const deleteRoom = vi.fn<GatewayClient['deleteRoom']>(async (room) => {
    events.push(`delete:${room}`);
    rooms.delete(room);
    listed.delete(room);
  });
  const gateway = new LiveKitGateway(
    {
      httpUrl: 'https://fixture.invalid',
      apiKey: 'local-fixture-key',
      apiSecret: 'local-fixture-secret',
    },
    api,
    {
      monotonicNow: () => clock.ms,
      clientFactory: () => {
        const unsupported = async () => {
          throw new Error('UNEXPECTED_TRANSPORT_METHOD');
        };
        return {
          listRooms,
          listParticipants,
          removeParticipant: remove,
          deleteRoom,
          createRoom: unsupported,
          getParticipant: unsupported,
          updateSubscriptions: unsupported,
          updateParticipant: unsupported,
        };
      },
    },
  );
  let capability: CapabilityReport | null = Object.hasOwn(options, 'capability')
    ? (options.capability ?? null)
    : localCapability;
  let ownership = options.ownership ?? true;
  const alarms = vi.fn();
  const reports = vi.fn<(report: CleanupReport) => void>();
  const bindings = new RecoveryCleanupBindings({
    namespace: 'e-fixture',
    projectAlias: 'local-fixture',
    namespaceOwnershipConfirmed: () => ownership,
    journal: stores.journal,
    retryCheckpoint: stores.retry,
    cleanupCheckpoint: stores.cleanupCheckpoint,
    usageBudget: stores.usage,
    gateway,
    capability: () => capability,
    epochNowMs: () => EPOCH + clock.ms,
    monotonicNow: () => clock.ms,
    onUnresolved: (code) => {
      alarms(code);
      if (code === 'JOURNAL_WRITE_FAILED') bootstrap.state.lock(code);
    },
    onReport: (report) => {
      reports(report);
      bootstrap.state.completeCleanup(report);
      bootstrap.refreshBudget();
    },
    ...timing,
  });
  const bootstrap = createRecoveryBootstrap({
    namespace: 'e-fixture',
    journal: stores.journal,
    usageBudget: stores.usage,
    retryCheckpoint: stores.retry,
    nowEpochMs: () => EPOCH + clock.ms,
    monotonicNow: () => clock.ms,
    officialBudgetMaxAgeMs: 3_600_000,
    providerQuota: options.providerQuota,
    beginCleanup: (input) => bindings.run(input),
    closeCleanup: () => bindings.close(),
    allowIncompleteHistoryCleanup: true,
    firstInstallationConfirmed: options.firstInstallationConfirmed,
  });
  closers.push(async () => {
    api.close();
    await bootstrap.close();
  });
  const records = async (): Promise<JournalEntry[]> =>
    (await fs.readFile(stores.journal.filePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as JournalEntry);
  const run = async () => {
    await bootstrap.initialize();
    return bootstrap.completion();
  };
  return {
    ...stores,
    ...seeded,
    providerQuota: options.providerQuota === true,
    bootstrap,
    bindings,
    api,
    gateway,
    listRooms,
    listParticipants,
    remove,
    deleteRoom,
    rooms,
    listed,
    events,
    alarms,
    reports,
    clock,
    advance,
    timers,
    run,
    records,
    setCapability: (next: CapabilityReport | null) => {
      capability = next;
    },
    setOwnership: (next: boolean) => {
      ownership = next;
    },
  };
}

function holdRename(filePath: string) {
  const entered = deferred<void>();
  const gate = deferred<void>();
  releases.push(() => gate.resolve());
  const original = fs.rename.bind(fs);
  let once = true;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    if (once && String(target) === filePath) {
      once = false;
      entered.resolve();
      await gate.promise;
    }
    await original(source, target);
  });
  return { entered: entered.promise, release: () => gate.resolve() };
}

async function operationsFor(s: ReturnType<typeof fixture>) {
  const activity = { activeMatches: 0, activePractices: 0, pendingAdmissions: 0 };
  s.clock.ms++;
  if (!s.providerQuota)
    await fs.writeFile(
      path.join(s.dir, 'official-usage-input.json'),
      JSON.stringify({
        ...s.usage.snapshot().official!.checkpoint,
        checkedAtEpochMs: EPOCH + s.clock.ms,
      }),
    );
  const operationsBindings = new OperationsBindings({
    config: {
      ...localConfiguration(EPOCH),
      ...(s.providerQuota
        ? {
            operatingMode: 'continuous' as const,
            publicWindow: { mode: 'continuous' as const },
          }
        : {}),
      opsDataDir: s.dir,
    },
    journal: s.journal,
    usageBudget: s.usage,
    getReadiness: () => s.bootstrap.getReadiness(),
    getGameActivity: () => activity,
    retries: [s.bindings.retries],
    recoveryCleanup: s.bindings,
    nowEpochMs: () => EPOCH + s.clock.ms,
    getOfficialRevision: () => ({ periodId: '2026-09', version: 2 }),
    refreshBudget: () => s.bootstrap.refreshBudget(),
  });
  const audit = new OperationsAudit({
    opsDataDir: s.dir,
    nowEpochMs: () => EPOCH + s.clock.ms,
    isWritable: () => s.journal.writable,
    allowMissingHistory: () => true,
  });
  const actionErrors: string[] = [];
  const controller = new OperationsController({
    nowEpochMs: () => EPOCH + s.clock.ms,
    monotonicNow: () => s.clock.ms,
    timeoutMs: 1000,
    timeoutForCommand: (command) => operationsBindings.recoveryCheckpointTimeout(command),
    setAdmission: (state) => operationsBindings.setAdmission(state),
    getStatus: () => operationsBindings.getStatus(),
    canResume: () => operationsBindings.canResume(),
    canComplete: (command) => operationsBindings.canComplete(command),
    run: async (command, signal, guard) => {
      try {
        await operationsBindings.run(command, signal, guard);
      } catch (error) {
        actionErrors.push(error instanceof Error ? error.message : 'UNKNOWN');
        throw error;
      }
    },
    auditStore: audit,
  });
  await controller.initializeAudit();
  closers.push(async () => {
    await controller.close();
    await operationsBindings.close();
  });
  const terminal = async (requestId: string) => {
    await vi.waitFor(() =>
      expect(['succeeded', 'failed']).toContain(controller.getSnapshot(requestId)?.status),
    );
    const snapshot = controller.getSnapshot(requestId)!;
    await vi.waitFor(() => expect(audit.get(requestId)?.snapshot).toEqual(snapshot));
    return snapshot;
  };
  return { activity, operationsBindings, controller, terminal, actionErrors };
}

it('keeps verified history after a transport-only room query failure until a full recheck succeeds', async () => {
  const s = fixture(await seed('REVOKED'));
  s.listRooms.mockRejectedValueOnce(new Error('temporary transport failure'));
  const first = await s.run();
  expect(first).toMatchObject({ historyComplete: true });
  expect(first?.unresolved).toBeGreaterThan(0);
  expect(s.bootstrap.getReadiness().state).toBe('LOCKED');
  expect(s.bindings.retries.snapshot()).toHaveLength(0);
  const report = await s.bindings.reconcile();
  expect(report).toMatchObject({ historyComplete: true, unresolved: 0, ownedRoomsRemaining: 0 });
  expect(s.bootstrap.getReadiness().state).toBe('READY');
  expect(s.remove).not.toHaveBeenCalled();
});

it.each([false, true])(
  'rechecks observations durably and requires separate resume (providerQuota=%s)',
  async (providerQuota) => {
    const s = fixture(await seed('REVOKED'), { providerQuota });
    s.listRooms.mockRejectedValueOnce(new Error('temporary transport failure'));
    await s.run();
    const o = await operationsFor(s);
    if (providerQuota)
      await expect(fs.access(path.join(s.dir, 'official-usage-input.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    expect(o.operationsBindings.getStatus()).toMatchObject({
      readiness: 'LOCKED',
      admission: 'DRAINING',
    });
    expect(s.bindings.canRetryObservation()).toBe(true);
    expect(
      o.operationsBindings.recoveryCheckpointTimeout({ requestId: 'r', action: 'resume' }),
    ).toBeUndefined();
    const submitted = o.controller.submit({ requestId: 'recheck', action: 'checkpoint' });
    expect(o.controller.submit({ requestId: 'recheck', action: 'checkpoint' })).toEqual(submitted);
    const result = await o.terminal('recheck');
    expect(o.actionErrors).toEqual([]);
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(s.listRooms).toHaveBeenCalledTimes(4);
    expect(o.operationsBindings.getStatus()).toMatchObject({
      readiness: 'READY',
      admission: 'DRAINING',
      unresolvedCount: 0,
    });
    expect(s.usage.snapshot().reservations[0]?.status).toBe('RELEASED');
    o.controller.submit({ requestId: 'resume-after-recheck', action: 'resume' });
    expect(await o.terminal('resume-after-recheck')).toMatchObject({ status: 'succeeded' });
    expect(o.operationsBindings.getStatus().admission).toBe('OPEN');
  },
);

it.each(['active-game', 'new-epoch', 'ownership-lost', 'malformed-history'] as const)(
  'refuses observation recheck for %s without another Cloud call',
  async (reason) => {
    const s = fixture(await seed('REVOKED'));
    if (reason === 'malformed-history')
      s.listRooms.mockResolvedValueOnce([{ name: null }] as unknown as Awaited<
        ReturnType<GatewayClient['listRooms']>
      >);
    else s.listRooms.mockRejectedValueOnce(new Error('temporary transport failure'));
    await s.run();
    const o = await operationsFor(s);
    if (reason === 'active-game') o.activity.activeMatches = 1;
    if (reason === 'ownership-lost') s.setOwnership(false);
    if (reason === 'new-epoch')
      await s.journal.append({
        ...s.record,
        serverEpoch: s.bootstrap.serverEpoch,
        roomName: `e-fixture--${s.bootstrap.serverEpoch}--${randomUUID()}`,
        identity: randomUUID(),
      });
    const before = s.listRooms.mock.calls.length;
    o.controller.submit({ requestId: 'unsafe-recheck', action: 'checkpoint' });
    expect(await o.terminal('unsafe-recheck')).toMatchObject({ status: 'failed' });
    expect(s.listRooms).toHaveBeenCalledTimes(before);
    expect(o.operationsBindings.getStatus().admission).not.toBe('OPEN');
  },
);

it('keeps a canceled observation sweep exclusive and rejects its late success', async () => {
  const s = fixture(await seed('REVOKED'));
  s.listRooms.mockRejectedValueOnce(new Error('temporary transport failure'));
  await s.run();
  const o = await operationsFor(s);
  const entered = deferred<void>();
  const gate = deferred<void>();
  releases.push(() => gate.resolve());
  s.listRooms.mockImplementationOnce(async () => {
    entered.resolve();
    await gate.promise;
    return [];
  });
  o.controller.submit({ requestId: 'timeout-recheck', action: 'checkpoint' });
  await entered.promise;
  expect(s.bindings.canRetryObservation()).toBe(false);
  await expect(s.bindings.retryObservation({ beforeDispatch: () => true })).rejects.toThrow(
    'NOT_RETRYABLE',
  );
  s.clock.ms += 10_001;
  expect(o.controller.getSnapshot('timeout-recheck')?.status).toBe('pending');
  s.clock.ms += 170_000;
  expect(await o.terminal('timeout-recheck')).toMatchObject({
    status: 'failed',
    code: 'OPERATION_TIMEOUT',
  });
  const before = s.deleteRoom.mock.calls.length;
  gate.resolve();
  await vi.waitFor(() => expect(s.bindings.canRetryObservation()).toBe(true));
  expect(s.deleteRoom).toHaveBeenCalledTimes(before);
  expect(s.listRooms).toHaveBeenCalledTimes(3);
  expect(o.operationsBindings.getStatus()).toMatchObject({
    readiness: 'LOCKED',
    admission: 'DRAINING',
  });
  expect(s.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
});

it('keeps malformed room observations untrusted on later successful queries', async () => {
  const s = fixture(await seed('REVOKED'));
  s.listRooms.mockResolvedValueOnce([{ name: null }] as unknown as Awaited<
    ReturnType<GatewayClient['listRooms']>
  >);
  expect(await s.run()).toMatchObject({ historyComplete: false });
  expect(await s.bindings.reconcile()).toMatchObject({ historyComplete: false });
  expect(s.bootstrap.getReadiness().state).toBe('LOCKED');
});

it.each(['new-generation', 'active-game', 'ownership-lost'] as const)(
  'rejects a delayed successful observation after %s without releasing usage',
  async (reason) => {
    const s = fixture(await seed('REVOKED'));
    s.listRooms.mockRejectedValueOnce(new Error('temporary transport failure'));
    await s.run();
    const o = await operationsFor(s);
    const entered = deferred<void>();
    const gate = deferred<void>();
    releases.push(() => gate.resolve());
    s.listRooms.mockImplementationOnce(async () => {
      entered.resolve();
      await gate.promise;
      return [];
    });
    o.controller.submit({ requestId: 'stale-observation', action: 'checkpoint' });
    await entered.promise;
    if (reason === 'new-generation')
      await s.journal.append({
        ...s.record,
        serverEpoch: s.bootstrap.serverEpoch,
        roomName: `e-fixture--${s.bootstrap.serverEpoch}--${randomUUID()}`,
        identity: randomUUID(),
      });
    if (reason === 'active-game') o.activity.activeMatches = 1;
    if (reason === 'ownership-lost') s.setOwnership(false);
    const before = s.deleteRoom.mock.calls.length;
    gate.resolve();
    expect(await o.terminal('stale-observation')).toMatchObject({ status: 'failed' });
    expect(s.deleteRoom).toHaveBeenCalledTimes(before);
    expect(s.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(o.operationsBindings.getStatus().admission).not.toBe('OPEN');
  },
);

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const close of closers.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('kkakkung-e13-bindings-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

describe('E-13 real local composition with mock Cloud transport; no Cloud evidence', () => {
  it('cleans observed participants after real journal loss while preserving surviving usage and a history lock', async () => {
    const s = fixture(await seed());
    await fs.unlink(s.journal.filePath);
    s.rooms.get(s.record.roomName)!.add(s.record.identity);
    s.listed.add(s.record.roomName);
    expect(await s.run()).toMatchObject({
      recordedIdentities: 0,
      revoked: 1,
      unresolved: 0,
      ownedRoomsRemaining: 0,
      historyComplete: false,
    });
    expect(s.remove).toHaveBeenCalledWith(s.record.roomName, s.record.identity, {
      revokeTokenTs: 1_800_000_002n,
    });
    expect(await s.cleanupCheckpoint.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: {
        state: {
          historyComplete: false,
          observedTargets: [{ roomName: s.record.roomName, identity: s.record.identity }],
        },
      },
    });
    expect(s.bootstrap.getReadiness()).toMatchObject({ state: 'LOCKED', historyComplete: false });
    expect(s.bootstrap.getReadiness().reasonCodes).toContain('JOURNAL_HISTORY_MISSING');
    expect(s.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(s.usage.snapshot().activeMinutes).toBe(30);
    expect(s.bootstrap.getAdmission()).toBe('DRAINING');
  });

  it('queries Cloud on externally proven first installation but stays locked without official budget', async () => {
    const { record } = await seed();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e13-bindings-'));
    directories.push(dir);
    expect(await fs.readdir(dir)).toEqual([]);
    const confirmation = vi.fn(async () => true);
    const s = fixture({ dir, record }, { firstInstallationConfirmed: confirmation });
    s.rooms.clear();
    expect(await s.run()).toMatchObject({
      recordedIdentities: 0,
      observedParticipants: 0,
      unresolved: 0,
      ownedRoomsRemaining: 0,
      historyComplete: true,
    });
    expect(confirmation).toHaveBeenCalledOnce();
    expect(s.listRooms).toHaveBeenCalledTimes(2);
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.api.getSnapshot().total60s).toBe(2);
    expect(s.bootstrap.getReadiness()).toMatchObject({ state: 'LOCKED', historyComplete: true });
    expect(s.bootstrap.getReadiness().reasonCodes).toContain('BUDGET_UNCONFIRMED');
    expect(s.usage.snapshot().official).toBe(null);
    expect(s.bootstrap.getAdmission()).toBe('DRAINING');
  });

  it('revokes a PREPARED identity absent from global lists before journaling, deleting and rechecking its room', async () => {
    const s = fixture(await seed());
    const deleteRoom = s.deleteRoom.getMockImplementation()!;
    s.deleteRoom.mockImplementation(async (room) => {
      expect((await s.records()).at(-1)?.record.state).toBe('REVOKED');
      expect(s.remove).toHaveBeenCalledWith(s.record.roomName, s.record.identity, {
        revokeTokenTs: 1_800_000_002n,
      });
      expect(s.events.indexOf(`list:${room}`)).toBeLessThan(
        s.events.indexOf(`remove:${s.record.identity}`),
      );
      await deleteRoom(room);
    });
    expect(await s.run()).toMatchObject({
      recordedIdentities: 1,
      revoked: 1,
      unresolved: 0,
      ownedRoomsRemaining: 0,
      historyComplete: true,
    });
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.deleteRoom).toHaveBeenCalledOnce();
    expect(s.events.slice(-2)).toEqual(['listRooms', `list:${s.record.roomName}`]);
    expect(await s.retry.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: { state: [{ status: 'REVOKED' }] },
    });
    expect(await s.cleanupCheckpoint.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: { state: { report: { unresolved: 0, historyComplete: true } } },
    });
    expect(s.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    expect(s.usage.snapshot().activeMinutes).toBe(30);
    expect(s.bootstrap.getAdmission()).toBe('DRAINING');
  });

  it('durably records unknown observed identities before removal and retries them after restart even when lists are empty', async () => {
    const seeded = await seed('REVOKED');
    const s = fixture(seeded);
    const unknown = `${seeded.record.identity}-unknown`;
    s.rooms.get(s.record.roomName)!.add(unknown);
    s.listed.add(s.record.roomName);
    const remove = s.remove.getMockImplementation()!;
    s.remove.mockImplementation(async (room, identity, options) => {
      const checkpoint = await s.cleanupCheckpoint.read();
      expect(checkpoint).toMatchObject({
        integrity: 'ok',
        checkpoint: {
          state: { historyComplete: false, observedTargets: [{ roomName: room, identity }] },
        },
      });
      await remove(room, identity, options);
    });
    expect(await s.run()).toMatchObject({ revoked: 1, unresolved: 0, historyComplete: false });
    expect(s.bootstrap.getReadiness()).toMatchObject({ state: 'LOCKED', historyComplete: false });
    expect(await s.records()).toHaveLength(1);
    await s.bootstrap.close();
    const next = fixture(seeded, { startMs: 1_000 });
    expect(await next.run()).toMatchObject({ revoked: 1, unresolved: 0, historyComplete: false });
    expect(next.remove).toHaveBeenCalledWith(seeded.record.roomName, unknown, {
      revokeTokenTs: 1_800_000_003n,
    });
    expect(next.bootstrap.getReadiness()).toMatchObject({
      state: 'LOCKED',
      historyComplete: false,
    });
    expect(next.usage.snapshot().activeMinutes).toBe(30);
  });

  it('does not query, remove or delete other-service rooms', async () => {
    const s = fixture(await seed());
    const other = s.record.roomName.replace('e-fixture--', 'other-service--');
    s.rooms.set(other, new Set(['other-identity']));
    s.listed.add(other);
    expect((await s.run())?.unresolved).toBe(0);
    expect(s.listParticipants.mock.calls.every(([room]) => room !== other)).toBe(true);
    expect(s.remove.mock.calls.every(([room]) => room !== other)).toBe(true);
    expect(s.deleteRoom.mock.calls.every(([room]) => room !== other)).toBe(true);
    expect(s.rooms.get(other)?.has('other-identity')).toBe(true);
  });

  it.each(['missing-capability', 'wrong-project', 'wrong-namespace', 'missing-ownership'] as const)(
    'performs zero remote calls with %s',
    async (failure) => {
      const capability =
        failure === 'missing-capability'
          ? null
          : {
              ...localCapability,
              ...(failure === 'wrong-project' ? { cloudProjectAlias: 'different-project' } : {}),
              ...(failure === 'wrong-namespace' ? { namespace: 'different-namespace' } : {}),
            };
      const s = fixture(await seed(), { capability, ownership: failure !== 'missing-ownership' });
      expect((await s.run())?.unresolved).toBeGreaterThan(0);
      expect(s.api.getSnapshot().total60s).toBe(0);
      expect(s.listRooms).not.toHaveBeenCalled();
      expect(s.remove).not.toHaveBeenCalled();
      expect(s.bootstrap.getReadiness().state).toBe('LOCKED');
      expect((await s.records()).at(-1)?.record.state).toBe('PREPARED');
    },
  );

  it('never accepts RemoveParticipant 404 as revocation evidence', async () => {
    const s = fixture(await seed());
    s.remove.mockRejectedValue({ status: 404, code: 'not_found' });
    expect((await s.run())?.unresolved).toBeGreaterThan(0);
    expect(s.deleteRoom).not.toHaveBeenCalled();
    expect((await s.records()).at(-1)?.record.state).not.toBe('REVOKED');
    expect(s.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(s.usage.snapshot().activeMinutes).toBe(30);
  });

  it('recovers an ACTIVE reservation after a crash following durable REVOKED', async () => {
    const s = fixture(await seed('REVOKED'));
    expect(await s.run()).toMatchObject({ unresolved: 0, historyComplete: true });
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    expect(s.usage.snapshot().activeMinutes).toBe(30);
    expect(s.bootstrap.getReadiness().state).toBe('READY');
  });

  it('keeps a known reservation ACTIVE when the same room also contains an unrecorded identity', async () => {
    const s = fixture(await seed());
    s.rooms.get(s.record.roomName)!.add(s.record.identity);
    s.rooms.get(s.record.roomName)!.add('unknown-roommate');
    expect(await s.run()).toMatchObject({ revoked: 2, unresolved: 0, historyComplete: false });
    expect(s.remove).toHaveBeenCalledTimes(2);
    expect((await s.records()).at(-1)?.record.state).toBe('REVOKED');
    expect(s.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(s.usage.snapshot().activeMinutes).toBe(30);
    expect(s.bootstrap.getReadiness()).toMatchObject({ state: 'LOCKED', historyComplete: false });
  });

  it('revokes a reappeared REVOKED identity without reversing its terminal journal state', async () => {
    const s = fixture(await seed('REVOKED'));
    s.rooms.get(s.record.roomName)!.add(s.record.identity);
    expect(await s.run()).toMatchObject({ revoked: 1, unresolved: 0, historyComplete: false });
    expect(s.remove).toHaveBeenCalledOnce();
    expect((await s.records()).map(({ record }) => record.state)).toEqual(['REVOKED']);
    expect(await s.cleanupCheckpoint.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: {
        state: { historyComplete: false, observedTargets: [{ identity: s.record.identity }] },
      },
    });
    expect(s.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
  });

  it('accepts typed absent-room queries and delete 404 only after Remove ACK, then still rechecks participants', async () => {
    const s = fixture(await seed());
    s.listParticipants.mockRejectedValue({ status: 404, code: 'not_found' });
    s.deleteRoom.mockRejectedValue({ status: 404, code: 'not_found' });
    expect(await s.run()).toMatchObject({ revoked: 1, unresolved: 0, ownedRoomsRemaining: 0 });
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.listParticipants).toHaveBeenCalledTimes(3);
    expect(s.listRooms).toHaveBeenCalledTimes(2);
    expect(s.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
  });

  it('closes without an unresolved SDK reply and ignores the late response', async () => {
    const s = fixture(await seed());
    const response = deferred<Awaited<ReturnType<GatewayClient['listRooms']>>>();
    releases.push(() => response.resolve([]));
    s.listRooms.mockImplementationOnce(() => response.promise);
    await s.bootstrap.initialize();
    await vi.waitFor(() => expect(s.api.getSnapshot().inFlight).toBe(1));
    await s.bootstrap.close();
    expect(s.api.getSnapshot().inFlight).toBe(1);
    expect(s.journal.writable).toBe(false);
    expect(s.bootstrap.getReadiness().state).toBe('LOCKED');
    response.resolve([]);
    await vi.waitFor(() => expect(s.api.getSnapshot().inFlight).toBe(0));
    await s.bootstrap.completion();
    expect(s.listParticipants).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.deleteRoom).not.toHaveBeenCalled();
    expect((await s.records()).at(-1)?.record.state).toBe('PREPARED');
    expect(await s.cleanupCheckpoint.read()).toMatchObject({ integrity: 'missing' });
  });

  it('retries a known failure after one second, then completes a fresh room sweep and keeps official usage reserved', async () => {
    const s = fixture(await seed());
    s.remove.mockRejectedValueOnce(new Error('mock Cloud timeout'));
    expect((await s.run())?.unresolved).toBeGreaterThan(0);
    expect(s.remove).toHaveBeenCalledOnce();
    const listCount = s.listRooms.mock.calls.length;
    s.advance(999);
    await Promise.resolve();
    expect(s.remove).toHaveBeenCalledOnce();
    s.advance(1);
    await vi.waitFor(() =>
      expect(s.bindings.snapshot()).toMatchObject({ unresolved: 0, ownedRoomsRemaining: 0 }),
    );
    expect(s.remove).toHaveBeenCalledTimes(2);
    expect(s.remove.mock.calls.map((call) => call[2]?.revokeTokenTs)).toEqual([
      1_800_000_002n,
      1_800_000_003n,
    ]);
    expect(s.listRooms.mock.calls.length).toBeGreaterThan(listCount);
    expect(s.deleteRoom).toHaveBeenCalledOnce();
    expect((await s.records()).at(-1)?.record.state).toBe('REVOKED');
    expect(s.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    expect(s.usage.snapshot().activeMinutes).toBe(30);
    expect(
      await s.usage.releaseConfirmed(s.record.reservationId!, {
        remoteConfirmed: true,
        periodId: '2026-09',
        version: 1,
      }),
    ).toBe(false);
    expect(s.bootstrap.getReadiness().state).toBe('READY');
  });

  it('requires provider wait evidence after a 429 without retry-after and makes no automatic retry', async () => {
    const s = fixture(await seed());
    s.remove.mockRejectedValueOnce({ status: 429, code: 'resource_exhausted' });
    expect((await s.run())?.unresolved).toBeGreaterThan(0);
    s.advance(60_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(s.remove).toHaveBeenCalledOnce();
    const checkpoint = await s.retry.read();
    expect(checkpoint).toMatchObject({
      integrity: 'ok',
      checkpoint: { state: [{ status: 'UNRESOLVED', providerWaitUnknown: true }] },
    });
    if (checkpoint.integrity !== 'ok') throw new Error('EXPECTED_RETRY_CHECKPOINT');
    await expect(
      s.bindings.retries.retryNow(checkpoint.checkpoint.state[0]!.retirementId),
    ).rejects.toThrow('PROVIDER_WAIT_UNCONFIRMED');
    expect(s.remove).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'rechecks a captured pending target after a restored retry confirms revocation (reappeared=%s)',
    async (reappeared) => {
      const seeded = await seed();
      const first = fixture(seeded);
      first.remove.mockRejectedValueOnce(new Error('mock Cloud timeout before restart'));
      expect((await first.run())?.unresolved).toBeGreaterThan(0);
      await first.bootstrap.close();

      const next = fixture(seeded);
      const entered = deferred<void>();
      const enumeration = deferred<Awaited<ReturnType<GatewayClient['listParticipants']>>>();
      releases.push(() => enumeration.resolve([]));
      next.listParticipants.mockImplementationOnce(async () => {
        entered.resolve();
        return enumeration.promise;
      });
      await next.bootstrap.initialize();
      await entered.promise;
      next.advance(1_000);
      await vi.waitFor(() => expect(next.bindings.retries.snapshot()[0]?.status).toBe('REVOKED'));
      const terminalJournal = await next.records();
      expect(terminalJournal.at(-1)?.record.state).toBe('REVOKED');
      expect(next.remove).toHaveBeenCalledOnce();
      if (reappeared) next.rooms.get(next.record.roomName)!.add(next.record.identity);
      enumeration.resolve([]);
      expect(await next.bootstrap.completion()).toMatchObject({
        unresolved: 0,
        historyComplete: !reappeared,
      });
      // The successful restored retry also queues a public reconciliation pass.
      await next.bindings.reconcile();
      expect(await next.records()).toEqual(terminalJournal);
      if (reappeared) {
        expect(next.remove.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(await next.cleanupCheckpoint.read()).toMatchObject({
          integrity: 'ok',
          checkpoint: {
            state: {
              historyComplete: false,
              observedTargets: [{ identity: next.record.identity }],
            },
          },
        });
        expect(next.bootstrap.getReadiness()).toMatchObject({
          state: 'LOCKED',
          historyComplete: false,
        });
        expect(next.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
      } else {
        expect(next.remove).toHaveBeenCalledOnce();
        expect(next.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
        expect(next.bootstrap.getReadiness().state).toBe('READY');
      }
    },
  );

  it('uses cleanup priority for every query while normal API work is locked', async () => {
    const s = fixture(await seed());
    s.api.lockNormal();
    expect((await s.run())?.unresolved).toBe(0);
    expect(s.api.getSnapshot()).toMatchObject({ normalLocked: true, normal60s: 0 });
    expect(s.api.getSnapshot().total60s).toBeGreaterThan(0);
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.listRooms).toHaveBeenCalledTimes(2);
  });

  it('sends no network traffic at the total cap and cancels waiting cleanup when closed', async () => {
    const s = fixture(await seed(), { normalLimit: 1, totalLimit: 1 });
    await s.api.dispatch({
      requestId: 'consumed',
      method: 'fixture',
      target: 'fixture',
      kind: 'query',
      priority: 'cleanup',
      deadlineMs: 1000,
      run: async () => {},
    });
    await s.bootstrap.initialize();
    await vi.waitFor(() => expect(s.api.getSnapshot().pendingCleanup).toBe(1));
    const closing = s.bootstrap.close();
    await closing;
    await s.bootstrap.completion();
    expect(s.api.getSnapshot().total60s).toBe(1);
    expect(s.api.getSnapshot().pendingCleanup).toBe(0);
    expect(s.listRooms).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.deleteRoom).not.toHaveBeenCalled();
  });

  it('completes all 78 historical-room checks across the production 180-call rolling limit', async () => {
    const s = fixture(await seed('REVOKED', 78), { normalLimit: 120, totalLimit: 180 });
    await s.bootstrap.initialize();
    await vi.waitFor(() => expect(s.api.getSnapshot().pendingCleanup).toBe(4));
    expect(s.api.getSnapshot()).toMatchObject({ total60s: 180, normal60s: 0 });
    expect(s.events).toHaveLength(180);
    expect(s.reports).not.toHaveBeenCalled();

    // Actual bindings must wait for shared capacity; the pool fixture alone misses their deadline.
    s.advance(60_000);
    expect(await s.bootstrap.completion()).toMatchObject({
      unresolved: 0,
      historyComplete: true,
      ownedRoomsRemaining: 0,
    });
    expect(s.events).toHaveLength(236);
    expect(s.listRooms).toHaveBeenCalledTimes(2);
    expect(s.listParticipants).toHaveBeenCalledTimes(156);
    expect(s.deleteRoom).toHaveBeenCalledTimes(78);
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.api.getSnapshot()).toMatchObject({ total60s: 56, normal60s: 0, pendingCleanup: 0 });
    expect(s.bootstrap.getReadiness()).toMatchObject({ state: 'READY', unresolvedCount: 0 });
    expect(await s.cleanupCheckpoint.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: { state: { report: { unresolved: 0, historyComplete: true } } },
    });
  });

  it('revalidates 240 durably revoked/settled/expired absent rooms with two global queries', async () => {
    const s = fixture(await seed('REVOKED', 240, true), {
      normalLimit: 120,
      totalLimit: 180,
      startMs: 610_000,
    });
    expect(await s.run()).toMatchObject({
      historyComplete: true,
      unresolved: 0,
      ownedRoomsRemaining: 0,
    });
    expect(s.listRooms).toHaveBeenCalledTimes(2);
    expect(s.listParticipants).not.toHaveBeenCalled();
    expect(s.deleteRoom).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.api.getSnapshot().total60s).toBe(2);
    expect(s.usage.snapshot().reservations[0]?.status).toBe('RELEASED');
    expect(s.journal.snapshot().records).toHaveLength(240);
  });

  it('keeps per-room checks until the refreshed-token horizon even when the original JWT has expired', async () => {
    const s = fixture(await seed('REVOKED', 1, true), { startMs: 300_001 });
    expect(await s.run()).toMatchObject({ historyComplete: true, unresolved: 0 });
    expect(s.listParticipants).toHaveBeenCalledTimes(2);
    expect(s.deleteRoom).toHaveBeenCalledOnce();
  });

  it.each(['new-generation', 'ownership-lost', 'clock-reversed'] as const)(
    'rejects expired-history reuse when %s changes during the final Cloud query',
    async (change) => {
      const s = fixture(await seed('REVOKED', 1, true), { startMs: 610_000 });
      s.listRooms.mockResolvedValueOnce([]).mockImplementationOnce(async () => {
        if (change === 'new-generation')
          await s.journal.append({
            ...s.record,
            generation: s.record.generation + 1,
            state: 'PREPARED',
          });
        if (change === 'ownership-lost') s.setOwnership(false);
        if (change === 'clock-reversed') s.clock.ms = 300_001;
        return [];
      });
      const report = await s.run();
      expect(report?.unresolved).toBeGreaterThan(0);
      expect(s.bootstrap.getReadiness().state).toBe('LOCKED');
      expect(s.listRooms).toHaveBeenCalledTimes(2);
      expect(s.deleteRoom).not.toHaveBeenCalled();
      expect(s.journal.snapshot().records.length).toBeGreaterThan(0);
    },
  );

  it('rechecks ownership after waiting for a rolling window without dispatching queued queries', async () => {
    const s = fixture(await seed('REVOKED'), { normalLimit: 1, totalLimit: 1 });
    await s.api.dispatch({
      requestId: 'consumed',
      method: 'fixture',
      target: 'fixture',
      kind: 'query',
      priority: 'cleanup',
      deadlineMs: 1000,
      run: async () => {},
    });
    await s.bootstrap.initialize();
    await vi.waitFor(() => expect(s.api.getSnapshot().pendingCleanup).toBe(1));
    s.setOwnership(false);
    s.advance(60_000);
    expect(await s.bootstrap.completion()).toMatchObject({ historyComplete: false });
    expect(s.bootstrap.getReadiness().state).toBe('LOCKED');
    expect(s.events).toEqual([]);
    expect(s.api.getSnapshot().pendingCleanup).toBe(0);
  });

  it.each([2, 3])(
    'keeps revocation and its absence confirmation bounded at total limit %i',
    async (totalLimit) => {
      const s = fixture(await seed(), { normalLimit: 1, totalLimit });
      await s.bootstrap.initialize();
      await vi.waitFor(() => expect(s.api.getSnapshot().pendingCleanup).toBe(1));
      expect(s.api.getSnapshot().total60s).toBe(totalLimit);
      // Limit 2 queues RemoveParticipant; limit 3 queues its mandatory absence confirmation.
      expect(s.remove).toHaveBeenCalledTimes(totalLimit - 2);
      s.advance(1000);
      await vi.waitFor(() => expect(s.bindings.retries.snapshot()[0]?.status).toBe('REVOKING'));
      s.advance(9000);
      await vi.waitFor(() => expect(s.bindings.retries.snapshot()[0]?.status).toBe('UNRESOLVED'));
      expect(s.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
      expect(s.remove).toHaveBeenCalledTimes(totalLimit - 2);
      expect((await s.records()).at(-1)?.record.state).toBe('UNRESOLVED');
      await s.bootstrap.close();
      s.advance(60_000);
      expect(s.bootstrap.getReadiness().state).toBe('LOCKED');
      expect(s.api.getSnapshot().pendingCleanup).toBe(0);
      expect(s.remove).toHaveBeenCalledTimes(totalLimit - 2);
    },
  );

  it('retains the writer while an unknown-target checkpoint rename is pending and prevents removal after close', async () => {
    const seeded = await seed('REVOKED');
    const s = fixture(seeded);
    s.rooms.get(s.record.roomName)!.add('unknown-observed');
    const gate = holdRename(s.cleanupCheckpoint.filePath);
    await s.bootstrap.initialize();
    await gate.entered;
    const closing = s.bootstrap.close();
    const rival = resources(seeded.dir, { ms: 0 });
    expect(await rival.journal.restore()).toMatchObject({
      reason: 'WRITER_CONFLICT',
      writable: false,
    });
    expect(s.journal.writable).toBe(true);
    expect(s.remove).not.toHaveBeenCalled();
    gate.release();
    await closing;
    await s.bootstrap.completion();
    expect(s.remove).not.toHaveBeenCalled();
    const next = resources(seeded.dir, { ms: 0 });
    expect((await next.journal.restore()).writable).toBe(true);
    expect(await next.cleanupCheckpoint.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: {
        state: { historyComplete: false, observedTargets: [{ identity: 'unknown-observed' }] },
      },
    });
  });

  it.each(['corrupt', 'ahead'] as const)(
    'blocks all remote calls when the cleanup checkpoint is %s',
    async (kind) => {
      const seeded = await seed();
      const writer = resources(seeded.dir, { ms: 0 });
      await writer.journal.restore();
      if (kind === 'corrupt') await fs.writeFile(writer.cleanupCheckpoint.filePath, '{invalid');
      else
        await writer.cleanupCheckpoint.write({
          lastSeq: 2,
          state: {
            namespace: 'e-fixture',
            historyComplete: true,
            observedTargets: [],
            report: null,
          },
        });
      await writer.cleanupCheckpoint.close();
      await writer.journal.close();
      const original = await fs.readFile(writer.cleanupCheckpoint.filePath);
      const s = fixture(seeded);
      expect((await s.run())?.unresolved).toBeGreaterThan(0);
      expect(s.api.getSnapshot().total60s).toBe(0);
      expect(s.remove).not.toHaveBeenCalled();
      expect(s.bootstrap.getReadiness().state).toBe('LOCKED');
      expect(await fs.readFile(writer.cleanupCheckpoint.filePath)).toEqual(original);
    },
  );
});

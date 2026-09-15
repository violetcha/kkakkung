import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHealthHandlers } from '../../src/health/HealthHandlers.js';
import {
  createReadinessRuntime,
  type ReadinessRuntime,
} from '../../src/health/ReadinessRuntime.js';
import {
  isParsedCapabilityReport,
  parseCapabilityReport,
  type CapabilityReport,
} from '../../src/media/CloudCapabilityProbe.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import type { MediaConfiguration, OfficialBudgetCheckpoint } from '../../src/media/types.js';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import { OperationsAudit } from '../../src/operations/OperationsAudit.js';
import { createRecoveryBootstrap } from '../../src/operations/RecoveryBootstrap.js';
import {
  validateCleanupCheckpoint,
  type CleanupCheckpointState,
} from '../../src/operations/RecoveryCleanupBindings.js';
import type { CleanupReport } from '../../src/operations/RecoveryState.js';
import type { RetryIntent } from '../../src/operations/RevocationRetries.js';
import { validateRetryCheckpoint } from '../../src/operations/RevocationRetryBindings.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint } from '../../src/operations/UsageCheckpoint.js';
import { InviteStore } from '../../src/session/InviteStore.js';
import {
  deferred,
  localCapability,
  localConfiguration,
  practiceFrame,
  prepareRequest,
} from '../media/generation-fixtures.js';

const EPOCH = 1_800_000_000_000;
const completed: CleanupReport = {
  recordedIdentities: 0,
  observedParticipants: 0,
  revoked: 0,
  unresolved: 0,
  ownedRoomsRemaining: 0,
  historyComplete: true,
};
const closers: (() => Promise<void>)[] = [];
const directories: string[] = [];

async function fixture(
  options: {
    config?: Partial<MediaConfiguration>;
    firstInstallation?: boolean;
    directory?: string;
  } = {},
) {
  const dir =
    options.directory ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e15-readiness-')));
  if (!options.directory) directories.push(dir);
  const clock = { now: EPOCH };
  // External evidence is synthetic. Real local storage/consumers are exercised below; no Cloud calls.
  const evidence = {
    capability: structuredClone(localCapability) as CapabilityReport | null,
    mode: 'cloud' as 'cloud' | 'mock' | 'disabled' | null,
    security: true,
    ownership: true,
  };
  const config = { ...localConfiguration(EPOCH), opsDataDir: dir, ...options.config };
  const registry = new MediaGenerationRegistry(config.namespace);
  const journal = new OperationJournal({ opsDataDir: dir });
  const store = new UsageCheckpoint({ opsDataDir: dir, isWritable: () => journal.writable });
  let runtime: ReadinessRuntime | null = null;
  const usage = new UsageBudget({
    store,
    projectAlias: config.projectAlias,
    officialBudgetMaxAgeMs: config.officialBudgetMaxAgeMs,
    now: () => clock.now,
    canIssue: () => ({ allowed: runtime?.canIssue() ?? false }),
  });
  const retry = new CheckpointStore<readonly RetryIntent[]>({
    opsDataDir: dir,
    fileName: 'retry-checkpoint.json',
    validate: validateRetryCheckpoint,
    isWritable: () => journal.writable,
  });
  const cleanupStore = new CheckpointStore<CleanupCheckpointState>({
    opsDataDir: dir,
    fileName: 'cleanup-checkpoint.json',
    validate: validateCleanupCheckpoint,
    isWritable: () => journal.writable,
  });
  const pendingCleanup = deferred<CleanupReport>();
  const cleanup = vi.fn(() => pendingCleanup.promise);
  const recovery = createRecoveryBootstrap({
    namespace: config.namespace,
    serverEpoch: registry.serverEpoch,
    journal,
    usageBudget: usage,
    retryCheckpoint: retry,
    nowEpochMs: () => clock.now,
    monotonicNow: () => performance.now(),
    officialBudgetMaxAgeMs: config.officialBudgetMaxAgeMs,
    firstInstallationConfirmed: async () => options.firstInstallation !== false,
    beginCleanup: cleanup,
    closeCleanup: () => cleanupStore.close(),
  });
  const audit = new OperationsAudit({
    opsDataDir: dir,
    nowEpochMs: () => clock.now,
    isWritable: () => journal.writable,
    allowMissingHistory: () => options.firstInstallation !== false,
  });
  const activity = { activeMatches: 0, activePractices: 0, pendingAdmissions: 0 };
  runtime = createReadinessRuntime({
    config,
    recovery,
    registry,
    journal,
    usageBudget: usage,
    audit,
    retryCheckpoint: retry,
    cleanupCheckpoint: cleanupStore,
    retries: [],
    nowEpochMs: () => clock.now,
    monotonicNow: () => performance.now(),
    mediaMode: () => evidence.mode,
    productSecurityReady: () => evidence.security,
    namespaceOwnershipConfirmed: () => evidence.ownership,
    capability: () => evidence.capability,
    getGameActivity: () => activity,
    getOfficialRevision: () => ({ periodId: 'local-fixture-period', version: 1 }),
  });
  const bound = runtime;
  closers.push(async () => {
    pendingCleanup.resolve(completed);
    await bound.close();
    await audit.close();
    await recovery.close();
    registry.close();
  });
  const operations = bound.getOperations();
  const official: OfficialBudgetCheckpoint = {
    projectAlias: config.projectAlias,
    remainingMinutes: 5000,
    remainingBytes: 10_000_000_000,
    checkedAtEpochMs: EPOCH,
    source: 'cloud-dashboard',
    checkedBy: 'synthetic-local-only-not-cloud-evidence',
  };
  return {
    dir,
    clock,
    config,
    evidence,
    registry,
    journal,
    store,
    usage,
    retry,
    cleanupStore,
    recovery,
    audit,
    runtime: bound,
    activity,
    operations,
    official,
    pendingCleanup,
    cleanup,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function reconcile(f: Fixture, checkpoint = f.official, version = 1) {
  expect(
    await f.usage.reconcileOfficial(checkpoint, {
      periodId: 'local-fixture-period',
      version,
    }),
  ).toEqual({ status: 'applied' });
}

async function ready(f: Fixture) {
  expect(await f.runtime.initialize()).toMatchObject({
    status: 'initialized',
    admission: 'DRAINING',
  });
  await reconcile(f);
  f.pendingCleanup.resolve(completed);
  await f.recovery.completion();
  expect(f.runtime.getReadiness()).toEqual({
    state: 'READY',
    reasonCodes: [],
    historyComplete: true,
    unresolvedCount: 0,
  });
}

async function terminal(f: Fixture, requestId: string) {
  await vi.waitFor(() => expect(f.operations.getSnapshot(requestId)?.status).not.toBe('pending'));
  return f.operations.getSnapshot(requestId)!;
}

async function resume(f: Fixture, requestId = 'resume') {
  expect(f.operations.submit({ requestId, action: 'resume' }).status).toBe('accepted');
  expect(await terminal(f, requestId)).toMatchObject({ status: 'succeeded', code: null });
  expect(f.runtime.canIssue()).toBe(true);
}

function consumers(f: Fixture, sign?: () => Promise<string>) {
  const invites = new InviteStore({
    now: () => f.clock.now,
    maxTtlMs: 60_000,
    publicWindow: f.config.publicWindow,
    knownRoomCodes: () => new Set<string>(),
    operationsReady: f.runtime.canIssue,
  });
  const invitation = () =>
    invites.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: EPOCH + 30_000,
    });
  const retired = vi.fn();
  const onPrepared = vi.fn();
  const issuer = f.runtime.createGrantIssuer({ retire: retired, onPrepared, sign });
  f.registry.observe({
    ...practiceFrame,
    participants: [
      practiceFrame.participants[0]!,
      {
        ...practiceFrame.participants[0]!,
        playerId: 'second-player',
      },
    ],
  });
  return { invitation, issuer, retired, onPrepared };
}

async function http(f: Fixture) {
  const handlers = createHealthHandlers(f.runtime);
  const app = express();
  app.get('/live', handlers.live);
  app.get('/ready', handlers.ready);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address() as AddressInfo;
  return async (route: 'live' | 'ready') => {
    const response = await fetch(`http://127.0.0.1:${address.port}/${route}`);
    return {
      status: response.status,
      cache: response.headers.get('cache-control'),
      body: await response.json(),
    };
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
  for (const directory of directories.splice(0)) {
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith('kkakkung-e15-readiness-')
    )
      throw new Error('UNSAFE_TEST_DIRECTORY');
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('E-15 actual local recovery, operations and consumers; synthetic external evidence only', () => {
  it('observes initialized recovery without waiting for Cloud and requires a durable explicit resume', async () => {
    const f = await fixture();
    const get = await http(f);
    const c = consumers(f);
    expect((await get('live')).status).toBe(503);
    const initializing = f.runtime.initialize();
    expect(f.runtime.initialize()).toBe(initializing);
    expect(await initializing).toMatchObject({ status: 'initialized', admission: 'DRAINING' });
    expect(f.cleanup).toHaveBeenCalledOnce();
    await reconcile(f);
    expect(f.runtime.getReadiness().state).toBe('RECOVERING');
    expect(await get('live')).toEqual({
      status: 200,
      cache: 'no-store',
      body: { state: 'LIVE', reasonCodes: [] },
    });
    expect(await get('ready')).toMatchObject({ status: 503, body: { state: 'RECOVERING' } });
    expect(f.operations.getStatus()).toMatchObject({
      readiness: 'RECOVERING',
      admission: 'DRAINING',
    });
    expect(c.invitation().status).toBe('rejected');
    expect(await c.issuer.prepare(prepareRequest)).toMatchObject({
      status: 'rejected',
      code: 'NOT_READY',
      grant: null,
    });
    f.pendingCleanup.resolve(completed);
    await f.recovery.completion();
    expect(await get('ready')).toEqual({
      status: 200,
      cache: 'no-store',
      body: { state: 'READY', reasonCodes: [] },
    });
    expect(f.operations.getStatus().admission).toBe('DRAINING');
    expect(f.runtime.canIssue()).toBe(false);
    await resume(f);
    expect(c.invitation().status).toBe('issued');
    // Same previously rejected request may recheck the now-shared gate.
    expect((await c.issuer.prepare(prepareRequest)).status).toBe('ready');
    expect(f.audit.get('resume')).toMatchObject({ snapshot: { status: 'succeeded' } });
  });

  it('keeps two actually reserved, journaled and signed current grants READY on one room lease', async () => {
    const f = await fixture();
    await ready(f);
    await resume(f);
    const c = consumers(f);
    expect((await c.issuer.prepare(prepareRequest)).status).toBe('ready');
    expect(f.runtime.getReadiness().state).toBe('READY');
    expect(
      (
        await c.issuer.prepare({
          ...prepareRequest,
          requestId: 'second',
          playerId: 'second-player',
        })
      ).status,
    ).toBe('ready');
    expect(f.runtime.getReadiness()).toMatchObject({
      state: 'READY',
      historyComplete: true,
      unresolvedCount: 0,
    });
    expect(f.journal.snapshot().records).toHaveLength(2);
    expect(f.usage.snapshot().reservations).toHaveLength(1);
    expect(f.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(new Set(f.registry.all().map((generation) => generation.reservationId)).size).toBe(1);
    expect(c.onPrepared).toHaveBeenCalledTimes(2);
    expect(c.retired).not.toHaveBeenCalled();
  });

  it('normal drain preserves healthy readiness but denies the next invitation and grant', async () => {
    const f = await fixture();
    await ready(f);
    await resume(f);
    const c = consumers(f);
    expect(f.operations.submit({ requestId: 'drain', action: 'drain' }).status).toBe('accepted');
    expect(f.operations.getStatus()).toMatchObject({ readiness: 'READY', admission: 'DRAINING' });
    expect(c.invitation().status).toBe('rejected');
    expect(await c.issuer.prepare(prepareRequest)).toMatchObject({
      code: 'NOT_READY',
      grant: null,
    });
    expect((await terminal(f, 'drain')).status).toBe('succeeded');
    expect(f.runtime.getReadiness().state).toBe('READY');
    await resume(f, 'resume-after-drain');
    expect(c.invitation().status).toBe('issued');
    expect((await c.issuer.prepare(prepareRequest)).status).toBe('ready');
  });

  it.each([
    ['capability', 'CLOUD_CAPABILITY_UNCONFIRMED'],
    ['security', 'PRODUCT_SECURITY_UNCONFIRMED'],
    ['ownership', 'NAMESPACE_OWNERSHIP_UNCONFIRMED'],
    ['disabled', 'MEDIA_MODE_UNCONFIRMED'],
    ['mock', 'MEDIA_MODE_UNCONFIRMED'],
  ] as const)(
    'rejects all issuance after losing %s, without auto-opening after recovery',
    async (missing, code) => {
      const f = await fixture();
      await ready(f);
      await resume(f);
      const c = consumers(f);
      if (missing === 'capability') f.evidence.capability = null;
      else if (missing === 'security') f.evidence.security = false;
      else if (missing === 'ownership') f.evidence.ownership = false;
      else f.evidence.mode = missing;
      expect(f.runtime.getReadiness().reasonCodes).toContain(code);
      expect(c.invitation().status).toBe('rejected');
      expect(await c.issuer.prepare(prepareRequest)).toMatchObject({
        code: 'NOT_READY',
        grant: null,
      });
      f.evidence.capability = structuredClone(localCapability);
      f.evidence.security = true;
      f.evidence.ownership = true;
      f.evidence.mode = 'cloud';
      expect(f.runtime.getReadiness().state).toBe('READY');
      expect(f.operations.getStatus().admission).toBe('DRAINING');
      expect(f.runtime.canIssue()).toBe(false);
      // Replaying a durable old successful resume cannot reopen admission.
      f.operations.submit({ requestId: 'resume', action: 'resume' });
      expect(f.operations.getStatus().admission).toBe('DRAINING');
      await resume(f, 'resume-after-evidence');
      expect((await c.issuer.prepare(prepareRequest)).status).toBe('ready');
    },
  );

  it.each(['journal', 'usage', 'retry', 'cleanup', 'audit'] as const)(
    'locks permanently when the real %s store stops being writable',
    async (store) => {
      const f = await fixture();
      await ready(f);
      await resume(f);
      const c = consumers(f);
      if (store === 'journal') await f.journal.close();
      if (store === 'usage') await f.store.close();
      if (store === 'retry') await f.retry.close();
      if (store === 'cleanup') await f.cleanupStore.close();
      if (store === 'audit') await f.audit.close();
      expect(f.runtime.getReadiness()).toMatchObject({ state: 'LOCKED' });
      expect(f.runtime.getReadiness().reasonCodes).toContain(
        store === 'audit' ? 'AUDIT_WRITE_FAILED' : 'STORAGE_NOT_WRITABLE',
      );
      expect(c.invitation().status).toBe('rejected');
      expect(await c.issuer.prepare(prepareRequest)).toMatchObject({
        code: 'NOT_READY',
        grant: null,
      });
    },
  );

  it('keeps missing official usage locked even after cleanup and refuses resume', async () => {
    const f = await fixture();
    await f.runtime.initialize();
    f.pendingCleanup.resolve(completed);
    await f.recovery.completion();
    expect(f.runtime.getReadiness().reasonCodes).toContain('BUDGET_UNCONFIRMED');
    f.operations.submit({ requestId: 'premature', action: 'resume' });
    expect((await terminal(f, 'premature')).status).toBe('failed');
    expect(f.runtime.canIssue()).toBe(false);
    await reconcile(f);
    expect(f.runtime.getReadiness().state).toBe('READY');
    expect(f.runtime.canIssue()).toBe(false);
    await resume(f);
  });

  it.each(['stale', 'future'] as const)(
    'blocks %s official usage at the current clock',
    async (direction) => {
      const f = await fixture();
      await ready(f);
      await resume(f);
      const c = consumers(f);
      f.clock.now = direction === 'stale' ? EPOCH + f.config.officialBudgetMaxAgeMs + 1 : EPOCH - 1;
      expect(f.runtime.getReadiness().reasonCodes).toContain('BUDGET_UNCONFIRMED');
      expect(await c.issuer.prepare(prepareRequest)).toMatchObject({
        code: 'NOT_READY',
        grant: null,
      });
      expect(c.invitation().status).toBe('rejected');
    },
  );

  it('rejects a mismatched verified Cloud scope and a disabled security configuration', async () => {
    const f = await fixture({ config: { productSecurityReady: false } });
    await f.runtime.initialize();
    await reconcile(f);
    f.pendingCleanup.resolve(completed);
    await f.recovery.completion();
    f.evidence.capability = { ...localCapability, namespace: 'foreign-namespace' };
    expect(f.runtime.getReadiness().reasonCodes).toEqual(
      expect.arrayContaining(['PRODUCT_SECURITY_UNCONFIRMED', 'CLOUD_CAPABILITY_UNCONFIRMED']),
    );
    expect(f.runtime.canIssue()).toBe(false);
  });

  it('reuses a parsed capability report but rechecks its scope and clock on every observation', async () => {
    const f = await fixture();
    await ready(f);
    const parsed = parseCapabilityReport(structuredClone(localCapability));
    expect(isParsedCapabilityReport(parsed)).toBe(true);
    f.evidence.capability = parsed;
    expect(f.runtime.getReadiness().reasonCodes).not.toContain('CLOUD_CAPABILITY_UNCONFIRMED');
    f.clock.now = parsed.testedAtEpochMs - 1;
    expect(f.runtime.getReadiness().reasonCodes).toContain('CLOUD_CAPABILITY_UNCONFIRMED');
    f.clock.now = EPOCH;
    expect(f.runtime.getReadiness().reasonCodes).not.toContain('CLOUD_CAPABILITY_UNCONFIRMED');
    const lookalike = Object.freeze({ ...parsed, namespace: 'foreign-namespace' });
    expect(isParsedCapabilityReport(lookalike)).toBe(false);
    f.evidence.capability = lookalike;
    expect(f.runtime.getReadiness().reasonCodes).toContain('CLOUD_CAPABILITY_UNCONFIRMED');
    f.evidence.capability = Object.freeze({ ...parsed, status: 'BROKEN' } as never);
    expect(f.runtime.getReadiness().reasonCodes).toContain('CLOUD_CAPABILITY_UNCONFIRMED');
  });

  it('does not accept an empty local directory as complete history without provisioning proof', async () => {
    const f = await fixture({ firstInstallation: false });
    expect(await f.runtime.initialize()).toMatchObject({
      status: 'initialized',
      readiness: { state: 'LOCKED' },
    });
    expect(f.runtime.getReadiness()).toMatchObject({ state: 'LOCKED', historyComplete: false });
    expect(f.runtime.getReadiness().reasonCodes).toContain('HISTORY_INCOMPLETE');
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.runtime.canIssue()).toBe(false);
  });

  it('keeps one durable old identity unready even if an external cleanup report claims success', async () => {
    const previous = await fixture();
    await ready(previous);
    await resume(previous);
    const oldConsumer = consumers(previous);
    expect((await oldConsumer.issuer.prepare(prepareRequest)).status).toBe('ready');
    const oldIdentity = previous.registry.all()[0]!.identity;
    await previous.runtime.close();
    await previous.audit.close();
    await previous.recovery.close();
    previous.registry.close();
    const f = await fixture({ directory: previous.dir });
    expect(await f.runtime.initialize()).toMatchObject({ status: 'initialized' });
    f.pendingCleanup.resolve({ ...completed, recordedIdentities: 1, revoked: 1 });
    await f.recovery.completion();
    expect(f.runtime.getReadiness()).toMatchObject({ state: 'LOCKED', unresolvedCount: 1 });
    const get = await http(f);
    expect((await get('live')).status).toBe(200);
    const readiness = await get('ready');
    expect(readiness.status).toBe(503);
    expect(JSON.stringify(readiness.body)).not.toContain(oldIdentity);
    const c = consumers(f);
    expect(await c.issuer.prepare(prepareRequest)).toMatchObject({
      code: 'NOT_READY',
      grant: null,
    });
    expect(c.invitation().status).toBe('rejected');
  });

  it('withholds a signed token if storage fails while signing is in flight', async () => {
    const f = await fixture();
    await ready(f);
    await resume(f);
    const signing = deferred<string>();
    const entered = deferred<void>();
    const c = consumers(f, () => {
      entered.resolve();
      return signing.promise;
    });
    const result = c.issuer.prepare(prepareRequest);
    await entered.promise;
    await f.cleanupStore.close();
    expect(f.runtime.getReadiness().state).toBe('LOCKED');
    signing.resolve('synthetic-token-not-returned');
    expect(await result).toMatchObject({
      status: 'rejected',
      code: 'STALE_GENERATION',
      grant: null,
    });
    expect(c.retired).toHaveBeenCalledOnce();
    expect(c.onPrepared).not.toHaveBeenCalled();
    expect(f.journal.snapshot().records).toHaveLength(1);
    expect(f.usage.snapshot().reservations).toHaveLength(1);
  });

  it('keeps local initialization observable when a real audit file is corrupt', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.dir, 'operations-audit.json'), '{broken-audit');
    expect(await f.runtime.initialize()).toMatchObject({
      status: 'initialized',
      readiness: { state: 'LOCKED' },
      admission: 'DRAINING',
    });
    expect(f.runtime.isInitialized()).toBe(true);
    expect(f.runtime.getReadiness().reasonCodes).toContain('AUDIT_WRITE_FAILED');
    const get = await http(f);
    expect((await get('live')).status).toBe(200);
    expect((await get('ready')).status).toBe(503);
    expect(f.operations.getStatus()).toMatchObject({ readiness: 'LOCKED', admission: 'LOCKED' });
    expect(f.runtime.canIssue()).toBe(false);
  });

  it('blocks a reservation that bypasses the bound issuer and retains the durable unknown usage', async () => {
    const f = await fixture();
    await ready(f);
    await resume(f);
    // Only the bound issuer's in-flight prepare is allowed to reserve before PREPARED is durable.
    expect(
      await f.usage.reserve({
        reservationId: 'orphan-root',
        matchId: 'm',
        purpose: 'public',
        slots: 6,
        expectedMinutes: 1,
        expectedBytes: 1_000,
        margin: 0,
      }),
    ).toEqual({ status: 'rejected', code: 'ISSUANCE_BLOCKED' });
    expect(f.usage.snapshot().reservations).toHaveLength(1);
    expect(f.runtime.getReadiness().reasonCodes).toContain('RESERVATION_HISTORY_MISMATCH');
    expect(f.runtime.canIssue()).toBe(false);
  });

  it('blocks when an accepted official revision is lower than the still-reserved usage', async () => {
    const f = await fixture();
    await ready(f);
    await resume(f);
    const c = consumers(f);
    expect((await c.issuer.prepare(prepareRequest)).status).toBe('ready');
    f.clock.now += 1;
    await reconcile(
      f,
      { ...f.official, checkedAtEpochMs: f.clock.now, remainingMinutes: 1, remainingBytes: 1 },
      2,
    );
    expect(f.runtime.getReadiness().reasonCodes).toContain('BUDGET_OVERCOMMITTED');
    expect(f.runtime.canIssue()).toBe(false);
    expect(f.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(
      await c.issuer.prepare({
        ...prepareRequest,
        requestId: 'blocked-second',
        playerId: 'second-player',
      }),
    ).toMatchObject({ status: 'rejected', code: 'NOT_READY', grant: null });
  });

  it('requires confirmed single-writer evidence even when all backing stores still answer writable', async () => {
    const f = await fixture();
    await ready(f);
    await resume(f);
    const snapshot = f.recovery.state.snapshot();
    vi.spyOn(f.recovery.state, 'snapshot').mockReturnValue({ ...snapshot, singleWriter: false });
    expect(f.journal.writable).toBe(true);
    expect(f.runtime.getReadiness().reasonCodes).toContain('SINGLE_WRITER_UNCONFIRMED');
    expect(f.runtime.canIssue()).toBe(false);
  });

  it('returns fatal on actual competing journal ownership and never opens health or issuance', async () => {
    const owner = await fixture();
    await ready(owner);
    const competitor = await fixture({ directory: owner.dir });
    expect(await competitor.runtime.initialize()).toEqual({
      status: 'fatal',
      code: 'WRITER_CONFLICT',
    });
    expect(competitor.runtime.isInitialized()).toBe(false);
    expect(competitor.runtime.canIssue()).toBe(false);
    const get = await http(competitor);
    expect((await get('live')).status).toBe(503);
    expect((await get('ready')).status).toBe(503);
    expect(competitor.cleanup).not.toHaveBeenCalled();
    expect(owner.journal.writable).toBe(true);
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrantIssuer } from '../../src/media/GrantIssuer.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import type {
  MediaConfiguration,
  OfficialBudgetCheckpoint,
  Readiness,
} from '../../src/media/types.js';
import { InviteStore } from '../../src/session/InviteStore.js';
import { OperationJournal, type JournalRecord } from '../../src/operations/OperationJournal.js';
import { OperationsAudit } from '../../src/operations/OperationsAudit.js';
import { OperationsBindings } from '../../src/operations/OperationsBindings.js';
import { OperationsController } from '../../src/operations/OperationsController.js';
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
const cleanup: (() => Promise<void>)[] = [];
const releases: (() => void)[] = [];

async function setup(overrides: Partial<MediaConfiguration> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e14-bindings-'));
  const clock = { now: EPOCH };
  const state = {
    readiness: {
      state: 'READY',
      reasonCodes: [],
      historyComplete: true,
      unresolvedCount: 0,
    } as Readiness,
    activity: { activeMatches: 0, activePractices: 0, pendingAdmissions: 0 },
    revision: { periodId: 'fixture-period', version: 1 } as {
      periodId: string;
      version: number;
    } | null,
  };
  const config = { ...localConfiguration(EPOCH), opsDataDir: dir, ...overrides };
  const journal = new OperationJournal({ opsDataDir: dir });
  await journal.restore();
  let bindings: OperationsBindings | null = null;
  const usageStore = new UsageCheckpoint({ opsDataDir: dir, isWritable: () => journal.writable });
  const usage = new UsageBudget({
    store: usageStore,
    projectAlias: 'local-fixture',
    officialBudgetMaxAgeMs: config.officialBudgetMaxAgeMs,
    now: () => clock.now,
    canIssue: () => ({ allowed: bindings?.canIssue() ?? true }),
  });
  await usage.restore({ allowInitializeMissing: true });
  // Explicit local proof fixtures; this is not F's official Cloud usage or product READY.
  const official: OfficialBudgetCheckpoint = {
    projectAlias: 'local-fixture',
    remainingMinutes: 5000,
    remainingBytes: 10_000_000_000,
    checkedAtEpochMs: EPOCH,
    source: 'cloud-dashboard',
    checkedBy: 'local-fixture-operator',
  };
  expect(await usage.reconcileOfficial(official, state.revision!)).toEqual({ status: 'applied' });
  bindings = new OperationsBindings({
    config,
    journal,
    usageBudget: usage,
    getReadiness: () => state.readiness,
    getGameActivity: () => state.activity,
    retries: [],
    nowEpochMs: () => clock.now,
    getOfficialRevision: () => state.revision,
  });
  const audit = new OperationsAudit({
    opsDataDir: dir,
    nowEpochMs: () => clock.now,
    isWritable: () => journal.writable,
    allowMissingHistory: () => true,
  });
  const operations = new OperationsController({
    nowEpochMs: () => clock.now,
    monotonicNow: () => performance.now(),
    timeoutMs: config.operationTimeoutMs,
    setAdmission: (value) => bindings!.setAdmission(value),
    getStatus: () => bindings!.getStatus(),
    canResume: () => bindings!.canResume(),
    canComplete: (command) => bindings!.canComplete(command),
    run: (command, signal, beforeDispatch) => bindings!.run(command, signal, beforeDispatch),
    auditStore: audit,
  });
  cleanup.push(async () => {
    const closing = bindings!.close();
    await operations.close();
    await closing;
    await usage.close();
    await journal.close();
    const target = path.resolve(dir);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith('kkakkung-e14-bindings-')
    )
      throw new Error('UNSAFE_TEST_PATH');
    await fs.rm(target, { recursive: true, force: true });
  });
  await operations.initializeAudit();
  return {
    dir,
    config,
    clock,
    state,
    journal,
    usage,
    usageStore,
    bindings,
    operations,
    official,
    audit,
  };
}

async function terminal(f: Awaited<ReturnType<typeof setup>>, requestId: string) {
  await vi.waitFor(() => expect(f.operations.getSnapshot(requestId)?.status).not.toBe('pending'));
  return f.operations.getSnapshot(requestId)!;
}
async function resume(f: Awaited<ReturnType<typeof setup>>, requestId = 'resume') {
  expect(f.operations.submit({ requestId, action: 'resume' }).status).toBe('accepted');
  expect((await terminal(f, requestId)).status).toBe('succeeded');
}
async function reservation(f: Awaited<ReturnType<typeof setup>>, id = 'root') {
  expect(
    (
      await f.usage.reserve({
        reservationId: id,
        matchId: 'm',
        purpose: 'public',
        slots: 6,
        expectedMinutes: 5,
        expectedBytes: 1000,
        margin: 0,
      })
    ).status,
  ).toBe('reserved');
}
function record(reservationId = 'root', state: JournalRecord['state'] = 'PREPARED'): JournalRecord {
  return {
    state,
    namespace: 'e-fixture',
    matchId: 'm',
    mediaInstanceId: 'practice',
    serverEpoch: '11111111-1111-4111-8111-111111111111',
    roomName: 'e-fixture--11111111-1111-4111-8111-111111111111',
    identity: 'synthetic-identity',
    generation: 1,
    issuedAtEpochMs: EPOCH,
    expiresAtEpochMs: EPOCH + 60_000,
    reservationId,
    atEpochMs: EPOCH,
  };
}
async function officialInput(f: Awaited<ReturnType<typeof setup>>, overrides = {}) {
  f.clock.now += 100;
  f.state.revision = { periodId: 'fixture-period', version: 2 };
  await fs.writeFile(
    path.join(f.dir, 'official-usage-input.json'),
    JSON.stringify({
      ...f.official,
      checkedAtEpochMs: f.clock.now,
      remainingMinutes: 4500,
      ...overrides,
    }),
  );
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('E-14 real local operations bindings (no Cloud calls)', () => {
  it('starts drained and shares one gate with actual B invitation issuance', async () => {
    const f = await setup();
    const invites = new InviteStore({
      now: () => f.clock.now,
      maxTtlMs: 60_000,
      publicWindow: f.config.publicWindow,
      knownRoomCodes: () => new Set<string>(),
      operationsReady: () => f.bindings.canIssue(),
    });
    const input = { scope: { allowCreate: true, roomCodes: [] }, expiresAt: EPOCH + 30_000 };
    expect(invites.issue(input).status).toBe('rejected');
    await resume(f);
    expect(invites.issue(input).status).toBe('issued');
    f.state.activity.activePractices = 1;
    f.operations.submit({ requestId: 'drain', action: 'drain' });
    expect(f.operations.getStatus()).toMatchObject({ admission: 'DRAINING', readiness: 'READY' });
    expect(invites.issue(input).status).toBe('rejected');
    expect(invites.size).toBe(1);
    expect(f.state.activity.activePractices).toBe(1);
    f.state.activity.activePractices = 0;
    expect((await terminal(f, 'drain')).status).toBe('succeeded');
    await resume(f, 'resume-again');
    expect(f.operations.getStatus().admission).toBe('OPEN');
  });

  it.each(['activeMatches', 'activePractices', 'pendingAdmissions'] as const)(
    'drain waits for %s and durable revocation but preserves reserved usage',
    async (key) => {
      const f = await setup();
      await resume(f);
      await reservation(f);
      await f.journal.append(record());
      f.state.activity[key] = 1;
      f.operations.submit({ requestId: 'drain', action: 'drain' });
      await f.journal.append(record('root', 'REVOKED'));
      await f.usage.markRetiring('root');
      await f.usage.markRemoteConfirmed('root');
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(f.operations.getSnapshot('drain')?.status).toBe('pending');
      f.state.activity[key] = 0;
      expect((await terminal(f, 'drain')).status).toBe('succeeded');
      expect(f.usage.snapshot()).toMatchObject({
        activeMinutes: 30,
        reservations: [{ status: 'AWAITING_OFFICIAL' }],
      });
    },
  );

  it('times out on unknown activity and never changes the running match', async () => {
    const f = await setup({ operationTimeoutMs: 60 });
    await resume(f);
    f.state.activity.activeMatches = Number.NaN;
    f.operations.submit({ requestId: 'drain', action: 'drain' });
    expect(await terminal(f, 'drain')).toMatchObject({
      status: 'failed',
      code: 'OPERATION_TIMEOUT',
    });
    expect(f.operations.getStatus().admission).toBe('DRAINING');
    expect(f.state.activity.activeMatches).toBeNaN();
  });

  it('will not confirm drain from a cached boot journal when a PREPARED identity remains', async () => {
    const f = await setup({ operationTimeoutMs: 60 });
    await f.journal.append(record());
    f.operations.submit({ requestId: 'drain', action: 'drain' });
    expect((await terminal(f, 'drain')).status).toBe('failed');
  });

  it.each([
    null,
    { opensAtEpochMs: EPOCH + 1, closesAtEpochMs: EPOCH + 50_000 },
    { opensAtEpochMs: EPOCH - 100, closesAtEpochMs: EPOCH },
  ])('refuses resume outside configured half-open window %j', async (publicWindow) => {
    const f = await setup({ publicWindow });
    f.operations.submit({ requestId: 'resume', action: 'resume' });
    expect((await terminal(f, 'resume')).status).toBe('failed');
    expect(f.bindings.canIssue()).toBe(false);
  });

  it('closes admission when window expires without a timer and does not reopen after clock rollback', async () => {
    const f = await setup();
    await resume(f);
    f.clock.now = f.config.publicWindow!.closesAtEpochMs;
    expect(f.operations.getStatus()).toMatchObject({ admission: 'DRAINING', readiness: 'READY' });
    f.clock.now = EPOCH;
    expect(f.bindings.canIssue()).toBe(false);
  });

  it('requires security, complete history, freshness, and actual product readiness to resume', async () => {
    const insecure = await setup({ productSecurityReady: false });
    expect(insecure.bindings.canResume()).toBe(false);
    const f = await setup();
    f.state.readiness = { ...f.state.readiness, historyComplete: false };
    expect(f.bindings.canResume()).toBe(false);
    f.state.readiness = { ...f.state.readiness, historyComplete: true, state: 'RECOVERING' };
    expect(f.bindings.canResume()).toBe(false);
    f.state.readiness = { ...f.state.readiness, state: 'READY' };
    f.clock.now += f.config.officialBudgetMaxAgeMs + 1;
    expect(f.operations.getStatus()).toMatchObject({
      readiness: 'LOCKED',
      remainingMinutes: null,
      remainingBytes: null,
      checkedAtEpochMs: null,
    });
  });

  it('imports the official file idempotently and releases only durably revoked reservations', async () => {
    const f = await setup();
    await resume(f);
    await reservation(f);
    await f.journal.append(record('root', 'REVOKED'));
    await f.usage.markRetiring('root');
    await f.usage.markRemoteConfirmed('root');
    await officialInput(f);
    const command = { requestId: 'checkpoint', action: 'checkpoint' as const };
    const first = f.operations.submit(command);
    expect(f.operations.submit(command)).toEqual(first);
    expect((await terminal(f, command.requestId)).status).toBe('succeeded');
    expect(f.usage.snapshot()).toMatchObject({
      official: { version: 2 },
      activeMinutes: 0,
      reservations: [{ status: 'RELEASED' }],
    });
    const before = await fs.readFile(path.join(f.dir, 'usage-checkpoint.json'), 'utf8');
    f.operations.submit({ requestId: 'checkpoint-again', action: 'checkpoint' });
    expect((await terminal(f, 'checkpoint-again')).status).toBe('succeeded');
    expect(await fs.readFile(path.join(f.dir, 'usage-checkpoint.json'), 'utf8')).toBe(before);
  });

  it('does not manufacture missing official revision, provider data, or release on lost history', async () => {
    const f = await setup();
    f.operations.submit({ requestId: 'missing', action: 'checkpoint' });
    expect((await terminal(f, 'missing')).status).toBe('failed');
    await officialInput(f);
    f.state.revision = null;
    f.operations.submit({ requestId: 'no-revision', action: 'checkpoint' });
    expect((await terminal(f, 'no-revision')).status).toBe('failed');
    expect(f.usage.snapshot().official?.version).toBe(1);
    await resume(f);
    await reservation(f);
    await f.journal.append(record('root', 'REVOKED'));
    await f.usage.markRetiring('root');
    await f.usage.markRemoteConfirmed('root');
    await officialInput(f);
    f.state.readiness = { ...f.state.readiness, historyComplete: false };
    f.operations.submit({ requestId: 'lost-history', action: 'checkpoint' });
    expect((await terminal(f, 'lost-history')).status).toBe('succeeded');
    expect(f.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    expect(f.bindings.canResume()).toBe(false);
  });

  it.each([
    { remainingMinutes: -1 },
    { projectAlias: 'foreign' },
    { checkedBy: 'example' },
    { checkedAtEpochMs: EPOCH + 1_000_000 },
    { unexpected: 'private-data' },
  ])('rejects invalid official file %j', async (input) => {
    const f = await setup();
    await officialInput(f, input);
    f.operations.submit({ requestId: 'invalid-checkpoint', action: 'checkpoint' });
    expect((await terminal(f, 'invalid-checkpoint')).status).toBe('failed');
    expect(f.usage.snapshot().official?.version).toBe(1);
    expect(JSON.stringify(f.operations.getStatus())).not.toContain('private-data');
  });

  it('rechecks cancellation and official freshness inside the real usage persistence queue', async () => {
    const f = await setup();
    await resume(f);
    const gate = deferred<void>();
    releases.push(() => gate.resolve());
    const original = f.usageStore.write.bind(f.usageStore);
    const called = deferred<void>();
    vi.spyOn(f.usageStore, 'write').mockImplementationOnce(async (data) => {
      called.resolve();
      await gate.promise;
      return original(data);
    });
    const reserving = f.usage.reserve({
      reservationId: 'slow',
      matchId: 'm',
      purpose: 'public',
      slots: 6,
      expectedMinutes: 5,
      expectedBytes: 1000,
      margin: 0,
    });
    await called.promise;
    const controller = new AbortController();
    f.clock.now = EPOCH + 1;
    const cancelled = f.usage.reconcileOfficial(
      { ...f.official, checkedAtEpochMs: EPOCH + 1 },
      { periodId: 'fixture-period', version: 2 },
      { beforeCommit: () => !controller.signal.aborted },
    );
    controller.abort();
    gate.resolve();
    await reserving;
    expect(await cancelled).toMatchObject({ status: 'rejected' });
    expect(f.usage.snapshot().official?.version).toBe(1);
  });

  it('rejects an official checkpoint that becomes stale while queued behind fsync', async () => {
    const f = await setup();
    await resume(f);
    const gate = deferred<void>();
    const called = deferred<void>();
    releases.push(() => gate.resolve());
    const original = f.usageStore.write.bind(f.usageStore);
    vi.spyOn(f.usageStore, 'write').mockImplementationOnce(async (data) => {
      called.resolve();
      await gate.promise;
      return original(data);
    });
    const reserving = f.usage.reserve({
      reservationId: 'slow',
      matchId: 'm',
      purpose: 'public',
      slots: 6,
      expectedMinutes: 5,
      expectedBytes: 1000,
      margin: 0,
    });
    await called.promise;
    f.clock.now = EPOCH + 1;
    const reconciling = f.usage.reconcileOfficial(
      { ...f.official, checkedAtEpochMs: EPOCH + 1 },
      { periodId: 'fixture-period', version: 2 },
    );
    f.clock.now += f.config.officialBudgetMaxAgeMs + 1;
    gate.resolve();
    await reserving;
    expect(await reconciling).toEqual({ status: 'rejected', code: 'INVALID_OFFICIAL_CHECKPOINT' });
    expect(f.usage.snapshot().official?.version).toBe(1);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects a checkpoint with an invalid current clock %s',
    async (now) => {
      const f = await setup();
      f.clock.now = now;
      expect(
        await f.usage.reconcileOfficial(f.official, { periodId: 'fixture-period', version: 2 }),
      ).toEqual({ status: 'rejected', code: 'INVALID_OFFICIAL_CHECKPOINT' });
      expect(f.usage.snapshot().official?.version).toBe(1);
      f.clock.now = EPOCH;
    },
  );

  it('does not release a remotely confirmed reservation using stale official evidence', async () => {
    const f = await setup();
    await resume(f);
    await reservation(f);
    await f.usage.markRetiring('root');
    await f.usage.markRemoteConfirmed('root');
    f.clock.now += 1;
    await f.usage.reconcileOfficial(
      { ...f.official, checkedAtEpochMs: f.clock.now },
      { periodId: 'fixture-period', version: 2 },
    );
    f.clock.now += f.config.officialBudgetMaxAgeMs + 1;
    expect(
      await f.usage.releaseConfirmed('root', {
        remoteConfirmed: true,
        periodId: 'fixture-period',
        version: 2,
      }),
    ).toBe(false);
    expect(f.usage.snapshot()).toMatchObject({
      activeMinutes: 30,
      reservations: [{ status: 'AWAITING_OFFICIAL' }],
    });
  });

  it('actual GrantIssuer refuses a grant if drain arrives during signing', async () => {
    const f = await setup();
    await resume(f);
    const registry = new MediaGenerationRegistry('e-fixture');
    registry.observe(practiceFrame);
    const gate = deferred<string>();
    const signing = deferred<void>();
    releases.push(() => gate.resolve('synthetic-token'));
    const issuer = new GrantIssuer({
      config: f.config,
      registry,
      nowEpochMs: () => f.clock.now,
      capability: () => localCapability,
      canIssue: () => f.bindings.canIssue(),
      reserve: async (generation) =>
        (
          await f.usage.reserve({
            reservationId: generation.reservationId,
            matchId: 'm',
            purpose: 'public',
            slots: 6,
            expectedMinutes: 5,
            expectedBytes: 1000,
            margin: 0,
          })
        ).status === 'reserved',
      persist: async (generation) => {
        await f.journal.append({
          ...record(generation.reservationId),
          identity: generation.identity,
          roomName: generation.roomName,
          serverEpoch: generation.serverEpoch,
          expiresAtEpochMs: generation.expiresAtEpochMs,
        });
      },
      retire: (generation) => {
        generation.terminal = true;
      },
      lock: () => f.bindings.setAdmission('LOCKED'),
      onPrepared: () => {},
      sign: async () => {
        signing.resolve();
        return gate.promise;
      },
    });
    const preparing = issuer.prepare(prepareRequest);
    await signing.promise;
    f.operations.submit({ requestId: 'drain', action: 'drain' });
    gate.resolve('synthetic-token');
    expect((await preparing).status).not.toBe('ready');
    expect(f.usage.snapshot().activeMinutes).toBe(30);
    expect(f.bindings.canIssue()).toBe(false);
  });

  it('cannot resume while a timed-out official checkpoint still has a pending disk write', async () => {
    const f = await setup({ operationTimeoutMs: 80 });
    await resume(f);
    await officialInput(f);
    const writing = deferred<void>();
    const gate = deferred<void>();
    releases.push(() => gate.resolve());
    const original = f.usageStore.write.bind(f.usageStore);
    vi.spyOn(f.usageStore, 'write').mockImplementationOnce(async (data) => {
      writing.resolve();
      await gate.promise;
      return original(data);
    });
    f.operations.submit({ requestId: 'checkpoint', action: 'checkpoint' });
    await writing.promise;
    expect(await terminal(f, 'checkpoint')).toMatchObject({
      status: 'failed',
      code: 'OPERATION_TIMEOUT',
    });
    f.operations.submit({ requestId: 'resume-too-early', action: 'resume' });
    expect((await terminal(f, 'resume-too-early')).status).toBe('failed');
    gate.resolve();
    await vi.waitFor(() => expect(f.usage.snapshot().official?.version).toBe(2));
    expect(f.operations.getSnapshot('checkpoint')?.status).toBe('failed');
    expect(f.bindings.canIssue()).toBe(false);
    await resume(f, 'resume-after-write');
  });
});

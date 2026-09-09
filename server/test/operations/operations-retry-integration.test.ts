import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveKitGateway, type GatewayClient } from '../../src/media/LiveKitGateway.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import { OperationsAudit } from '../../src/operations/OperationsAudit.js';
import { OperationsBindings } from '../../src/operations/OperationsBindings.js';
import { OperationsController } from '../../src/operations/OperationsController.js';
import {
  RevocationRetryBindings,
  validateRetryCheckpoint,
} from '../../src/operations/RevocationRetryBindings.js';
import type { RetryIntent } from '../../src/operations/RevocationRetries.js';
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
const pendingGates: (() => void)[] = [];

async function setup(options: { targets?: number; unknownWait?: boolean; apiCap?: number } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e14-operations-retry-'));
  const journal = new OperationJournal({ opsDataDir: dir });
  await journal.restore();
  const clock = { ms: 0 };
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
  const advance = (amount: number) => {
    clock.ms += amount;
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
      if (timer.at <= clock.ms && timers.delete(timer)) timer.callback();
    }
  };
  const api = new ApiBudget({
    monotonicNow: () => clock.ms,
    maxNormalCallsPer60s: options.apiCap ?? 600,
    maxTotalCallsPer60s: options.apiCap ?? 900,
    ...timing,
  });
  const remove = vi.fn<GatewayClient['removeParticipant']>(async () => undefined);
  const list = vi.fn<GatewayClient['listParticipants']>(async () => []);
  // These two methods replace transport only; every coordinator component below is real.
  const gateway = new LiveKitGateway(
    {
      httpUrl: 'https://fixture.invalid',
      apiKey: 'synthetic-key',
      apiSecret: 'synthetic-secret-no-cloud-access',
    },
    api,
    {
      monotonicNow: () => clock.ms,
      clientFactory: () =>
        ({ removeParticipant: remove, listParticipants: list }) as unknown as GatewayClient,
    },
  );
  const usage = new UsageBudget({
    store: new UsageCheckpoint({ opsDataDir: dir, isWritable: () => journal.writable }),
    projectAlias: 'local-fixture',
    officialBudgetMaxAgeMs: 3_600_000,
    now: () => EPOCH + clock.ms,
    canIssue: () => ({ allowed: true }),
  });
  await usage.restore({ allowInitializeMissing: true });
  await usage.reconcileOfficial(
    {
      projectAlias: 'local-fixture',
      remainingMinutes: 5000,
      remainingBytes: 10_000_000_000,
      checkedAtEpochMs: EPOCH,
      source: 'cloud-dashboard',
      checkedBy: 'synthetic-test-operator',
    },
    { periodId: 'fixture-billing-period', version: 1 },
  );
  await usage.reserve({
    reservationId: 'shared-room-reservation',
    matchId: 'm',
    purpose: 'public',
    slots: 6,
    expectedMinutes: 5,
    expectedBytes: 1000,
    margin: 1,
  });
  const registry = new MediaGenerationRegistry('e-fixture');
  registry.observe({
    ...practiceFrame,
    participants: Array.from({ length: options.targets ?? 1 }, (_, index) => ({
      ...practiceFrame.participants[0]!,
      playerId: `p${index}`,
    })),
  });
  const generations = Array.from({ length: options.targets ?? 1 }, (_, index) =>
    registry.allocate({ ...prepareRequest, playerId: `p${index}` }, EPOCH - 20_000),
  );
  const intents: RetryIntent[] = [];
  for (const [index, generation] of generations.entries()) {
    generation.reservationId = 'shared-room-reservation';
    generation.state = 'UNRESOLVED';
    generation.terminal = true;
    const intent: RetryIntent = {
      retirementId: `retirement-${index}`,
      reservationId: generation.reservationId,
      identity: generation.identity,
      generation: generation.generation,
      firstRetireEpochMs: EPOCH - 10_000,
      lastAttemptEpochMs: EPOCH - 3_000,
      nextAttemptEpochMs: null,
      attempt: 3,
      status: 'UNRESOLVED',
      alarmed: true,
      providerWaitUnknown: options.unknownWait === true,
    };
    intents.push(intent);
    await journal.append({
      state: 'UNRESOLVED',
      namespace: 'e-fixture',
      matchId: generation.request.matchId,
      mediaInstanceId: generation.request.mediaInstanceId,
      roomName: generation.roomName,
      serverEpoch: generation.serverEpoch,
      identity: generation.identity,
      generation: generation.generation,
      issuedAtEpochMs: generation.issuedAtEpochMs,
      expiresAtEpochMs: generation.expiresAtEpochMs,
      reservationId: generation.reservationId,
      retirementId: intent.retirementId,
      firstRetireAtEpochMs: intent.firstRetireEpochMs,
      attempt: intent.attempt,
      atEpochMs: EPOCH,
    });
  }
  const checkpoint = new CheckpointStore<readonly RetryIntent[]>({
    opsDataDir: dir,
    fileName: 'retry-checkpoint.json',
    validate: validateRetryCheckpoint,
    isWritable: () => journal.writable,
  });
  const initialCheckpoint = { lastSeq: journal.snapshot().lastSeq, state: intents };
  await checkpoint.write(initialCheckpoint);
  const retirements = new RevocationRetryBindings({
    namespace: 'e-fixture',
    journal,
    checkpoint,
    initialCheckpoint,
    initialJournalRecords: journal.snapshot().records,
    usageBudget: usage,
    gateway,
    generations: () => registry.all(),
    capability: () => localCapability,
    monotonicNow: () => clock.ms,
    epochNowMs: () => EPOCH + clock.ms,
    stopPermissions: () => {},
    onOccupancyEnded: async (generation) => {
      expect(
        journal.snapshot().records.find(({ record }) => record.identity === generation.identity)
          ?.record.state,
      ).toBe('REVOKED');
    },
    lockIssuance: () => {},
    onUnresolved: () => {},
    ...timing,
  });
  await retirements.restoreRetries();
  const bindings = new OperationsBindings({
    config: { ...localConfiguration(EPOCH), opsDataDir: dir },
    journal,
    usageBudget: usage,
    // Explicit component fixture, never evidence that E-15/product readiness is implemented.
    getReadiness: () => ({
      state: 'READY',
      historyComplete: true,
      unresolvedCount: 0,
      reasonCodes: [],
    }),
    getGameActivity: () => ({ activeMatches: 0, activePractices: 0, pendingAdmissions: 0 }),
    retries: [retirements.retries],
    nowEpochMs: () => EPOCH + clock.ms,
    // Explicit fixture-only proof; no provider period is inferred from wall-clock time.
    getOfficialRevision: () => ({ periodId: 'fixture-billing-period', version: 1 }),
  });
  const audit = new OperationsAudit({
    opsDataDir: dir,
    nowEpochMs: () => EPOCH + clock.ms,
    actorAlias: 'synthetic-test-operator',
    isWritable: () => journal.writable,
    allowMissingHistory: () => true,
  });
  const controller = new OperationsController({
    nowEpochMs: () => EPOCH + clock.ms,
    monotonicNow: () => clock.ms,
    timeoutMs: 1000,
    setAdmission: (value) => bindings.setAdmission(value),
    getStatus: () => bindings.getStatus(),
    canResume: () => bindings.canResume(),
    canComplete: (command) => bindings.canComplete(command),
    run: (command, signal, guard) => bindings.run(command, signal, guard),
    auditStore: audit,
  });
  await controller.initializeAudit();
  cleanup.push(async () => {
    await controller.close();
    await bindings.close();
    api.close();
    await retirements.close();
    await checkpoint.close();
    await usage.close();
    await journal.close();
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('kkakkung-e14-operations-retry-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(dir, { recursive: true, force: true });
  });
  const submit = (requestId = 'operation-1', retirementId = 'retirement-0') =>
    controller.submit({ requestId, action: 'retry-retirement', retirementId });
  const terminal = async (requestId = 'operation-1') => {
    await vi.waitFor(() => {
      const status = controller.getSnapshot(requestId)?.status;
      expect(['succeeded', 'failed']).toContain(status);
      expect(audit.get(requestId)?.snapshot.status).toBe(status);
    });
    return controller.getSnapshot(requestId)!;
  };
  return {
    dir,
    journal,
    usage,
    api,
    gateway,
    remove,
    list,
    generations,
    checkpoint,
    retirements,
    bindings,
    audit,
    controller,
    clock,
    advance,
    submit,
    terminal,
  };
}

afterEach(async () => {
  for (const release of pendingGates.splice(0)) release();
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});

describe('E-14 operator retry with real E storage, budgets and retirement bindings', () => {
  it('retries only the selected unresolved target and keeps another target reserved', async () => {
    const f = await setup({ targets: 2 });
    expect(f.submit()).toMatchObject({ status: 'accepted', snapshot: { status: 'pending' } });
    expect(await f.terminal()).toMatchObject({ status: 'succeeded' });
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.remove.mock.calls[0]?.[1]).toBe(f.generations[0]!.identity);
    expect(f.retirements.retries.snapshot().map((intent) => intent.status)).toEqual([
      'REVOKED',
      'UNRESOLVED',
    ]);
    expect(f.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(f.controller.getStatus()).toMatchObject({ admission: 'DRAINING', unresolvedCount: 1 });
  });

  it('persists REVOKED and remote-confirmed usage before terminal success without releasing usage', async () => {
    const f = await setup();
    f.api.lockNormal();
    const accepted = f.submit();
    expect(await f.terminal()).toMatchObject({ status: 'succeeded', code: null });
    expect(f.journal.snapshot().records[0]?.record.state).toBe('REVOKED');
    expect(await f.checkpoint.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: { state: [{ status: 'REVOKED' }] },
    });
    expect(f.usage.snapshot()).toMatchObject({
      activeMinutes: 60,
      reservations: [{ status: 'AWAITING_OFFICIAL', releasedAtEpochMs: null }],
    });
    expect(f.api.getSnapshot()).toMatchObject({ total60s: 2, normal60s: 0, normalLocked: true });
    expect(f.submit()).toMatchObject({
      status: 'accepted',
      snapshot: {
        operationId: accepted.status === 'accepted' ? accepted.snapshot.operationId : '',
      },
    });
    expect(f.remove).toHaveBeenCalledTimes(1);
    const auditText = await fs.readFile(path.join(f.dir, 'operations-audit.json'), 'utf8');
    expect(auditText).not.toContain(f.generations[0]!.identity);
    expect(auditText).not.toContain('synthetic-secret-no-cloud-access');
  });

  it('rejects a bare retry while the provider wait remains unknown', async () => {
    const f = await setup({ unknownWait: true });
    f.submit();
    expect(await f.terminal()).toMatchObject({ status: 'failed', code: 'OPERATION_FAILED' });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.retirements.retries.snapshot()[0]?.providerWaitUnknown).toBe(true);
    expect(f.api.getSnapshot().total60s).toBe(0);
  });

  it('rejects an unknown or already confirmed retirement instead of reporting another removal', async () => {
    const f = await setup();
    f.submit('missing-operation', 'missing-retirement');
    expect(await f.terminal('missing-operation')).toMatchObject({ status: 'failed' });
    expect(f.remove).not.toHaveBeenCalled();
    f.submit('valid-operation');
    expect(await f.terminal('valid-operation')).toMatchObject({ status: 'succeeded' });
    f.submit('already-complete-operation');
    expect(await f.terminal('already-complete-operation')).toMatchObject({ status: 'failed' });
    expect(f.remove).toHaveBeenCalledTimes(1);
  });

  it('cannot bypass the shared total API budget for operator cleanup', async () => {
    const f = await setup({ apiCap: 1 });
    await f.gateway.listParticipants('unrelated-fixture-room', {
      requestId: 'prior-cleanup',
      deadlineMs: 1000,
      priority: 'cleanup',
    });
    f.submit();
    await vi.waitFor(() => expect(f.api.getSnapshot().pendingCleanup).toBe(1));
    f.advance(1001);
    expect(await f.terminal()).toMatchObject({ status: 'failed', code: 'OPERATION_TIMEOUT' });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.api.getSnapshot().total60s).toBe(1);
    expect(f.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(f.controller.getStatus().admission).toBe('DRAINING');
  });

  it('keeps timeout failed and forbids a new participant query after a late removal ACK', async () => {
    const f = await setup();
    const gate = deferred<void>();
    pendingGates.push(() => gate.resolve());
    f.remove.mockImplementation(async () => gate.promise);
    f.submit();
    await vi.waitFor(() => expect(f.remove).toHaveBeenCalledTimes(1));
    f.advance(1001);
    expect(await f.terminal()).toMatchObject({ status: 'failed', code: 'OPERATION_TIMEOUT' });
    gate.resolve();
    await vi.waitFor(() => expect(f.api.getSnapshot().inFlight).toBe(0));
    await f.retirements.close();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.journal.snapshot().records[0]?.record.state).toBe('UNRESOLVED');
    expect(f.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(f.controller.getStatus().admission).toBe('DRAINING');
    expect(f.controller.getSnapshot('operation-1')?.code).toBe('OPERATION_TIMEOUT');
  });

  it('preserves already-dispatched late absence proof but never changes timeout to success or OPEN', async () => {
    const f = await setup();
    const gate = deferred<void>();
    pendingGates.push(() => gate.resolve());
    f.list.mockImplementation(async () => {
      await gate.promise;
      return [];
    });
    f.submit();
    await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(1));
    f.advance(1001);
    expect(await f.terminal()).toMatchObject({ status: 'failed', code: 'OPERATION_TIMEOUT' });
    gate.resolve();
    await vi.waitFor(() => expect(f.retirements.retries.snapshot()[0]?.status).toBe('REVOKED'));
    expect(f.journal.snapshot().records[0]?.record.state).toBe('REVOKED');
    expect(f.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    expect(f.controller.getStatus().admission).toBe('DRAINING');
    expect(f.controller.getSnapshot('operation-1')).toMatchObject({
      status: 'failed',
      code: 'OPERATION_TIMEOUT',
    });
    expect(f.audit.get('operation-1')?.snapshot.status).toBe('failed');
  });
});

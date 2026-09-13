import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveKitGateway, type GatewayClient } from '../../src/media/LiveKitGateway.js';
import {
  MediaGenerationRegistry,
  type Generation,
} from '../../src/media/MediaGenerationRegistry.js';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import { OperationJournal, type JournalEntry } from '../../src/operations/OperationJournal.js';
import {
  RevocationRetryBindings,
  validateRetryCheckpoint,
  type RevocationRetryBindingsOptions,
} from '../../src/operations/RevocationRetryBindings.js';
import type { RetryIntent } from '../../src/operations/RevocationRetries.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint } from '../../src/operations/UsageCheckpoint.js';
import { ownedMediaRooms, ownedMediaTargets } from '../../src/operations/SplitMediaOwnership.js';
import {
  deferred,
  localCapability,
  practiceFrame,
  prepareRequest,
} from '../media/generation-fixtures.js';

const cleanup: (() => Promise<void>)[] = [];
const epoch = 1_800_000_000_000;

async function setup(participants = 1) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e-retry-bindings-'));
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
  const advance = (ms: number) => {
    clock.ms += ms;
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
      if (timer.at <= clock.ms && timers.delete(timer)) timer.callback();
    }
  };
  const api = new ApiBudget({
    monotonicNow: () => clock.ms,
    maxNormalCallsPer60s: 600,
    maxTotalCallsPer60s: 900,
    ...timing,
  });
  const remove = vi.fn<GatewayClient['removeParticipant']>(async () => {});
  const list = vi.fn<GatewayClient['listParticipants']>(async () => []);
  // Only the network transport is replaced; journal, budget, gateway, barrier and retries are real.
  const gateway = new LiveKitGateway(
    {
      httpUrl: 'https://fixture.invalid',
      apiKey: 'local-fixture-key',
      apiSecret: 'local-fixture-secret',
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
    now: () => epoch + clock.ms,
    canIssue: () => ({ allowed: true }),
  });
  await usage.restore({ allowInitializeMissing: true });
  const official = {
    projectAlias: 'local-fixture',
    remainingMinutes: 5000,
    remainingBytes: 10_000_000_000,
    checkedAtEpochMs: epoch,
    source: 'cloud-dashboard' as const,
    checkedBy: 'operator-e-local-fixture',
  };
  await usage.reconcileOfficial(official, { periodId: '2026-09', version: 1 });
  const registry = new MediaGenerationRegistry('e-fixture');
  registry.observe({
    ...practiceFrame,
    participants: Array.from({ length: participants }, (_, index) => ({
      ...practiceFrame.participants[0]!,
      playerId: `p${index}`,
    })),
  });
  const generations = Array.from({ length: participants }, (_, index) =>
    registry.allocate({ ...prepareRequest, playerId: `p${index}` }, epoch),
  );
  for (const generation of generations) generation.reservationId = 'shared-room-reservation';
  await usage.reserve({
    reservationId: 'shared-room-reservation',
    matchId: 'm',
    purpose: 'public',
    slots: 6,
    expectedMinutes: 5,
    expectedBytes: 1000,
    margin: 1,
  });
  const checkpoint = new CheckpointStore<readonly RetryIntent[]>({
    opsDataDir: dir,
    fileName: 'retry-checkpoint.json',
    validate: validateRetryCheckpoint,
    isWritable: () => journal.writable,
  });
  const ended = vi.fn(async (generation: Generation) => {
    const entries = await records();
    expect(
      entries.filter((entry) => entry.record.identity === generation.identity).at(-1)?.record.state,
    ).toBe('REVOKED');
  });
  const lock = vi.fn();
  const alarm = vi.fn();
  const options: RevocationRetryBindingsOptions = {
    namespace: 'e-fixture',
    journal,
    checkpoint,
    initialCheckpoint: { lastSeq: 0, state: [] },
    usageBudget: usage,
    gateway,
    generations: () => registry.all(),
    capability: () => localCapability,
    monotonicNow: () => clock.ms,
    epochNowMs: () => epoch + clock.ms,
    stopPermissions: vi.fn(),
    onOccupancyEnded: ended,
    lockIssuance: lock,
    onUnresolved: alarm,
    ...timing,
  };
  const bindings = new RevocationRetryBindings(options);
  async function records(): Promise<JournalEntry[]> {
    return (await fs.readFile(journal.filePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as JournalEntry);
  }
  cleanup.push(async () => {
    await bindings.close().catch(() => {});
    api.close();
    await journal.close();
    if (
      !path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(dir).startsWith('kkakkung-e-retry-bindings-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(dir, { recursive: true, force: true });
  });
  const request = (index = 0) => ({
    requestId: `retire-${index}`,
    matchId: 'm',
    mediaInstanceId: 'practice',
    playerId: `p${index}`,
    receiverGeneration: 1,
    reason: 'phase-change' as const,
  });
  return {
    bindings,
    journal,
    checkpoint,
    api,
    usage,
    registry,
    generations,
    remove,
    list,
    ended,
    lock,
    alarm,
    clock,
    advance,
    request,
    records,
    official,
    options,
  };
}

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});

describe('E-11 composition with real local storage; no Cloud network calls', () => {
  it.each(['success', 'clone-failure', 'clone-remains'] as const)(
    'retires a complete split generation before confirming its occupancy: %s',
    async (outcome) => {
      const s = await setup();
      const generation = s.generations[0]!;
      const room = () => `e-fixture--${generation.serverEpoch}--${randomUUID()}`;
      generation.splitOwnership = {
        faceRoomName: room(),
        faceIdentity: randomUUID(),
        receiverRoomNames: [room(), room()],
      };
      const targets = ownedMediaTargets(generation);
      const last = targets.at(-1)!;
      s.remove.mockImplementation(async (roomName, identity) => {
        expect(s.journal.snapshot().records.at(-1)?.record.splitOwnership).toEqual(
          generation.splitOwnership,
        );
        expect(s.ended).not.toHaveBeenCalled();
        if (outcome === 'clone-failure' && roomName === last.roomName && identity === last.identity)
          throw new Error('clone-failure');
      });
      if (outcome === 'clone-remains')
        s.list.mockImplementation(
          async (roomName) =>
            (roomName === last.roomName ? [{ identity: last.identity }] : []) as Awaited<
              ReturnType<GatewayClient['listParticipants']>
            >,
        );
      const result = await s.bindings.retire(s.request());
      expect(s.remove.mock.calls.map(([roomName, identity]) => ({ roomName, identity }))).toEqual(
        targets,
      );
      if (outcome === 'success') {
        expect(result.status).toBe('confirmed');
        expect(s.ended).toHaveBeenCalledTimes(1);
        expect(s.list.mock.calls.map(([roomName]) => roomName)).toEqual(
          ownedMediaRooms(generation),
        );
        expect(generation.state).toBe('REVOKED');
      } else {
        expect(result.status).toBe('unknown');
        expect(s.ended).not.toHaveBeenCalled();
        expect(s.usage.snapshot().reservations[0]?.remoteConfirmedAtEpochMs).toBeNull();
        expect(generation.state).toBe('UNRESOLVED');
        expect(s.lock).toHaveBeenCalled();
      }
    },
  );
  it('persists each attempt before dispatch, computes a fresh cutoff, and keeps usage until official reconciliation', async () => {
    const s = await setup();
    s.remove.mockRejectedValueOnce(new Error('local transport timeout'));
    expect(await s.bindings.retire(s.request())).toMatchObject({ status: 'unknown' });
    expect(s.remove).toHaveBeenCalledTimes(1);
    const disk = deferred<void>();
    const writing = deferred<void>();
    const originalWrite = s.checkpoint.write.bind(s.checkpoint);
    vi.spyOn(s.checkpoint, 'write').mockImplementation(async (input) => {
      if (input.state[0]?.attempt === 1 && input.state[0].status === 'REVOKING') {
        writing.resolve();
        await disk.promise;
      }
      await originalWrite(input);
    });
    s.clock.ms += 1000;
    const retry = s.bindings.retries.retryNow('retire-0');
    await writing.promise;
    expect(s.bindings.canPruneConfirmed(new Set(['shared-room-reservation']))).toBe(false);
    expect(s.remove).toHaveBeenCalledTimes(1);
    disk.resolve();
    expect(await retry).toMatchObject({ status: 'REVOKED', attempt: 1 });
    expect(s.remove.mock.calls.map((call) => call[2]?.revokeTokenTs)).toEqual([
      1_800_000_002n,
      1_800_000_003n,
    ]);
    expect(s.api.getSnapshot().total60s).toBe(3);
    expect(s.ended).toHaveBeenCalledOnce();
    expect(s.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    expect(s.usage.snapshot().activeMinutes).toBe(60);
    expect(await s.checkpoint.read()).toMatchObject({
      integrity: 'ok',
      checkpoint: { state: [{ status: 'REVOKED', attempt: 1 }] },
    });
    const written = await s.checkpoint.read();
    expect(written.integrity === 'ok' && written.checkpoint.lastSeq).toBe(
      (await s.records()).at(-1)?.seq,
    );
    expect(
      await s.usage.releaseConfirmed('shared-room-reservation', {
        remoteConfirmed: true,
        periodId: '2026-09',
        version: 1,
      }),
    ).toBe(false);
    s.clock.ms++;
    expect(
      await s.bindings.reconcileOfficial(
        { ...s.official, checkedAtEpochMs: epoch + s.clock.ms },
        { periodId: '2026-09', version: 2 },
      ),
    ).toEqual({ status: 'applied' });
    expect(s.usage.snapshot().reservations[0]?.status).toBe('RELEASED');
    s.clock.ms += 86_400_000;
    const roots = new Set(['shared-room-reservation']);
    expect(s.bindings.canPruneConfirmed(roots)).toBe(true);
    await s.bindings.pruneConfirmed(roots, () => s.journal.writable);
    expect(s.bindings.retries.snapshot()).toEqual([]);
    // Only the orchestrator may remove the shared on-disk proof after both owners have pruned.
    expect(await s.checkpoint.read()).toMatchObject({
      checkpoint: { state: [{ status: 'REVOKED' }] },
    });
  });

  it('keeps the six-person room reservation until every generation is durably revoked', async () => {
    const s = await setup(6);
    await s.bindings.retire(s.request());
    s.clock.ms++;
    await s.bindings.reconcileOfficial(
      { ...s.official, checkedAtEpochMs: epoch + s.clock.ms },
      { periodId: '2026-09', version: 2 },
    );
    expect(s.usage.snapshot().reservations[0]?.status).toBe('ACTIVE');
    expect(s.usage.snapshot().activeMinutes).toBe(60);
    for (let index = 1; index < 6; index++) await s.bindings.retire(s.request(index));
    expect(s.ended).toHaveBeenCalledTimes(6);
    expect(s.usage.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    s.clock.ms++;
    await s.bindings.reconcileOfficial(
      { ...s.official, checkedAtEpochMs: epoch + s.clock.ms },
      { periodId: '2026-09', version: 3 },
    );
    expect(s.usage.snapshot().activeMinutes).toBe(0);
  });

  it('sends cleanup through the real gateway after the 600-call normal allowance is exhausted', async () => {
    const s = await setup();
    for (let index = 0; index < 600; index++)
      await s.api.dispatch({
        requestId: `normal-${index}`,
        method: 'fixture',
        target: 'fixture',
        kind: 'query',
        priority: 'normal',
        deadlineMs: 1000,
        run: async () => {},
      });
    expect(await s.bindings.retire(s.request())).toMatchObject({ status: 'confirmed' });
    expect(s.api.getSnapshot()).toMatchObject({ normal60s: 600, total60s: 602 });
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.list).toHaveBeenCalledOnce();
  });

  it('sends zero additional network requests at the 900-call total cap', async () => {
    const s = await setup();
    for (let index = 0; index < 900; index++)
      await s.api.dispatch({
        requestId: `cleanup-${index}`,
        method: 'fixture',
        target: 'fixture',
        kind: 'query',
        priority: 'cleanup',
        deadlineMs: 1000,
        run: async () => {},
      });
    const retiring = s.bindings.retire(s.request());
    await vi.waitFor(() => expect(s.api.getSnapshot().pendingCleanup).toBe(1));
    s.advance(1000);
    expect(await retiring).toMatchObject({ status: 'unknown' });
    expect(s.api.getSnapshot().total60s).toBe(900);
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.list).not.toHaveBeenCalled();
    expect(s.usage.snapshot().activeMinutes).toBe(60);
  });

  it('honors provider 429 retry-after and blocks a missing provider wait until explicit confirmation', async () => {
    const s = await setup();
    s.remove.mockRejectedValueOnce({
      status: 429,
      code: 'resource_exhausted',
      metadata: { retry_after_ms: '3000' },
    });
    await s.bindings.retire(s.request());
    await expect(s.bindings.retries.retryNow('retire-0')).rejects.toThrow('RETRY_NOT_DUE');
    s.clock.ms = 3000;
    s.remove.mockRejectedValueOnce({ status: 429, code: 'resource_exhausted' });
    expect(await s.bindings.retries.retryNow('retire-0')).toMatchObject({
      status: 'UNRESOLVED',
      providerWaitUnknown: true,
    });
    expect(s.alarm).toHaveBeenCalledOnce();
    await expect(s.bindings.retries.retryNow('retire-0')).rejects.toThrow(
      'PROVIDER_WAIT_UNCONFIRMED',
    );
    expect(s.remove).toHaveBeenCalledTimes(2);
    expect(
      await s.bindings.retries.retryNow('retire-0', { providerWaitConfirmed: true }),
    ).toMatchObject({ status: 'REVOKED' });
    expect(s.remove).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the retry checkpoint cannot be written', async () => {
    const s = await setup();
    s.remove.mockRejectedValueOnce(new Error('local transport timeout'));
    vi.spyOn(s.checkpoint, 'write').mockRejectedValue(new Error('local disk failure'));
    await expect(s.bindings.retire(s.request())).rejects.toThrow('local disk failure');
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.ended).not.toHaveBeenCalled();
    expect(s.lock).toHaveBeenCalledWith('JOURNAL_WRITE_FAILED');
    expect(s.usage.snapshot().activeMinutes).toBe(60);
  });

  it('rejects a retry after identity/generation/reservation no longer names the terminal generation', async () => {
    const s = await setup();
    s.remove.mockRejectedValueOnce(new Error('local transport timeout'));
    await s.bindings.retire(s.request());
    s.generations[0]!.generation = 2;
    s.clock.ms = 1000;
    await expect(s.bindings.retries.retryNow('retire-0')).rejects.toThrow(
      'RETRY_GENERATION_MISSING',
    );
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.ended).not.toHaveBeenCalled();
  });

  it('does not overwrite durable REVOKED with an overdue unresolved retry intent', async () => {
    const s = await setup();
    s.remove.mockRejectedValueOnce(new Error('local transport timeout'));
    await s.bindings.retire(s.request());
    const hold = deferred<void>();
    const entered = deferred<void>();
    s.ended.mockImplementationOnce(async () => {
      entered.resolve();
      await hold.promise;
    });
    s.clock.ms = 1000;
    const retry = s.bindings.retries.retryNow('retire-0');
    await entered.promise;
    s.advance(9000);
    await vi.waitFor(() => expect(s.alarm).toHaveBeenCalledOnce());
    expect((await s.records()).at(-1)?.record.state).toBe('REVOKED');
    hold.resolve();
    expect(await retry).toMatchObject({ status: 'REVOKED' });
  });

  it('blocks dispatch after close even when initial retirement was waiting for its journal write', async () => {
    const s = await setup();
    const disk = deferred<void>();
    const entered = deferred<void>();
    const original = s.journal.append.bind(s.journal);
    vi.spyOn(s.journal, 'append').mockImplementation(async (record) => {
      if (record.state === 'REVOKING') {
        entered.resolve();
        await disk.promise;
      }
      return original(record);
    });
    const retiring = s.bindings.retire(s.request());
    await entered.promise;
    const closed = vi.fn();
    const closing = s.bindings.close().then(closed);
    expect(closed).not.toHaveBeenCalled();
    await expect(s.bindings.retire(s.request())).rejects.toThrow('RETRY_BINDINGS_CLOSED');
    disk.resolve();
    expect(await retiring).toMatchObject({ status: 'unknown' });
    await closing;
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.ended).not.toHaveBeenCalled();
  });

  it('rechecks the automatic ten-second deadline after the E-10 journal write, before SDK dispatch', async () => {
    const s = await setup();
    s.remove.mockRejectedValueOnce(new Error('local timeout'));
    await s.bindings.retire(s.request());
    const disk = deferred<void>();
    const entered = deferred<void>();
    const original = s.journal.append.bind(s.journal);
    vi.spyOn(s.journal, 'append').mockImplementation(async (record) => {
      if (record.state === 'REVOKING' && record.retirementId === undefined) {
        entered.resolve();
        await disk.promise;
      }
      return original(record);
    });
    s.advance(1000);
    await entered.promise;
    s.advance(9000);
    disk.resolve();
    await vi.waitFor(() => expect(s.generations[0]?.state).toBe('UNRESOLVED'));
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.api.getSnapshot().total60s).toBe(1);
    await vi.waitFor(() => expect(s.alarm).toHaveBeenCalledOnce());
  });

  it('restores durable revocation evidence from the matching journal and rejects missing evidence', async () => {
    const s = await setup();
    s.remove.mockRejectedValueOnce(new Error('local timeout'));
    await s.bindings.retire(s.request());
    s.clock.ms = 1000;
    await s.bindings.retries.retryNow('retire-0');
    await s.bindings.close();
    const read = await s.checkpoint.read();
    if (read.integrity !== 'ok') throw new Error('EXPECTED_CHECKPOINT');
    expect(
      () => new RevocationRetryBindings({ ...s.options, initialCheckpoint: read.checkpoint }),
    ).toThrow('RETRY_CHECKPOINT_AHEAD_OF_JOURNAL');
    const restored = new RevocationRetryBindings({
      ...s.options,
      initialCheckpoint: read.checkpoint,
      initialJournalRecords: await s.records(),
    });
    cleanup.unshift(() => restored.close());
    await restored.restoreRetries();
    s.clock.ms++;
    await restored.reconcileOfficial(
      { ...s.official, checkedAtEpochMs: epoch + s.clock.ms },
      { periodId: '2026-09', version: 2 },
    );
    expect(s.usage.snapshot().activeMinutes).toBe(0);
    expect(s.remove).toHaveBeenCalledTimes(2);
  });

  it('keeps reservations when a terminal generation references a missing reservation root', async () => {
    const s = await setup();
    s.generations[0]!.reservationId = 'missing-reservation-root';
    expect(await s.bindings.retire(s.request())).toMatchObject({ status: 'unknown' });
    expect(s.lock).toHaveBeenCalledWith('RETIREMENT_UNRESOLVED');
    expect(s.usage.snapshot().activeMinutes).toBe(60);
    expect((await s.records()).at(-1)?.record.state).toBe('REVOKED');
  });

  it('reports an unconfirmed reservation release and rejects reconciliation after close', async () => {
    const s = await setup();
    await s.bindings.retire(s.request());
    await expect(
      s.bindings.reconcileOfficial(s.official, { periodId: '2026-09', version: 1 }),
    ).rejects.toThrow('RESERVATION_RELEASE_UNCONFIRMED');
    expect(s.lock).toHaveBeenCalledWith('RETIREMENT_UNRESOLVED');
    expect(s.usage.snapshot().activeMinutes).toBe(60);
    await s.bindings.close();
    await expect(
      s.bindings.reconcileOfficial(s.official, { periodId: '2026-09', version: 1 }),
    ).rejects.toThrow('RETRY_BINDINGS_CLOSED');
  });

  it('waits for initial retirement even when scheduler close fails, then propagates that failure', async () => {
    const s = await setup();
    const disk = deferred<void>();
    const entered = deferred<void>();
    const original = s.journal.append.bind(s.journal);
    vi.spyOn(s.journal, 'append').mockImplementation(async (record) => {
      if (record.state === 'REVOKING') {
        entered.resolve();
        await disk.promise;
      }
      return original(record);
    });
    const retiring = s.bindings.retire(s.request());
    await entered.promise;
    vi.spyOn(s.bindings.retries, 'close').mockRejectedValue(new Error('scheduler close failed'));
    const settled = vi.fn();
    const closing = s.bindings.close();
    void closing.then(settled, settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    disk.resolve();
    expect(await retiring).toMatchObject({ status: 'unknown' });
    await expect(closing).rejects.toThrow('scheduler close failed');
    expect(s.remove).not.toHaveBeenCalled();
  });
});

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParticipantInfo, Room } from 'livekit-server-sdk';
import { createMediaCoordinator } from '../../src/media/MediaCoordinator.js';
import {
  type JournalEntry,
  OperationJournal,
  validateJournalRecord,
} from '../../src/operations/OperationJournal.js';
import {
  isEmptyReservationAbort,
  reservationIntentMatches,
} from '../../src/operations/ReservationIntent.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint, type UsageState } from '../../src/operations/UsageCheckpoint.js';
import { localConfiguration } from '../media/generation-fixtures.js';
import { RETENTION_MS, planDurableRetention } from '../../src/operations/DurableRetentionPlan.js';
import { compactConfirmedRetirements } from '../../src/operations/RetentionPolicy.js';
import { DurableRetention } from '../../src/operations/DurableRetention.js';
import { SharedRetryCheckpoint } from '../../src/operations/SharedRetryCheckpoint.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const directories: string[] = [];
const close: (() => Promise<void>)[] = [];
const epoch = 1_800_000_000_000;
afterEach(async () => {
  for (const stop of close.splice(0).reverse()) await stop();
  for (const dir of directories.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('kkakkung-reservation-crash-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
async function crashAt(boundary: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-reservation-crash-'));
  directories.push(directory);
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'server/test/operations/reservation-crash-child.ts'],
    {
      cwd: root,
      input: JSON.stringify({ directory, boundary, epoch }),
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(19);
  const readRecords = async () =>
    (await fs.readFile(path.join(directory, 'media-journal.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as JournalEntry);
  const readUsage = async () =>
    (
      JSON.parse(await fs.readFile(path.join(directory, 'usage-checkpoint.json'), 'utf8')) as {
        state: UsageState;
      }
    ).state;
  return { directory, readRecords, readUsage };
}
async function recover(directory: string, refuseRevocation = false) {
  const config = {
    ...localConfiguration(epoch),
    subscriptionMode: 'server-forwarding' as const,
    operatingMode: 'continuous' as const,
    opsDataDir: directory,
    maxConcurrentParticipants: 100,
  };
  const remove = vi.fn(async () => {
    if (refuseRevocation) throw { code: 'permission_denied', status: 403 };
  });
  const coordinator = createMediaCoordinator(
    {
      config,
      monotonicNow: () => performance.now(),
      epochNowSeconds: () => (epoch + 1000) / 1000,
      emitMetric: () => {},
      enqueueControl: () => {},
      enqueueBindings: () => {},
      enqueueAudioPolicy: () => {},
      getGameActivity: () => ({ activeMatches: 0, activePractices: 0, pendingAdmissions: 0 }),
    },
    {
      mediaMode: () => 'cloud',
      productSecurityReady: () => true,
      namespaceOwnershipConfirmed: () => true,
      firstInstallationConfirmed: async () => false,
      firstAuditConfirmed: () => false,
      clientFactory: () => ({
        listRooms: async () => [],
        listParticipants: async () => [],
        removeParticipant: remove,
        deleteRoom: async () => {},
        createRoom: async (request) => new Room({ name: request.name }),
        getParticipant: async () => {
          throw { code: 'not_found', status: 404 };
        },
        updateParticipant: async () => new ParticipantInfo(),
        updateSubscriptions: async () => {},
        forwardParticipant: async () => {
          throw new Error('NO_MEDIA_IN_THIS_RECOVERY_TEST');
        },
      }),
    },
  );
  close.push(() => coordinator.close());
  expect(await coordinator.initialize()).toMatchObject({ status: 'initialized' });
  return { coordinator, remove };
}

describe('split reservation write-ahead boundaries: real files and abrupt subprocess exit, synthetic Cloud', () => {
  it.each([
    ['intent-only', 0, 'RESERVING', false],
    ['first-reservation', 1, 'RESERVING', false],
    ['second-rejected', 1, 'RESERVING', false],
    ['all-reserved', 2, 'RESERVING', false],
    ['first-signed', 2, 'COMMITTED', true],
  ] as const)(
    'recovers %s without inventing reservations or issued tokens',
    async (boundary, count, phase, signed) => {
      const f = await crashAt(boundary);
      const before = (await f.readRecords()).at(-1)!.record;
      expect(before.reservationIntent?.phase).toBe(phase);
      expect((await f.readUsage()).reservations).toHaveLength(count);
      expect(
        JSON.parse(await fs.readFile(path.join(f.directory, 'crash-observation.json'), 'utf8')),
      ).toEqual({ boundary, signed });
      const { coordinator, remove } = await recover(f.directory);
      await vi.waitFor(() => expect(coordinator.getReadiness()).toMatchObject({ state: 'READY' }), {
        timeout: 5000,
        interval: 10,
      });
      const final = (await f.readRecords()).at(-1)!.record;
      const usage = await f.readUsage();
      expect(usage.reservations).toHaveLength(count);
      if (count === 0) {
        expect(final.state).toBe('ABORTED');
        expect(isEmptyReservationAbort(final, usage.reservations)).toBe(true);
        expect(remove).not.toHaveBeenCalled();
      } else {
        expect(final.state).toBe('REVOKED');
        expect(remove).toHaveBeenCalledTimes(12);
        expect(
          usage.reservations.every(
            (r) => r.status === 'RELEASED' && r.remoteConfirmedAtEpochMs !== null,
          ),
        ).toBe(true);
      }
      expect(coordinator.canIssue()).toBe(false); // Recovery never reopens admission automatically.
    },
  );

  it('keeps a partial reservation locked when actual remote revocation is rejected', async () => {
    const f = await crashAt('first-reservation');
    const { coordinator, remove } = await recover(f.directory, true);
    await vi.waitFor(() => expect(remove).toHaveBeenCalled(), { timeout: 5000, interval: 10 });
    expect(coordinator.getReadiness().state).toBe('LOCKED');
    expect((await f.readUsage()).reservations[0]!.remoteConfirmedAtEpochMs).toBeNull();
    expect((await f.readRecords()).at(-1)!.record.state).not.toBe('ABORTED');
  });

  it('does not classify a missing usage file as proof of an empty abort', async () => {
    const f = await crashAt('intent-only');
    await fs.rename(
      path.join(f.directory, 'usage-checkpoint.json'),
      path.join(f.directory, 'usage-checkpoint.saved'),
    );
    const { coordinator } = await recover(f.directory);
    expect(coordinator.getReadiness().state).toBe('LOCKED');
    expect((await f.readRecords()).at(-1)!.record.state).not.toBe('ABORTED');
  });

  it('does not write an empty abort while the retry checkpoint is corrupt', async () => {
    const f = await crashAt('intent-only');
    await fs.writeFile(path.join(f.directory, 'revocation-checkpoint.json'), '{');
    const { coordinator } = await recover(f.directory);
    expect(coordinator.getReadiness().state).toBe('LOCKED');
    expect((await f.readRecords()).at(-1)!.record.state).toBe('PREPARED');
  });

  it('rejects partial commit, false empty abort and bypassing the dedicated commit writer', async () => {
    const f = await crashAt('first-reservation');
    const journal = new OperationJournal({ opsDataDir: f.directory });
    const restored = await journal.restore();
    const budget = new UsageBudget({
      store: new UsageCheckpoint({
        opsDataDir: f.directory,
        providerQuota: true,
        isWritable: () => journal.writable,
      }),
      providerQuota: true,
      projectAlias: 'local-fixture',
      officialBudgetMaxAgeMs: 60_000,
      now: () => epoch + 1000,
      canIssue: () => ({ allowed: true }),
    });
    close.push(async () => {
      await budget.close();
      await journal.close();
    });
    await budget.restore();
    const record = restored.records.at(-1)!.record;
    await expect(journal.commitReservation(record, budget.snapshot())).rejects.toThrow(
      'RESERVATION_COMMIT_UNCONFIRMED',
    );
    await expect(journal.abortUnreserved(record, budget.snapshot(), epoch + 1000)).rejects.toThrow(
      'EMPTY_ABORT_UNCONFIRMED',
    );
    await expect(
      journal.append({
        ...record,
        reservationIntent: { ...record.reservationIntent!, phase: 'COMMITTED' },
      }),
    ).rejects.toThrow('RESERVATION_INTENT_MUTATION_REQUIRED');
    expect(await budget.reserve(record.reservationIntent!.requests[1]!)).toMatchObject({
      status: 'reserved',
    });
    await journal.commitReservation(record, budget.snapshot());
    expect(journal.snapshot().records.at(-1)!.record.reservationIntent?.phase).toBe('COMMITTED');
    await expect(journal.abortUnreserved(record, budget.snapshot(), epoch + 1000)).rejects.toThrow(
      'EMPTY_ABORT_UNCONFIRMED',
    );
  });

  it('compacts only an old proven empty abort and rejects unexpected children/changed plans', async () => {
    const f = await crashAt('intent-only');
    const { coordinator } = await recover(f.directory);
    await vi.waitFor(() => expect(coordinator.getReadiness().state).toBe('READY'), {
      timeout: 5000,
      interval: 10,
    });
    await coordinator.close();
    const journal = new OperationJournal({ opsDataDir: f.directory });
    const restored = await journal.restore();
    const budget = new UsageBudget({
      store: new UsageCheckpoint({
        opsDataDir: f.directory,
        providerQuota: true,
        isWritable: () => journal.writable,
      }),
      providerQuota: true,
      projectAlias: 'local-fixture',
      officialBudgetMaxAgeMs: 60_000,
      now: () => epoch + RETENTION_MS + 2000,
      canIssue: () => ({ allowed: false }),
    });
    const shared = new SharedRetryCheckpoint({
      opsDataDir: f.directory,
      isWritable: () => journal.writable,
      isRetiredReservation: (id) => budget.isRetiredReservation(id),
    });
    const failure = vi.fn();
    const retention = new DurableRetention({
      journal,
      usageBudget: budget,
      retryCheckpoint: shared,
      owners: [],
      now: () => epoch + RETENTION_MS + 2000,
      monotonicNow: () => 0,
      canStart: () => true,
      ownershipConfirmed: () => true,
      onFailure: failure,
    });
    const stop = async () => {
      await retention.close();
      await shared.close();
      await budget.close();
      await journal.close();
    };
    close.push(stop);
    await budget.restore();
    const record = restored.records.at(-1)!.record;
    const empty = budget.snapshot().reservations;
    expect(
      planDurableRetention({
        records: restored.records.slice(-1),
        reservations: empty,
        intents: [],
        now: epoch + 2000,
      }).size,
    ).toBe(0);
    expect(await compactConfirmedRetirements(journal, budget, epoch + 2000)).toMatchObject({
      removed: 0,
    });
    const originalUsage = await fs.readFile(
      path.join(f.directory, 'usage-checkpoint.json'),
      'utf8',
    );
    expect(await retention.run()).toEqual({
      status: 'compacted',
      roots: 1,
      records: 1,
      retries: 0,
      reservations: 0,
    });
    expect(await fs.readFile(path.join(f.directory, 'usage-checkpoint.json'), 'utf8')).toBe(
      originalUsage,
    );
    expect(failure).not.toHaveBeenCalled();
    const request = {
      ...record.reservationIntent!.requests[0]!,
      reservationId: `${record.reservationId}:foreign`,
    };
    const unexpected = {
      request,
      minutes: 60,
      bytes: request.expectedBytes * 2,
      status: 'ACTIVE' as const,
      createdAtEpochMs: epoch,
      retiringAtEpochMs: null,
      retiringAfterVersion: null,
      retiringPeriodId: null,
      remoteConfirmedAtEpochMs: null,
      releasedAtEpochMs: null,
    };
    expect(isEmptyReservationAbort(record, [unexpected])).toBe(false);
    expect(reservationIntentMatches(record, [unexpected])).toBe(false);
    expect(() =>
      validateJournalRecord({
        ...record,
        reservationIntent: { ...record.reservationIntent, phase: 'COMMITTED' },
      }),
    ).toThrow();
    await stop();
    const reopened = await recover(f.directory);
    await vi.waitFor(() => expect(reopened.coordinator.getReadiness().state).toBe('READY'), {
      timeout: 5000,
      interval: 10,
    });
  });
});

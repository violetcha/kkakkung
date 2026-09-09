import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckpointStore, checksum } from '../../src/operations/CheckpointStore.js';
import {
  OperationJournal,
  type JournalEntry,
  type JournalRecord,
  type JournalRestore,
} from '../../src/operations/OperationJournal.js';
import {
  reconcileRecoveryRecords,
  type RecoveryRecordsInput,
} from '../../src/operations/RecoveryRecords.js';
import { compactConfirmedRetirements } from '../../src/operations/RetentionPolicy.js';
import { validateRetryIntent, type RetryIntent } from '../../src/operations/RevocationRetries.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint, type UsageReservation } from '../../src/operations/UsageCheckpoint.js';

const DAY = 86_400_000;
const directories: string[] = [];
const journals: OperationJournal[] = [];
const record: JournalRecord = {
  namespace: 'qa-e12',
  matchId: 'match-1',
  mediaInstanceId: 'media-1',
  roomName: 'qa-e12--old-epoch--room',
  serverEpoch: 'old-epoch',
  identity: 'identity-1',
  generation: 1,
  state: 'REVOKING',
  issuedAtEpochMs: 1_000,
  expiresAtEpochMs: 301_000,
  reservationId: 'lease-1',
  retirementId: 'retire-1',
  attempt: 0,
  firstRetireAtEpochMs: 2_000,
  atEpochMs: 2_000,
};
const intent: RetryIntent = {
  retirementId: 'retire-1',
  reservationId: 'lease-1',
  identity: 'identity-1',
  generation: 1,
  firstRetireEpochMs: 2_000,
  lastAttemptEpochMs: null,
  nextAttemptEpochMs: 3_000,
  attempt: 0,
  status: 'REVOKING',
  alarmed: false,
  providerWaitUnknown: false,
};
const official = (at: number) => ({
  projectAlias: 'qa-e12-project',
  remainingMinutes: 5_000,
  remainingBytes: 100_000_000,
  checkedAtEpochMs: at,
  source: 'cloud-dashboard' as const,
  checkedBy: 'operator-e-local-fixture',
});
function reservation(
  id = 'lease-1',
  status: UsageReservation['status'] = 'ACTIVE',
): UsageReservation {
  return {
    request: {
      reservationId: id,
      matchId: 'match-1',
      purpose: 'public',
      slots: 6,
      expectedMinutes: 5,
      expectedBytes: 1_000,
      margin: 0,
    },
    minutes: 30,
    bytes: 1_000,
    status,
    createdAtEpochMs: 1_000,
    retiringAtEpochMs: status === 'ACTIVE' ? null : 2_000,
    retiringAfterVersion: status === 'ACTIVE' ? null : 1,
    retiringPeriodId: status === 'ACTIVE' ? null : '2026-09',
    remoteConfirmedAtEpochMs: ['AWAITING_OFFICIAL', 'RELEASED'].includes(status) ? 3_000 : null,
    releasedAtEpochMs: status === 'RELEASED' ? 4_000 : null,
  };
}
function entry(seq: number, overrides: Partial<JournalRecord> = {}): JournalEntry {
  const payload = { version: 1 as const, seq, record: { ...record, ...overrides } };
  return { ...payload, checksum: checksum(payload) };
}
function journal(entries = [entry(1)], lastSeq = entries.at(-1)?.seq ?? 0): JournalRestore {
  return {
    records: entries,
    lastSeq,
    integrity: 'ok',
    writable: true,
    unresolved: entries.some((value) => value.record.state !== 'REVOKED'),
  };
}
function usage(reservations = [reservation()]): ReturnType<UsageBudget['snapshot']> {
  const active = reservations.filter((value) => value.status !== 'RELEASED');
  const activeMinutes = active.reduce((sum, value) => sum + value.minutes, 0);
  const activeBytes = active.reduce((sum, value) => sum + value.bytes, 0);
  return {
    integrity: 'ok',
    writable: true,
    official: { checkpoint: official(1_000), periodId: '2026-09', version: 1 },
    reservations,
    activeMinutes,
    activeBytes,
    availableMinutes: 5_000 - activeMinutes,
    availableBytes: 100_000_000 - activeBytes,
    localEstimatedMinutes: reservations.reduce((sum, value) => sum + value.minutes, 0),
    localEstimatedBytes: reservations.reduce((sum, value) => sum + value.bytes, 0),
  };
}
function input(overrides: Partial<RecoveryRecordsInput> = {}): RecoveryRecordsInput {
  return {
    namespace: 'qa-e12',
    journal: journal(),
    usage: usage(),
    retryCheckpoint: { integrity: 'ok', checkpoint: { lastSeq: 1, state: [intent] } },
    epochNowMs: 2_500,
    monotonicNow: 90,
    ...overrides,
  };
}
function createJournal(opsDataDir: string) {
  const value = new OperationJournal({ opsDataDir });
  journals.push(value);
  return value;
}
afterEach(async () => {
  for (const value of journals.splice(0)) await value.close();
  for (const dir of directories.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('kkakkung-e12-records-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

describe('E-12 durable record reconciliation', () => {
  it('replays the latest full scope without losing older epochs or reusing old monotonic clocks', () => {
    const candidate = input({
      journal: journal(
        [
          entry(1),
          entry(2, { state: 'REVOKED', atEpochMs: 2_200 }),
          entry(3, {
            roomName: 'qa-e12--other-epoch--room',
            serverEpoch: 'other-epoch',
            generation: 2,
            state: 'PREPARED',
            retirementId: undefined,
            attempt: undefined,
            firstRetireAtEpochMs: undefined,
          }),
        ],
        9,
      ),
    });
    // Undefined optional fields are not part of persisted JSON; use the same serialized representation.
    const serialized = JSON.parse(JSON.stringify(candidate)) as RecoveryRecordsInput;
    const before = structuredClone(serialized);
    const result = reconcileRecoveryRecords(serialized);
    expect(result.reasonCodes).toEqual([]);
    expect(result.lastSeq).toBe(9);
    expect(result.records.map((value) => value.seq)).toEqual([2, 3]);
    expect(result.pendingRecords.map((value) => value.record.generation)).toEqual([2]);
    expect(result.retryIntents[0]?.status).toBe('REVOKED');
    expect(serialized).toEqual(before);
  });

  it('calculates deadlines from persisted epoch time and the current monotonic clock', () => {
    const result = reconcileRecoveryRecords(input());
    expect(result.reasonCodes).toEqual([]);
    expect(result.retryDeadlines).toEqual([
      { retirementId: 'retire-1', automaticDeadlineMs: 9_590, nextAttemptMs: 590 },
    ]);
    const expired = reconcileRecoveryRecords(input({ epochNowMs: 20_000, monotonicNow: 17 }));
    expect(expired.retryDeadlines).toEqual([
      { retirementId: 'retire-1', automaticDeadlineMs: 17, nextAttemptMs: null },
    ]);
  });

  it.each(['partial', 'corrupt'] as const)(
    'preserves valid prefix evidence but prevents scheduling after %s input',
    (integrity) => {
      const result = reconcileRecoveryRecords(
        input({
          journal: { ...journal(), integrity, writable: false, reason: 'INTEGRITY_FAILURE' },
        }),
      );
      expect(result.reasonCodes).toContain('JOURNAL_INTEGRITY');
      expect(result.pendingRecords).toHaveLength(1);
      expect(result.retryDeadlines).toEqual([]);
    },
  );

  it('does not pass a foreign namespace to a cleanup consumer', () => {
    const result = reconcileRecoveryRecords(
      input({ journal: journal([entry(1, { namespace: 'other-service' })]) }),
    );
    expect(result.reasonCodes).toContain('JOURNAL_SCOPE_MISMATCH');
    expect(result.records).toEqual([]);
  });

  it.each(['checksum', 'duplicate-sequence', 'boundary'] as const)(
    'locks a %s mismatch without inventing missing records',
    (kind) => {
      const saved = journal();
      const bad =
        kind === 'checksum'
          ? { ...saved, records: [{ ...entry(1), checksum: '0'.repeat(64) }] }
          : kind === 'duplicate-sequence'
            ? { ...saved, records: [entry(1), entry(1)] }
            : { ...saved, lastSeq: 0 };
      expect(reconcileRecoveryRecords(input({ journal: bad })).reasonCodes).toContain(
        'JOURNAL_INTEGRITY',
      );
    },
  );

  it('rejects changed lifetime or regressed durable revocation in one identity scope', () => {
    const changed = journal([entry(1), entry(2, { expiresAtEpochMs: 302_000 })]);
    expect(reconcileRecoveryRecords(input({ journal: changed })).reasonCodes).toContain(
      'JOURNAL_IDENTITY_CONFLICT',
    );
    const regressed = journal([entry(1, { state: 'REVOKED' }), entry(2)]);
    expect(reconcileRecoveryRecords(input({ journal: regressed })).reasonCodes).toContain(
      'JOURNAL_IDENTITY_CONFLICT',
    );
  });

  it('distinguishes missing journal and usage histories from an unproven empty installation', () => {
    const empty = input({
      journal: { ...journal([]), integrity: 'missing' },
      usage: { ...usage([]), integrity: 'missing', official: null },
      retryCheckpoint: { integrity: 'missing', checkpoint: null },
    });
    expect(reconcileRecoveryRecords(empty).reasonCodes).toEqual([]);
    expect(reconcileRecoveryRecords({ ...empty, usage: usage() }).reasonCodes).toContain(
      'JOURNAL_HISTORY_MISSING',
    );
    expect(reconcileRecoveryRecords({ ...empty, journal: journal() }).reasonCodes).toContain(
      'USAGE_HISTORY_MISSING',
    );
  });

  it.each(['ACTIVE', 'RETIRING', 'AWAITING_OFFICIAL'] as const)(
    'preserves and locks an orphan %s reservation',
    (status) => {
      const savedUsage = usage([reservation('orphan', status)]);
      const before = structuredClone(savedUsage);
      const result = reconcileRecoveryRecords(
        input({
          journal: journal([], 7),
          usage: savedUsage,
          retryCheckpoint: { integrity: 'missing', checkpoint: null },
        }),
      );
      expect(result.reasonCodes).toContain('RESERVATION_HISTORY_MISMATCH');
      expect(savedUsage).toEqual(before);
    },
  );

  it('matches only numeric lease slices under an existing root and the same match', () => {
    expect(
      reconcileRecoveryRecords(input({ usage: usage([reservation(), reservation('lease-1:2')]) }))
        .reasonCodes,
    ).toEqual([]);
    for (const bad of [
      reservation('lease-10'),
      reservation('lease-1:not-a-slice'),
      {
        ...reservation('lease-1:2'),
        request: { ...reservation('lease-1:2').request, matchId: 'other-match' },
      },
    ]) {
      expect(
        reconcileRecoveryRecords(input({ usage: usage([reservation(), bad]) })).reasonCodes,
      ).toContain('RESERVATION_HISTORY_MISMATCH');
    }
    expect(
      reconcileRecoveryRecords(input({ usage: usage([reservation('lease-1:2')]) })).reasonCodes,
    ).toContain('RESERVATION_HISTORY_MISMATCH');
  });

  it('does not accept already released reservations while journal retirement is pending', () => {
    expect(
      reconcileRecoveryRecords(
        input({ usage: usage([reservation('lease-1', 'RELEASED')]), epochNowMs: 5_000 }),
      ).reasonCodes,
    ).toContain('RESERVATION_HISTORY_MISMATCH');
  });

  it('rejects missing, corrupt and future retry checkpoints separately', () => {
    expect(
      reconcileRecoveryRecords(
        input({ retryCheckpoint: { integrity: 'missing', checkpoint: null } }),
      ).reasonCodes,
    ).toContain('RETRY_CHECKPOINT_MISSING');
    expect(
      reconcileRecoveryRecords(
        input({ retryCheckpoint: { integrity: 'corrupt', checkpoint: null } }),
      ).reasonCodes,
    ).toContain('RETRY_CHECKPOINT_INTEGRITY');
    expect(
      reconcileRecoveryRecords(
        input({
          retryCheckpoint: { integrity: 'ok', checkpoint: { lastSeq: 2, state: [intent] } },
        }),
      ).reasonCodes,
    ).toContain('RETRY_CHECKPOINT_AHEAD');
  });

  it('prioritizes durable REVOKED over an older pending retry without dispatching again', () => {
    const result = reconcileRecoveryRecords(
      input({
        journal: journal([entry(1), entry(2, { state: 'REVOKED', attempt: 1, atEpochMs: 3_000 })]),
        epochNowMs: 3_500,
      }),
    );
    expect(result.reasonCodes).toEqual([]);
    expect(result.retryIntents).toEqual([
      { ...intent, status: 'REVOKED', nextAttemptEpochMs: null, attempt: 1 },
    ]);
    expect(result.retryDeadlines).toEqual([]);
    expect(result.pendingRecords).toEqual([]);
  });

  it('does not promote a checkpoint claim over pending or ambiguous journal evidence', () => {
    const revoked: RetryIntent = { ...intent, status: 'REVOKED', nextAttemptEpochMs: null };
    expect(
      reconcileRecoveryRecords(
        input({
          retryCheckpoint: { integrity: 'ok', checkpoint: { lastSeq: 1, state: [revoked] } },
        }),
      ).reasonCodes,
    ).toContain('RETRY_JOURNAL_MISMATCH');
    const ambiguous = journal([entry(1), entry(2, { roomName: 'qa-e12--other-room' })]);
    expect(reconcileRecoveryRecords(input({ journal: ambiguous })).reasonCodes).toContain(
      'RETRY_JOURNAL_MISMATCH',
    );
  });

  it('locks newer attempts with unavailable retry delay and conflicting retirement identifiers', () => {
    for (const saved of [
      journal([entry(1), entry(2, { attempt: 1 })]),
      journal([entry(1, { retirementId: 'other-retire' })]),
    ])
      expect(reconcileRecoveryRecords(input({ journal: saved })).reasonCodes).toContain(
        'RETRY_JOURNAL_MISMATCH',
      );
  });

  it('does not resume an older automatic retry after the journal recorded an unknown outcome', () => {
    const result = reconcileRecoveryRecords(
      input({ journal: journal([entry(1), entry(2, { state: 'UNRESOLVED' })]) }),
    );
    expect(result.reasonCodes).toContain('RETRY_JOURNAL_MISMATCH');
    expect(result.retryDeadlines).toEqual([]);
    expect(result.pendingRecords[0]?.record.state).toBe('UNRESOLVED');
  });

  it('preserves unknown provider wait and locks future retry clocks', () => {
    const blocked: RetryIntent = {
      ...intent,
      status: 'UNRESOLVED',
      alarmed: true,
      providerWaitUnknown: true,
      nextAttemptEpochMs: null,
    };
    const result = reconcileRecoveryRecords(
      input({ retryCheckpoint: { integrity: 'ok', checkpoint: { lastSeq: 1, state: [blocked] } } }),
    );
    expect(result.reasonCodes).toEqual([]);
    expect(result.retryDeadlines[0]?.nextAttemptMs).toBeNull();
    expect(reconcileRecoveryRecords(input({ epochNowMs: 1_999 })).reasonCodes).toContain(
      'RETRY_CLOCK_INVALID',
    );
    expect(() => reconcileRecoveryRecords(input({ epochNowMs: Number.NaN }))).toThrow(
      'INVALID_RECOVERY_CONFIGURATION',
    );
  });

  it('requires a released root, every slice, and the last confirmation plus 24 hours for compacted retries', () => {
    const compacted = input({
      journal: journal([], 19),
      usage: usage([reservation('lease-1', 'RELEASED')]),
      retryCheckpoint: {
        integrity: 'ok',
        checkpoint: {
          lastSeq: 4,
          state: [{ ...intent, status: 'REVOKED', nextAttemptEpochMs: null }],
        },
      },
      epochNowMs: DAY + 4_000,
    });
    expect(reconcileRecoveryRecords(compacted)).toMatchObject({
      lastSeq: 19,
      retryIntents: [],
      reasonCodes: [],
    });
    expect(
      reconcileRecoveryRecords({ ...compacted, epochNowMs: DAY + 3_999 }).reasonCodes,
    ).toContain('RETRY_JOURNAL_MISMATCH');
    for (const reservations of [
      [],
      [reservation('lease-1:1', 'RELEASED')],
      [reservation('lease-1', 'RELEASED'), reservation('lease-1:1', 'AWAITING_OFFICIAL')],
    ])
      expect(
        reconcileRecoveryRecords({ ...compacted, usage: usage(reservations) }).reasonCodes,
      ).toContain('RETRY_JOURNAL_MISMATCH');
  });

  it('restores actual compacted journal, retry and usage files without comparing their independent counters', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e12-records-'));
    directories.push(dir);
    const writer = createJournal(dir);
    await writer.restore();
    let now = 1_000;
    const store = new UsageCheckpoint({ opsDataDir: dir, isWritable: () => writer.writable });
    const budget = new UsageBudget({
      store,
      projectAlias: 'qa-e12-project',
      officialBudgetMaxAgeMs: DAY * 2,
      now: () => now,
      canIssue: () => ({ allowed: true }),
    });
    await budget.restore({ allowInitializeMissing: true });
    expect(
      (await budget.reconcileOfficial(official(now), { periodId: '2026-09', version: 1 })).status,
    ).toBe('applied');
    expect((await budget.reserve(reservation().request)).status).toBe('reserved');
    now = 2_000;
    expect(await budget.markRetiring('lease-1')).toBe(true);
    now = 3_000;
    expect(await budget.markRemoteConfirmed('lease-1')).toBe(true);
    const durable = await writer.append({ ...record, state: 'REVOKED', atEpochMs: now });
    const retries = new CheckpointStore<readonly RetryIntent[]>({
      opsDataDir: dir,
      fileName: 'retry-checkpoint.json',
      validate: (value) => {
        if (!Array.isArray(value)) throw new Error('INVALID_TEST_CHECKPOINT');
        return value.map(validateRetryIntent);
      },
      isWritable: () => writer.writable,
    });
    await retries.write({
      lastSeq: durable.seq,
      state: [{ ...intent, status: 'REVOKED', nextAttemptEpochMs: null }],
    });
    now = 4_000;
    expect(
      (await budget.reconcileOfficial(official(now), { periodId: '2026-09', version: 2 })).status,
    ).toBe('applied');
    expect(
      await budget.releaseConfirmed('lease-1', {
        remoteConfirmed: true,
        periodId: '2026-09',
        version: 2,
      }),
    ).toBe(true);
    now += DAY;
    expect((await compactConfirmedRetirements(writer, budget, now)).removed).toBe(1);
    await writer.close();
    const reader = createJournal(dir);
    const restored = await reader.restore();
    expect(restored).toMatchObject({ integrity: 'ok', lastSeq: 1, records: [] });
    const usageStore = new UsageCheckpoint({ opsDataDir: dir, isWritable: () => reader.writable });
    const usageRead = await usageStore.read();
    expect(usageRead.integrity === 'ok' && usageRead.checkpoint.lastSeq).toBeGreaterThan(
      restored.lastSeq,
    );
    const recoveredBudget = new UsageBudget({
      store: usageStore,
      projectAlias: 'qa-e12-project',
      officialBudgetMaxAgeMs: DAY * 2,
      now: () => now,
      canIssue: () => ({ allowed: false }),
    });
    const recoveredUsage = await recoveredBudget.restore();
    const result = reconcileRecoveryRecords(
      input({
        journal: restored,
        usage: recoveredUsage,
        retryCheckpoint: await retries.read(),
        epochNowMs: now,
      }),
    );
    expect(result).toMatchObject({ lastSeq: 1, records: [], retryIntents: [], reasonCodes: [] });
    expect(recoveredUsage.reservations[0]?.status).toBe('RELEASED');
  });
});

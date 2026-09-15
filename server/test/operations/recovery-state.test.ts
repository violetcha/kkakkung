import { describe, expect, it } from 'vitest';
import { checksum } from '../../src/operations/CheckpointStore.js';
import type {
  JournalEntry,
  JournalRecord,
  JournalRestore,
} from '../../src/operations/OperationJournal.js';
import {
  RecoveryState,
  restoreMonotonicDeadline,
  type CleanupReport,
} from '../../src/operations/RecoveryState.js';

const usage = { integrity: 'ok' as const, writable: true, budgetConfirmed: true };
const cleaned: CleanupReport = {
  recordedIdentities: 0,
  observedParticipants: 0,
  revoked: 0,
  unresolved: 0,
  ownedRoomsRemaining: 0,
  historyComplete: true,
};

function entry(seq: number, fields: Partial<JournalRecord> = {}): JournalEntry {
  const record: JournalRecord = {
    state: 'PREPARED',
    namespace: 'qa-e12',
    matchId: 'match-1',
    mediaInstanceId: 'media-1',
    roomName: 'room-1',
    serverEpoch: 'prior-process-epoch',
    identity: 'participant-1',
    generation: 1,
    issuedAtEpochMs: 1000,
    expiresAtEpochMs: 2000,
    reservationId: 'lease-1',
    ...fields,
  };
  const payload = { version: 1 as const, seq, record };
  return { ...payload, checksum: checksum(payload) };
}

function journal(fields: Partial<JournalRestore> = {}): JournalRestore {
  const records = fields.records ?? [];
  return {
    records,
    lastSeq: records.at(-1)?.seq ?? 0,
    integrity: 'ok',
    writable: true,
    unresolved: false,
    ...fields,
  };
}

describe('recovery state integrity and process lifetime', () => {
  it('starts recovering and cannot become ready from a budget refresh alone', () => {
    const state = new RecoveryState();
    state.refreshBudget(true);
    expect(state.snapshot()).toMatchObject({
      phase: 'RECOVERING',
      writable: false,
      singleWriter: false,
      historyComplete: false,
      reasonCodes: ['RECOVERY_PENDING'],
    });
    state.restore(journal(), usage);
    expect(state.snapshot()).toMatchObject({
      phase: 'RECOVERING',
      reasonCodes: ['CLEANUP_PENDING'],
    });
  });

  it('keeps distinct namespace, room and generation scopes when identities repeat', () => {
    const state = new RecoveryState();
    state.restore(
      journal({
        records: [
          entry(1),
          entry(2, { roomName: 'room-2', state: 'REVOKED' }),
          entry(3, { generation: 2, state: 'UNRESOLVED' }),
          entry(4, { namespace: 'qa-other', state: 'REVOKING' }),
          entry(5, { generation: 2, state: 'REVOKED' }),
        ],
      }),
      usage,
    );
    expect(state.snapshot()).toMatchObject({ phase: 'RECOVERING', pendingCount: 2 });
    expect(JSON.stringify(state.readiness())).not.toContain('participant-1');
    expect(JSON.stringify(state.snapshot())).not.toContain('prior-process-epoch');
  });

  it('does not replace restored evidence or clear a storage lock when restore repeats', () => {
    const state = new RecoveryState();
    state.restore(journal({ records: [entry(1)] }), usage);
    state.lock('JOURNAL_WRITE_FAILED');
    const before = state.snapshot();
    state.restore(journal(), usage, { firstInstallConfirmed: true });
    expect(state.snapshot()).toEqual(before);
    state.completeCleanup(cleaned);
    state.refreshBudget(true);
    expect(state.snapshot()).toMatchObject({ phase: 'LOCKED' });
    expect(state.snapshot().reasonCodes).toContain('JOURNAL_WRITE_FAILED');
  });

  it('keeps a close that preceded restore and repeated close reasons are deduplicated', () => {
    const state = new RecoveryState();
    state.lock('CLOSED');
    state.lock('CLOSED');
    state.restore(journal(), usage);
    state.completeCleanup(cleaned);
    expect(state.snapshot()).toMatchObject({ phase: 'LOCKED', reasonCodes: ['CLOSED'] });
  });

  it('requires explicit first-install evidence and does not treat missing history as empty', () => {
    const missingJournal = journal({ integrity: 'missing' });
    const missingUsage = { ...usage, integrity: 'missing' as const, budgetConfirmed: false };
    const unproven = new RecoveryState();
    unproven.restore(missingJournal, missingUsage);
    unproven.completeCleanup(cleaned);
    unproven.refreshBudget(true);
    expect(unproven.snapshot()).toMatchObject({ phase: 'LOCKED', historyComplete: false });
    const proven = new RecoveryState();
    proven.restore(missingJournal, missingUsage, { firstInstallConfirmed: true });
    proven.completeCleanup(cleaned);
    expect(proven.snapshot()).toMatchObject({ phase: 'LOCKED', historyComplete: true });
    proven.refreshBudget(true);
    expect(proven.snapshot()).toMatchObject({ phase: 'READY', historyComplete: true });
  });

  it.each(['partial', 'corrupt'] as const)(
    'keeps %s journal locked after an empty Cloud observation',
    (integrity) => {
      const state = new RecoveryState();
      state.restore(journal({ integrity, writable: false, records: [entry(1)] }), usage);
      state.completeCleanup(cleaned);
      state.refreshBudget(true);
      expect(state.snapshot()).toMatchObject({ phase: 'LOCKED', historyComplete: false });
      expect(state.snapshot().reasonCodes).toEqual(
        expect.arrayContaining(['JOURNAL_INTEGRITY', 'HISTORY_INCOMPLETE', 'STORAGE_NOT_WRITABLE']),
      );
    },
  );

  it.each(['WRITER_CONFLICT', 'IO_FAILURE'] as const)(
    'never marks writer ownership confirmed after %s',
    (reason) => {
      const state = new RecoveryState();
      state.restore(journal({ reason, writable: false }), usage);
      state.completeCleanup(cleaned);
      expect(state.snapshot()).toMatchObject({ phase: 'LOCKED', singleWriter: false });
    },
  );

  it.each([
    { records: [{ ...entry(1), checksum: 'invalid-checksum' }] },
    { records: [entry(2), entry(1)], lastSeq: 2 },
    { records: [entry(1)], lastSeq: 0 },
    { records: [entry(1, { identity: 'unsafe/identity' })] },
    { lastSeq: Number.NaN },
  ])('locks malformed replay instead of trusting a reported ok integrity: %j', (invalid) => {
    const state = new RecoveryState();
    state.restore(journal(invalid), usage);
    state.completeCleanup(cleaned);
    expect(state.snapshot()).toMatchObject({
      phase: 'LOCKED',
      integrity: 'corrupt',
      historyComplete: false,
    });
    expect(state.snapshot().reasonCodes).toContain('JOURNAL_INTEGRITY');
  });

  it('keeps missing and corrupt usage distinguishable without discarding journal history', () => {
    for (const integrity of ['missing', 'corrupt'] as const) {
      const state = new RecoveryState();
      state.restore(journal({ records: [entry(1)] }), { ...usage, integrity });
      expect(state.snapshot()).toMatchObject({
        phase: 'LOCKED',
        historyComplete: false,
        pendingCount: 1,
      });
      expect(state.snapshot().reasonCodes.includes('USAGE_INTEGRITY')).toBe(
        integrity === 'corrupt',
      );
    }
  });

  it('exposes only fixed reason codes and returns isolated snapshot arrays', () => {
    const state = new RecoveryState();
    state.restore(journal(), usage);
    state.lock('SDK error with sensitive-example-value');
    state.lock('UPPERCASE_SECRET_VALUE');
    const snapshot = state.snapshot();
    // Snapshots are shared frozen copies: a caller cannot write through them into the state.
    expect(() => (snapshot.reasonCodes as string[]).push('injected')).toThrow(TypeError);
    expect(state.snapshot()).toBe(snapshot);
    const readiness = state.readiness();
    (readiness.reasonCodes as string[]).push('injected');
    expect(state.snapshot().reasonCodes).toEqual(['RECOVERY_LOCKED', 'CLEANUP_PENDING']);
    expect(JSON.stringify(state.readiness())).not.toContain('sensitive-example-value');
  });

  it('keeps one snapshot until the state changes and refreshes it on every change', () => {
    const state = new RecoveryState();
    state.restore(journal(), { ...usage, budgetConfirmed: false });
    const locked = state.snapshot();
    state.refreshBudget(false);
    expect(state.snapshot()).toBe(locked);
    state.refreshBudget(true);
    const confirmed = state.snapshot();
    expect(confirmed).not.toBe(locked);
    expect(confirmed.budgetConfirmed).toBe(true);
    expect(confirmed.reasonCodes).not.toContain('BUDGET_UNCONFIRMED');
    state.lock('WRITER_CONFLICT');
    expect(state.snapshot()).toMatchObject({ phase: 'LOCKED' });
    expect(state.snapshot().reasonCodes).toContain('WRITER_CONFLICT');
  });
});

describe('cleanup reports and current budget are independent readiness evidence', () => {
  it('requires both confirmed cleanup and the current official budget', () => {
    const state = new RecoveryState();
    state.restore(journal(), { ...usage, budgetConfirmed: false });
    state.completeCleanup(cleaned);
    expect(state.snapshot()).toMatchObject({
      phase: 'LOCKED',
      reasonCodes: ['BUDGET_UNCONFIRMED'],
    });
    state.refreshBudget(true);
    expect(state.snapshot()).toMatchObject({ phase: 'READY', pendingCount: 0 });
    state.refreshBudget(false);
    expect(state.snapshot()).toMatchObject({ phase: 'LOCKED' });
  });

  it('keeps remaining identities and rooms locked and accepts a later confirmed cleanup', () => {
    const state = new RecoveryState();
    state.restore(journal({ records: [entry(1)] }), usage);
    state.completeCleanup({ ...cleaned, unresolved: 2, ownedRoomsRemaining: 1 });
    expect(state.snapshot()).toMatchObject({ phase: 'LOCKED', pendingCount: 3 });
    expect(state.snapshot().reasonCodes).toContain('REMOTE_RETIREMENT_UNCONFIRMED');
    state.completeCleanup(cleaned);
    expect(state.snapshot()).toMatchObject({ phase: 'READY', pendingCount: 0 });
  });

  it('does not erase unrecorded history after a later empty room list', () => {
    const state = new RecoveryState();
    state.restore(journal(), usage);
    state.completeCleanup({ ...cleaned, historyComplete: false });
    state.completeCleanup(cleaned);
    state.refreshBudget(true);
    expect(state.snapshot()).toMatchObject({ phase: 'LOCKED', historyComplete: false });
  });

  it.each([
    { unresolved: -1 },
    { ownedRoomsRemaining: Number.NaN },
    { observedParticipants: Number.POSITIVE_INFINITY },
    { recordedIdentities: 0.5 },
    { revoked: -1 },
    { unresolved: Number.MAX_SAFE_INTEGER, ownedRoomsRemaining: 1 },
    { historyComplete: 'true' },
  ])('rejects an invalid cleanup report without reopening: %j', (invalid) => {
    const state = new RecoveryState();
    state.restore(journal(), usage);
    state.completeCleanup({ ...cleaned, ...invalid } as CleanupReport);
    state.completeCleanup(cleaned);
    expect(state.snapshot()).toMatchObject({ phase: 'LOCKED', pendingCount: 0 });
    expect(state.snapshot().reasonCodes).toContain('CLEANUP_REPORT_INVALID');
  });

  it('does not use cleanup received before local restore as readiness proof', () => {
    const state = new RecoveryState();
    state.completeCleanup(cleaned);
    state.restore(journal(), usage);
    expect(state.snapshot()).toMatchObject({ phase: 'LOCKED' });
    expect(state.snapshot().reasonCodes).toEqual(['RECOVERY_UNCONFIRMED', 'CLEANUP_PENDING']);
  });
});

describe('restoring epoch deadlines into a new monotonic clock', () => {
  it('translates remaining wall-clock time and makes expired work immediately due', () => {
    expect(restoreMonotonicDeadline(12000, 10000, 25.5)).toBe(2025.5);
    expect(restoreMonotonicDeadline(9000, 10000, 25.5)).toBe(25.5);
    expect(restoreMonotonicDeadline(10000, 10000, 25.5)).toBe(25.5);
  });

  it.each([
    [-1, 10000, 25],
    [12000, -1, 25],
    [12000, 10000, -1],
    [Number.NaN, 10000, 25],
    [12000, Number.POSITIVE_INFINITY, 25],
    [12000, 10000, Number.POSITIVE_INFINITY],
    [12000.5, 10000, 25],
    [Number.MAX_SAFE_INTEGER, 0, 1],
  ])('rejects invalid or unrepresentable clocks: %j', (deadline, epoch, monotonic) => {
    expect(() => restoreMonotonicDeadline(deadline!, epoch!, monotonic!)).toThrow(
      'INVALID_RECOVERY_CLOCK',
    );
  });
});

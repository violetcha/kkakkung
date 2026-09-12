import { checksum, safeIdentifier, strictObject, type CheckpointRead } from './CheckpointStore.js';
import {
  validateJournalRecord,
  type JournalEntry,
  type JournalRecord,
  type JournalRestore,
} from './OperationJournal.js';
import { canCompact } from './RetentionPolicy.js';
import { validateRetryIntent, type RetryIntent } from './RevocationRetries.js';
import type { UsageBudget } from './UsageBudget.js';
import { validateUsageState, type UsageReservation } from './UsageCheckpoint.js';

export type RecoveryRecordReason =
  | 'JOURNAL_INTEGRITY'
  | 'JOURNAL_HISTORY_MISSING'
  | 'JOURNAL_SCOPE_MISMATCH'
  | 'JOURNAL_IDENTITY_CONFLICT'
  | 'USAGE_INTEGRITY'
  | 'USAGE_HISTORY_MISSING'
  | 'RESERVATION_HISTORY_MISMATCH'
  | 'RETRY_CHECKPOINT_MISSING'
  | 'RETRY_CHECKPOINT_INTEGRITY'
  | 'RETRY_CHECKPOINT_AHEAD'
  | 'RETRY_JOURNAL_MISMATCH'
  | 'RETRY_CLOCK_INVALID';

export type RecoveryRetryDeadline = Readonly<{
  retirementId: string;
  automaticDeadlineMs: number;
  nextAttemptMs: number | null;
}>;

export type RecoveryRecords = Readonly<{
  records: readonly JournalEntry[];
  pendingRecords: readonly JournalEntry[];
  /** Durable journal boundary; compacted records may end before this sequence. */
  lastSeq: number;
  retryIntents: readonly RetryIntent[];
  retryDeadlines: readonly RecoveryRetryDeadline[];
  reasonCodes: readonly RecoveryRecordReason[];
}>;

export type RecoveryRecordsInput = Readonly<{
  namespace: string;
  journal: JournalRestore;
  usage: ReturnType<UsageBudget['snapshot']>;
  retryCheckpoint: CheckpointRead<readonly RetryIntent[]>;
  epochNowMs: number;
  monotonicNow: number;
}>;

function recordKey(record: JournalRecord): string {
  return JSON.stringify([record.namespace, record.roomName, record.identity, record.generation]);
}

function sameGeneration(left: JournalRecord, right: JournalRecord): boolean {
  return (
    left.matchId === right.matchId &&
    left.mediaInstanceId === right.mediaInstanceId &&
    left.serverEpoch === right.serverEpoch &&
    left.reservationId === right.reservationId &&
    left.issuedAtEpochMs === right.issuedAtEpochMs &&
    left.expiresAtEpochMs === right.expiresAtEpochMs
  );
}

function belongsToRoot(reservationId: string, root: string): boolean {
  return (
    reservationId === root ||
    (reservationId.startsWith(`${root}:`) && /^\d+$/.test(reservationId.slice(root.length + 1)))
  );
}

/** Pure reconciliation only. It never writes, starts timers, issues tokens or calls Cloud. */
export function reconcileRecoveryRecords(input: RecoveryRecordsInput): RecoveryRecords {
  if (
    !safeIdentifier(input.namespace) ||
    !Number.isSafeInteger(input.epochNowMs) ||
    input.epochNowMs < 0 ||
    !Number.isFinite(input.monotonicNow) ||
    input.monotonicNow < 0 ||
    input.monotonicNow > Number.MAX_SAFE_INTEGER
  )
    throw new Error('INVALID_RECOVERY_CONFIGURATION');
  const reasons = new Set<RecoveryRecordReason>();
  const latest = new Map<string, JournalEntry>();
  const retryEvidence = new Map<string, JournalEntry>();
  const validBoundary = Number.isSafeInteger(input.journal.lastSeq) && input.journal.lastSeq >= 0;
  if (!validBoundary || ['corrupt', 'partial'].includes(input.journal.integrity))
    reasons.add('JOURNAL_INTEGRITY');
  let previousSeq = 0;
  for (const entry of input.journal.records) {
    try {
      strictObject(entry, ['version', 'seq', 'record', 'checksum']);
      const record = validateJournalRecord(entry.record);
      if (
        entry.version !== 1 ||
        !Number.isSafeInteger(entry.seq) ||
        entry.seq <= previousSeq ||
        entry.seq > input.journal.lastSeq ||
        entry.checksum !== checksum({ version: 1, seq: entry.seq, record })
      )
        throw new Error('INVALID_RECOVERY_ENTRY');
      previousSeq = entry.seq;
      if (record.namespace !== input.namespace) {
        reasons.add('JOURNAL_SCOPE_MISMATCH');
        continue;
      }
      const key = recordKey(record);
      const previous = latest.get(key)?.record;
      if (
        previous &&
        (!sameGeneration(previous, record) ||
          (previous.state === 'REVOKED' && record.state !== 'REVOKED'))
      )
        reasons.add('JOURNAL_IDENTITY_CONFLICT');
      const copy = structuredClone(entry);
      latest.set(key, copy);
      if (record.retirementId !== undefined) retryEvidence.set(key, copy);
    } catch {
      reasons.add('JOURNAL_INTEGRITY');
    }
  }
  const records = [...latest.values()].sort((left, right) => left.seq - right.seq);
  const pendingRecords = records.filter((entry) => entry.record.state !== 'REVOKED');
  let reservations: readonly UsageReservation[] = [];
  if (input.usage.integrity === 'corrupt') reasons.add('USAGE_INTEGRITY');
  else if (input.usage.integrity === 'ok') {
    try {
      reservations = validateUsageState(
        { official: input.usage.official, reservations: input.usage.reservations },
        input.usage.budgetPolicy === 'provider-quota',
      ).reservations;
    } catch {
      reasons.add('USAGE_INTEGRITY');
    }
  }
  if (input.usage.integrity === 'missing' && (records.length > 0 || input.journal.lastSeq > 0))
    reasons.add('USAGE_HISTORY_MISSING');
  if (
    reservations.length > 0 &&
    (input.journal.integrity === 'missing' || input.journal.lastSeq === 0)
  )
    reasons.add('JOURNAL_HISTORY_MISSING');

  for (const { record } of records) {
    const root = record.reservationId;
    const group = root
      ? reservations.filter((r) => belongsToRoot(r.request.reservationId, root))
      : [];
    if (
      !root ||
      !group.some((r) => r.request.reservationId === root) ||
      group.some((r) => r.request.matchId !== record.matchId) ||
      (record.state !== 'REVOKED' && group.some((r) => r.status === 'RELEASED'))
    )
      reasons.add('RESERVATION_HISTORY_MISMATCH');
  }
  for (const reservation of reservations) {
    if (reservation.status === 'RELEASED') continue;
    if (
      !records.some(
        ({ record }) =>
          record.reservationId !== undefined &&
          record.matchId === reservation.request.matchId &&
          belongsToRoot(reservation.request.reservationId, record.reservationId),
      )
    )
      reasons.add('RESERVATION_HISTORY_MISMATCH');
  }

  let checkpointSeq = 0;
  let savedIntents: readonly RetryIntent[] = [];
  if (input.retryCheckpoint.integrity === 'corrupt') reasons.add('RETRY_CHECKPOINT_INTEGRITY');
  if (input.retryCheckpoint.integrity === 'ok') {
    try {
      const checkpoint = input.retryCheckpoint.checkpoint;
      strictObject(checkpoint, ['lastSeq', 'state']);
      if (
        !Number.isSafeInteger(checkpoint.lastSeq) ||
        checkpoint.lastSeq < 0 ||
        !Array.isArray(checkpoint.state)
      )
        throw new Error('INVALID_RECOVERY_RETRY_CHECKPOINT');
      checkpointSeq = checkpoint.lastSeq;
      savedIntents = checkpoint.state.map((value) => {
        const intent = validateRetryIntent(value);
        if (![intent.retirementId, intent.reservationId, intent.identity].every(safeIdentifier))
          throw new Error('INVALID_RECOVERY_RETRY_IDENTIFIER');
        return intent;
      });
      if (new Set(savedIntents.map((intent) => intent.retirementId)).size !== savedIntents.length)
        throw new Error('DUPLICATE_RECOVERY_RETRY');
      if (checkpointSeq > input.journal.lastSeq) reasons.add('RETRY_CHECKPOINT_AHEAD');
    } catch {
      savedIntents = [];
      reasons.add('RETRY_CHECKPOINT_INTEGRITY');
    }
  }

  const retryIntents: RetryIntent[] = [];
  const matched = new Set<string>();
  for (const intent of savedIntents) {
    if (
      intent.firstRetireEpochMs > input.epochNowMs ||
      (intent.lastAttemptEpochMs !== null && intent.lastAttemptEpochMs > input.epochNowMs) ||
      !Number.isSafeInteger(intent.firstRetireEpochMs + 10_000)
    )
      reasons.add('RETRY_CLOCK_INVALID');
    const candidates = records.filter(
      ({ record }) =>
        record.identity === intent.identity &&
        record.generation === intent.generation &&
        record.reservationId === intent.reservationId,
    );
    if (candidates.length === 0 && canDiscardCompactedIntent(intent)) continue;
    if (candidates.length !== 1) {
      reasons.add('RETRY_JOURNAL_MISMATCH');
      retryIntents.push(intent);
      continue;
    }
    const entry = candidates[0]!;
    const key = recordKey(entry.record);
    if (matched.has(key)) reasons.add('RETRY_JOURNAL_MISMATCH');
    matched.add(key);
    const evidence = retryEvidence.get(key);
    if (
      evidence &&
      (evidence.record.retirementId !== intent.retirementId ||
        (evidence.record.firstRetireAtEpochMs !== undefined &&
          evidence.record.firstRetireAtEpochMs !== intent.firstRetireEpochMs) ||
        (evidence.record.attempt !== undefined &&
          (evidence.record.attempt < intent.attempt ||
            (entry.record.state !== 'REVOKED' && evidence.record.attempt !== intent.attempt))))
    )
      reasons.add('RETRY_JOURNAL_MISMATCH');
    if (entry.record.state === 'REVOKED') {
      retryIntents.push({
        ...intent,
        status: 'REVOKED',
        nextAttemptEpochMs: null,
        providerWaitUnknown: false,
        attempt: Math.max(intent.attempt, evidence?.record.attempt ?? 0),
      });
    } else {
      if (
        entry.record.state === 'PREPARED' ||
        intent.status === 'REVOKED' ||
        (entry.record.state === 'UNRESOLVED' && intent.status === 'REVOKING')
      )
        reasons.add('RETRY_JOURNAL_MISMATCH');
      retryIntents.push(intent);
    }
  }
  for (const entry of pendingRecords) {
    if (entry.record.state === 'PREPARED') continue;
    if (!matched.has(recordKey(entry.record)))
      reasons.add(
        input.retryCheckpoint.integrity === 'missing'
          ? 'RETRY_CHECKPOINT_MISSING'
          : 'RETRY_JOURNAL_MISMATCH',
      );
  }

  const retryDeadlines: RecoveryRetryDeadline[] = [];
  for (const intent of retryIntents) {
    if (intent.status === 'REVOKED') continue;
    const automaticDeadlineMs = deadline(intent.firstRetireEpochMs + 10_000);
    const nextAttemptMs =
      intent.status === 'REVOKING' &&
      !intent.providerWaitUnknown &&
      intent.nextAttemptEpochMs !== null &&
      input.epochNowMs < intent.firstRetireEpochMs + 10_000 &&
      intent.nextAttemptEpochMs < intent.firstRetireEpochMs + 10_000
        ? deadline(intent.nextAttemptEpochMs)
        : null;
    if (
      automaticDeadlineMs > Number.MAX_SAFE_INTEGER ||
      (nextAttemptMs !== null && nextAttemptMs > Number.MAX_SAFE_INTEGER)
    )
      reasons.add('RETRY_CLOCK_INVALID');
    retryDeadlines.push({ retirementId: intent.retirementId, automaticDeadlineMs, nextAttemptMs });
  }
  return structuredClone({
    records,
    pendingRecords,
    lastSeq: validBoundary ? input.journal.lastSeq : 0,
    retryIntents,
    retryDeadlines: reasons.size === 0 ? retryDeadlines : [],
    reasonCodes: [...reasons],
  });

  function deadline(epochMs: number): number {
    return input.monotonicNow + Math.max(0, epochMs - input.epochNowMs);
  }

  function canDiscardCompactedIntent(intent: RetryIntent): boolean {
    if (
      intent.status !== 'REVOKED' ||
      input.journal.integrity !== 'ok' ||
      input.usage.integrity !== 'ok' ||
      !input.usage.writable ||
      checkpointSeq > input.journal.lastSeq ||
      input.journal.lastSeq === 0
    )
      return false;
    const group = reservations.filter((reservation) =>
      belongsToRoot(reservation.request.reservationId, intent.reservationId),
    );
    const root = group.find(
      (reservation) => reservation.request.reservationId === intent.reservationId,
    );
    if (
      !root ||
      group.some(
        (reservation) =>
          reservation.request.matchId !== root.request.matchId ||
          reservation.status !== 'RELEASED' ||
          reservation.retiringAtEpochMs === null ||
          reservation.remoteConfirmedAtEpochMs === null ||
          reservation.releasedAtEpochMs === null,
      ) ||
      records.some(
        ({ record }) => record.reservationId === intent.reservationId && record.state !== 'REVOKED',
      )
    )
      return false;
    return canCompact(
      {
        status: 'REVOKED',
        endedAtEpochMs: Math.max(...group.map((reservation) => reservation.retiringAtEpochMs!)),
        revokedAtEpochMs: Math.max(
          intent.firstRetireEpochMs,
          intent.lastAttemptEpochMs ?? 0,
          ...group.map((reservation) => reservation.remoteConfirmedAtEpochMs!),
        ),
        officialAdjustedAtEpochMs: Math.max(
          ...group.map((reservation) => reservation.releasedAtEpochMs!),
        ),
      },
      input.epochNowMs,
    );
  }
}

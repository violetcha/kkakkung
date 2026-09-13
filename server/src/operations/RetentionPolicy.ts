import type { OperationJournal } from './OperationJournal.js';
import type { UsageBudget } from './UsageBudget.js';
import { isEmptyReservationAbort } from './ReservationIntent.js';

export type RetentionRecord = Readonly<{
  status: 'PREPARED' | 'REVOKING' | 'REVOKED' | 'UNRESOLVED';
  endedAtEpochMs: number | null;
  revokedAtEpochMs: number | null;
  officialAdjustedAtEpochMs: number | null;
}>;

/** Eligibility only. The caller must durably checkpoint before compacting any journal data. */
export function canCompact(record: RetentionRecord, nowEpochMs: number): boolean {
  if (record.status !== 'REVOKED' || !Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0)
    return false;
  const times = [record.endedAtEpochMs, record.revokedAtEpochMs, record.officialAdjustedAtEpochMs];
  if (times.some((value) => value === null || !Number.isSafeInteger(value) || value < 0))
    return false;
  const confirmedAt = Math.max(...(times as number[]));
  return nowEpochMs >= confirmedAt && nowEpochMs - confirmedAt >= 24 * 60 * 60 * 1_000;
}

/** Use the persisted budget proof for every slice of a retired room lease.
 * OperationJournal checkpoints retained records before replacing the log.
 * Call after official reconciliation, with retirement/lease mutation serialized by the owner.
 */
export function compactConfirmedRetirements(
  journal: OperationJournal,
  budget: UsageBudget,
  nowEpochMs: number,
): ReturnType<OperationJournal['compact']> {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0)
    return Promise.reject(new Error('INVALID_RETENTION_CLOCK'));
  const snapshot = budget.snapshot();
  if (snapshot.integrity !== 'ok' || !snapshot.writable)
    return Promise.reject(new Error('RETENTION_BUDGET_UNVERIFIED'));
  const reservations = snapshot.reservations;
  return journal.compact((record) => {
    if (record.state === 'ABORTED')
      return (
        isEmptyReservationAbort(record, budget.readSnapshot().reservations) &&
        record.atEpochMs! <= nowEpochMs - 86_400_000
      );
    if (!record.reservationId || record.atEpochMs === undefined) return false;
    const matching = reservations.filter(
      (reservation) =>
        reservation.request.reservationId === record.reservationId ||
        reservation.request.reservationId.startsWith(`${record.reservationId}:`),
    );
    if (
      !matching.some((reservation) => reservation.request.reservationId === record.reservationId) ||
      matching.some(
        (reservation) =>
          reservation.request.matchId !== record.matchId ||
          reservation.status !== 'RELEASED' ||
          reservation.retiringAtEpochMs === null ||
          reservation.remoteConfirmedAtEpochMs === null ||
          reservation.releasedAtEpochMs === null,
      )
    )
      return false;
    return canCompact(
      {
        status: record.state,
        endedAtEpochMs: Math.max(...matching.map((r) => r.retiringAtEpochMs!)),
        revokedAtEpochMs: Math.max(
          record.atEpochMs,
          ...matching.map((r) => r.remoteConfirmedAtEpochMs!),
        ),
        officialAdjustedAtEpochMs: Math.max(...matching.map((r) => r.releasedAtEpochMs!)),
      },
      nowEpochMs,
    );
  });
}

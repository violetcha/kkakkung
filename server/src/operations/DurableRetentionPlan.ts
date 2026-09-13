import { checksum } from './CheckpointStore.js';
import type { JournalEntry } from './OperationJournal.js';
import { canCompact } from './RetentionPolicy.js';
import type { RetryIntent } from './RevocationRetries.js';
import type { UsageReservation } from './UsageCheckpoint.js';
import { usageReservationEpoch } from './UsageReservationId.js';

export const RETENTION_MS = 24 * 60 * 60 * 1_000;
export const RETENTION_BATCH_ROOTS = 256;

export function belongsToReservation(id: string, root: string): boolean {
  if (id === root) return true;
  const suffix = id.slice(root.length + 1);
  return id.startsWith(`${root}:`) && /^[1-9]\d*$/.test(suffix) && !suffix.includes('\n');
}

export function reservationGroup(
  reservations: readonly UsageReservation[],
  root: string,
): readonly UsageReservation[] {
  return reservations.filter((r) => belongsToReservation(r.request.reservationId, root));
}

export function releasedGroupIsOld(
  group: readonly UsageReservation[],
  root: string,
  now: number,
): boolean {
  const first = group.find((r) => r.request.reservationId === root);
  return (
    !!first &&
    group.every(
      (r) =>
        r.request.matchId === first.request.matchId &&
        r.status === 'RELEASED' &&
        r.createdAtEpochMs <= now - RETENTION_MS &&
        canCompact(
          {
            status: 'REVOKED',
            endedAtEpochMs: r.retiringAtEpochMs,
            revokedAtEpochMs: r.remoteConfirmedAtEpochMs,
            officialAdjustedAtEpochMs: r.releasedAtEpochMs,
          },
          now,
        ),
    )
  );
}

/** Immutable terminal groups only. An orphan RELEASED group is a resumable crash prefix. */
export function planDurableRetention(input: {
  reservations: readonly UsageReservation[];
  records: readonly JournalEntry[];
  intents: readonly RetryIntent[];
  now: number;
}): ReadonlyMap<string, string> {
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error('INVALID_RETENTION_CLOCK');
  const roots = input.reservations.filter((r) => !/:[1-9]\d*$/.test(r.request.reservationId));
  const result = new Map<string, string>();
  for (const reservation of roots) {
    if (result.size >= RETENTION_BATCH_ROOTS) break;
    const root = reservation.request.reservationId;
    const issuedAt = usageReservationEpoch(root);
    if (issuedAt !== null && issuedAt > input.now - RETENTION_MS) continue;
    const group = reservationGroup(input.reservations, root);
    if (!releasedGroupIsOld(group, root, input.now)) continue;
    const records = input.records.filter((entry) => entry.record.reservationId === root);
    if (
      records.some(
        ({ record }) =>
          record.state !== 'REVOKED' ||
          record.matchId !== reservation.request.matchId ||
          record.expiresAtEpochMs > input.now ||
          record.atEpochMs === undefined ||
          record.atEpochMs > input.now - RETENTION_MS,
      )
    )
      continue;
    if (
      input.intents.some(
        (intent) =>
          intent.reservationId === root &&
          (intent.status !== 'REVOKED' ||
            Math.max(intent.firstRetireEpochMs, intent.lastAttemptEpochMs ?? 0) >
              input.now - RETENTION_MS),
      )
    )
      continue;
    result.set(root, checksum(group));
  }
  return result;
}

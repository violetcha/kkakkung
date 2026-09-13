import { checksum, strictObject } from './CheckpointStore.js';
import type { JournalRecord } from './OperationJournal.js';
import { ownedMediaTargets } from './SplitMediaOwnership.js';
import {
  validateUsageRequest,
  type UsageRequest,
  type UsageReservation,
} from './UsageCheckpoint.js';

/** First-slice ownership recorded before any budget write. COMMITTED is required before signing. */
export type ReservationIntent = Readonly<{
  phase: 'RESERVING' | 'COMMITTED';
  requests: readonly UsageRequest[];
}>;

export function validateReservationIntent(value: unknown, owner: JournalRecord): ReservationIntent {
  const parsed = strictObject(value, ['phase', 'requests']);
  if (
    !owner.splitOwnership ||
    !owner.reservationId ||
    !['RESERVING', 'COMMITTED'].includes(parsed.phase as string) ||
    !Array.isArray(parsed.requests)
  )
    throw new Error('INVALID_RESERVATION_INTENT');
  const requests = parsed.requests.map(validateUsageRequest);
  if (
    requests.length !== Math.ceil(ownedMediaTargets(owner).length / 6) ||
    requests.some(
      (request, index) =>
        request.reservationId !==
          (index === 0 ? owner.reservationId : `${owner.reservationId}:${index}`) ||
        request.matchId !== owner.matchId ||
        request.purpose !== 'public' ||
        request.expectedMinutes !== 5 ||
        request.margin !== 1,
    )
  )
    throw new Error('RESERVATION_INTENT_OWNERSHIP_MISMATCH');
  if (
    (owner.state === 'ABORTED' && parsed.phase !== 'RESERVING') ||
    (parsed.phase === 'RESERVING' && owner.forwardIntents?.length)
  )
    throw new Error('RESERVATION_INTENT_STATE_MISMATCH');
  return { phase: parsed.phase as ReservationIntent['phase'], requests };
}

export function reservationGroupFor(
  owner: Pick<JournalRecord, 'reservationId'>,
  reservations: readonly UsageReservation[],
) {
  const root = owner.reservationId;
  return reservations.filter(
    ({ request }) =>
      request.reservationId === root || (root && request.reservationId.startsWith(root + ':')),
  );
}

export function validReservationTransition(previous: JournalRecord, next: JournalRecord): boolean {
  const before = previous.reservationIntent;
  const after = next.reservationIntent;
  if (previous.state === 'ABORTED' && next.state !== 'ABORTED') return false;
  if (!before) return after === undefined; // An existing generation never gains a pre-signing claim.
  return (
    !!after &&
    checksum(before.requests) === checksum(after.requests) &&
    !(before.phase === 'COMMITTED' && after.phase !== 'COMMITTED')
  );
}

/** Call only with a validated journal record and integrity-checked complete usage inventory. */
export function isEmptyReservationAbort(
  owner: JournalRecord,
  reservations: readonly UsageReservation[],
): boolean {
  return (
    owner.state === 'ABORTED' &&
    owner.reservationIntent?.phase === 'RESERVING' &&
    owner.atEpochMs !== undefined &&
    owner.atEpochMs >= owner.issuedAtEpochMs &&
    !owner.forwardIntents?.length &&
    reservationGroupFor(owner, reservations).length === 0
  );
}

/** RESERVING can have only a durable prefix of its first slice, never an unrelated or renewed lease. */
export function reservationIntentMatches(
  owner: JournalRecord,
  reservations: readonly UsageReservation[],
): boolean {
  if (!owner.reservationIntent) return true;
  const group = reservationGroupFor(owner, reservations);
  if (owner.state === 'ABORTED') return group.length === 0;
  const plan = owner.reservationIntent.requests;
  const committed = owner.reservationIntent.phase === 'COMMITTED';
  if ((!committed && group.length > plan.length) || (committed && group.length < plan.length))
    return false;
  return plan.slice(0, committed ? plan.length : group.length).every((request) => {
    const actual = group.find(
      (reservation) => reservation.request.reservationId === request.reservationId,
    );
    return actual !== undefined && checksum(actual.request) === checksum(request);
  });
}

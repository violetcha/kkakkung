import type { JournalEntry } from './OperationJournal.js';
import type { RetryIntent } from './RevocationRetries.js';
import type { UsageReservation } from './UsageCheckpoint.js';
import { ownedMediaRooms } from './SplitMediaOwnership.js';

// LiveKit refreshes connected clients' tokens for at least 10 minutes. Original JWT expiry
// alone cannot retire a room. Require durable revocation, accounting and this refresh horizon.
// https://docs.livekit.io/frontends/reference/tokens-grants/#token-refresh
export const REFRESHED_TOKEN_HORIZON_MS = 10 * 60 * 1000;

export function expiredRetirementIsProven(input: {
  roomName: string;
  records: readonly JournalEntry[];
  liveRecords: readonly JournalEntry[];
  reservations: readonly UsageReservation[];
  intents: readonly RetryIntent[];
  now: number;
  clockBufferMs: number;
}): boolean {
  const { now, clockBufferMs } = input;
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(clockBufferMs) ||
    clockBufferMs < 1000 ||
    clockBufferMs >= 61_000
  )
    return false;
  const records = input.records.filter(({ record }) =>
    ownedMediaRooms(record).includes(input.roomName),
  );
  const live = input.liveRecords.filter(({ record }) =>
    ownedMediaRooms(record).includes(input.roomName),
  );
  if (
    records.length === 0 ||
    live.length !== records.length ||
    records.some((entry) => !live.some((current) => current.checksum === entry.checksum))
  )
    return false;
  const roots = new Set<string>();
  for (const { record } of records) {
    if (
      record.state !== 'REVOKED' ||
      !record.reservationId ||
      record.atEpochMs === undefined ||
      !Number.isSafeInteger(record.atEpochMs + REFRESHED_TOKEN_HORIZON_MS + clockBufferMs) ||
      record.expiresAtEpochMs + clockBufferMs > now ||
      record.atEpochMs + REFRESHED_TOKEN_HORIZON_MS + clockBufferMs > now
    )
      return false;
    roots.add(record.reservationId);
    const group = input.reservations.filter(
      (r) =>
        r.request.reservationId === record.reservationId ||
        (r.request.reservationId.startsWith(`${record.reservationId}:`) &&
          /^[1-9]\d*$/.test(r.request.reservationId.slice(record.reservationId!.length + 1))),
    );
    if (
      !group.some((r) => r.request.reservationId === record.reservationId) ||
      group.some(
        (r) =>
          r.request.matchId !== record.matchId ||
          r.status !== 'RELEASED' ||
          [r.retiringAtEpochMs, r.remoteConfirmedAtEpochMs, r.releasedAtEpochMs].some(
            (at) =>
              at === null ||
              !Number.isSafeInteger(at + REFRESHED_TOKEN_HORIZON_MS + clockBufferMs) ||
              at + REFRESHED_TOKEN_HORIZON_MS + clockBufferMs > now,
          ),
      )
    )
      return false;
  }
  return input.intents.every(
    (intent) =>
      !roots.has(intent.reservationId) ||
      (intent.status === 'REVOKED' &&
        Math.max(intent.firstRetireEpochMs, intent.lastAttemptEpochMs ?? 0) +
          REFRESHED_TOKEN_HORIZON_MS +
          clockBufferMs <=
          now),
  );
}

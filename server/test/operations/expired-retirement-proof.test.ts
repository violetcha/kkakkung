import { describe, expect, it } from 'vitest';
import { checksum } from '../../src/operations/CheckpointStore.js';
import {
  expiredRetirementIsProven,
  REFRESHED_TOKEN_HORIZON_MS,
} from '../../src/operations/ExpiredRetirementProof.js';
import type { JournalEntry, JournalRecord } from '../../src/operations/OperationJournal.js';
import type { UsageReservation } from '../../src/operations/UsageCheckpoint.js';
import type { RetryIntent } from '../../src/operations/RevocationRetries.js';

const record: JournalRecord = {
  namespace: 'qa-e',
  state: 'REVOKED',
  matchId: 'm',
  mediaInstanceId: 'game',
  roomName: 'r',
  serverEpoch: 'e',
  identity: 'i',
  generation: 1,
  issuedAtEpochMs: 1000,
  expiresAtEpochMs: 301000,
  reservationId: 'root',
  atEpochMs: 3000,
};
const entry = (r: JournalRecord): JournalEntry => {
  const payload = { version: 1 as const, seq: 1, record: r };
  return { ...payload, checksum: checksum(payload) };
};
const reservation: UsageReservation = {
  request: {
    reservationId: 'root',
    matchId: 'm',
    purpose: 'public',
    slots: 6,
    expectedMinutes: 5,
    expectedBytes: 1000,
    margin: 0,
  },
  status: 'RELEASED',
  minutes: 30,
  bytes: 1000,
  createdAtEpochMs: 1000,
  retiringAtEpochMs: 2000,
  retiringAfterVersion: 1,
  retiringPeriodId: 'provider-quota',
  remoteConfirmedAtEpochMs: 3000,
  releasedAtEpochMs: 4000,
};
const retry: RetryIntent = {
  retirementId: 'retired',
  reservationId: 'root',
  identity: 'i',
  generation: 1,
  firstRetireEpochMs: 2000,
  lastAttemptEpochMs: 3000,
  nextAttemptEpochMs: null,
  attempt: 1,
  status: 'REVOKED',
  alarmed: false,
  providerWaitUnknown: false,
};
const input = () => ({
  roomName: 'r',
  records: [entry(record)],
  liveRecords: [entry(record)],
  reservations: [reservation],
  intents: [retry],
  now: 4000 + REFRESHED_TOKEN_HORIZON_MS + 3100,
  clockBufferMs: 3100,
});

describe('server proof required before reusing retired-room absence', () => {
  it('waits for the original and refreshed token horizons plus the verified clock buffer', () => {
    const data = input();
    expect(expiredRetirementIsProven({ ...data, now: record.expiresAtEpochMs + 1 })).toBe(false);
    expect(expiredRetirementIsProven({ ...data, now: data.now - 1 })).toBe(false);
    expect(expiredRetirementIsProven(data)).toBe(true);
    const longLived = entry({ ...record, expiresAtEpochMs: data.now + 1 });
    expect(
      expiredRetirementIsProven({ ...data, records: [longLived], liveRecords: [longLived] }),
    ).toBe(false);
  });
  it('requires the same durable generation and all settled usage slices in the same match', () => {
    const data = input();
    expect(expiredRetirementIsProven({ ...data, liveRecords: [] })).toBe(false);
    expect(
      expiredRetirementIsProven({ ...data, liveRecords: [entry({ ...record, generation: 2 })] }),
    ).toBe(false);
    const active = {
      ...reservation,
      request: { ...reservation.request, reservationId: 'root:1' },
      status: 'ACTIVE' as const,
    };
    expect(expiredRetirementIsProven({ ...data, reservations: [reservation, active] })).toBe(false);
    expect(
      expiredRetirementIsProven({
        ...data,
        reservations: [{ ...reservation, request: { ...reservation.request, matchId: 'other' } }],
      }),
    ).toBe(false);
    expect(expiredRetirementIsProven({ ...data, reservations: [] })).toBe(false);
  });
  it('retains missing revocation timestamps, pending retries, recent confirmation and invalid clocks', () => {
    const data = input();
    const missing = { ...record };
    delete missing.atEpochMs;
    expect(
      expiredRetirementIsProven({
        ...data,
        records: [entry(missing)],
        liveRecords: [entry(missing)],
      }),
    ).toBe(false);
    expect(
      expiredRetirementIsProven({ ...data, intents: [{ ...retry, status: 'UNRESOLVED' }] }),
    ).toBe(false);
    expect(
      expiredRetirementIsProven({
        ...data,
        reservations: [{ ...reservation, releasedAtEpochMs: data.now }],
      }),
    ).toBe(false);
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, -1])
      expect(expiredRetirementIsProven({ ...data, now })).toBe(false);
    for (const clockBufferMs of [-1, 0, 61_000, Number.NaN])
      expect(expiredRetirementIsProven({ ...data, clockBufferMs })).toBe(false);
  });
});

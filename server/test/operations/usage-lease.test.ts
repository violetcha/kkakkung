import { describe, expect, it, vi } from 'vitest';
import { MediaUsageLease } from '../../src/operations/MediaUsageLease.js';
import type { UsageBudget } from '../../src/operations/UsageBudget.js';
import type { Generation } from '../../src/media/MediaGenerationRegistry.js';
import { deferred, flush, prepareRequest } from '../media/generation-fixtures.js';

function generation(): Generation {
  return {
    request: prepareRequest,
    generation: 1,
    roomName: 'same-room',
    identity: 'identity-1',
    serverEpoch: 'epoch',
    reservationId: 'before-reserve',
    issuedAtEpochMs: 1000,
    expiresAtEpochMs: 301_000,
    terminal: false,
    state: 'PREPARED',
  };
}
function setup() {
  let now = 0;
  const budget = {
    reserve: vi.fn(async () => ({ status: 'reserved' })),
    markRetiring: vi.fn(async () => true),
    markRemoteConfirmed: vi.fn(async () => true),
    snapshot: vi.fn(() => ({
      reservations: [] as { request: { reservationId: string } }[],
    })),
  };
  const lease = new MediaUsageLease(budget as unknown as UsageBudget, () => now);
  return {
    lease,
    budget,
    now: (value: number) => {
      now = value;
    },
  };
}
describe('media usage lease lifetime', () => {
  it('shares an active room reservation but creates a fresh reservation after confirmed retirement', async () => {
    const s = setup();
    const first = generation();
    const another = { ...generation(), identity: 'identity-2' };
    expect(await s.lease.reserve(first)).toBe(true);
    expect(await s.lease.reserve(another)).toBe(true);
    expect(another.reservationId).toBe(first.reservationId);
    expect(s.budget.reserve).toHaveBeenCalledOnce();
    await s.lease.markRetiring(first.roomName);
    const reopened = { ...generation(), identity: 'identity-3', generation: 2 };
    expect(await s.lease.reserve(reopened)).toBe(true);
    expect(reopened.reservationId).not.toBe(first.reservationId);
    expect(s.budget.reserve).toHaveBeenCalledTimes(2);
    expect(s.budget.reserve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reservationId: expect.stringMatching(/^u1-0-[0-9a-f-]+$/) }),
    );
    expect(s.budget.reserve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reservationId: reopened.reservationId }),
    );
  });
  it('blocks reuse while remote confirmation persistence is pending and retains the lock on failure', async () => {
    const s = setup();
    const first = generation();
    await s.lease.reserve(first);
    const confirmation = deferred<boolean>();
    s.budget.markRemoteConfirmed = vi.fn(() => confirmation.promise);
    const closing = s.lease.markRetiring(first.roomName);
    await flush();
    expect(await s.lease.reserve({ ...generation(), generation: 2 })).toBe(false);
    expect(s.budget.reserve).toHaveBeenCalledOnce();
    confirmation.resolve(false);
    await expect(closing).rejects.toThrow('RESERVATION_WRITE_FAILED');
    expect(await s.lease.reserve({ ...generation(), generation: 2 })).toBe(false);
  });
  it('closes every durable minute slice before forgetting the retired lease', async () => {
    const s = setup();
    const first = generation();
    await s.lease.reserve(first);
    s.now(240_000);
    await s.lease.reserve(first);
    expect(s.budget.reserve).toHaveBeenCalledTimes(2);
    expect(s.budget.reserve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reservationId: `${first.reservationId}:1` }),
    );
    await s.lease.markRetiring(first.roomName);
    expect(s.budget.markRemoteConfirmed.mock.calls).toEqual([
      [first.reservationId],
      [`${first.reservationId}:1`],
    ]);
    const next = { ...generation(), generation: 2 };
    await s.lease.reserve(next);
    expect(next.reservationId).not.toBe(first.reservationId);
  });

  it('keeps a persisted reservation reachable when issuance closes during its write', async () => {
    const s = setup();
    const first = generation();
    s.budget.reserve = vi.fn(async () => ({ status: 'rejected', code: 'ISSUANCE_BLOCKED' }));
    s.budget.snapshot.mockImplementation(() => ({
      reservations: [{ request: { reservationId: first.reservationId! } }],
    }));
    await expect(s.lease.reserve(first)).rejects.toThrow('RESERVATION_UNCONFIRMED');
    expect(await s.lease.reserve({ ...generation(), identity: 'identity-2' })).toBe(false);
    expect(s.budget.reserve).toHaveBeenCalledOnce();
    expect(s.lease.remaining(first)).toBe(0);
    await s.lease.markRetiring(first.roomName);
    expect(s.budget.markRetiring).toHaveBeenCalledWith(first.reservationId);
    expect(s.budget.markRemoteConfirmed).toHaveBeenCalledWith(first.reservationId);
  });

  it('preserves an uncertain storage result for retirement even without a memory snapshot', async () => {
    const s = setup();
    const first = generation();
    s.budget.reserve = vi.fn(async () => ({ status: 'rejected', code: 'STORAGE_FAILURE' }));
    await expect(s.lease.reserve(first)).rejects.toThrow('RESERVATION_UNCONFIRMED');
    expect(await s.lease.reserve(first)).toBe(false);
    await s.lease.markRetiring(first.roomName);
    expect(s.budget.markRetiring).toHaveBeenCalledWith(first.reservationId);
  });

  it('returns an ordinary rejection when no durable reservation was created', async () => {
    const s = setup();
    s.budget.reserve = vi.fn(async () => ({ status: 'rejected', code: 'BYTES_EXHAUSTED' }));
    const first = generation();
    expect(await s.lease.reserve(first)).toBe(false);
    await s.lease.markRetiring(first.roomName);
    expect(s.budget.markRetiring).not.toHaveBeenCalled();
  });
});

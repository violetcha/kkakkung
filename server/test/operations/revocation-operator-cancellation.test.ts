import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RevocationRetries,
  type RetryIntent,
  type RevocationRetryOptions,
} from '../../src/operations/RevocationRetries.js';

const unresolved: RetryIntent = {
  retirementId: 'operator-retirement-1',
  reservationId: 'reservation-1',
  identity: 'synthetic-identity',
  generation: 1,
  firstRetireEpochMs: 100_000,
  lastAttemptEpochMs: 107_000,
  nextAttemptEpochMs: null,
  attempt: 3,
  status: 'UNRESOLVED',
  alarmed: true,
  providerWaitUnknown: false,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(overrides: Partial<RevocationRetryOptions> = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(120_000);
  const writes: RetryIntent[] = [];
  const sent = vi.fn();
  const confirmed = vi.fn(async () => undefined);
  const failure = vi.fn();
  const retries = new RevocationRetries({
    epochNowMs: () => Date.now(),
    monotonicNow: () => Date.now() - 100_000,
    persist: async (intent) => {
      writes.push(intent);
    },
    isTerminal: () => true,
    send: async (_intent, context) => {
      context.beforeDispatch();
      sent();
      return { status: 'confirmed' };
    },
    onConfirmed: confirmed,
    onUnresolved: vi.fn(),
    onPersistenceFailure: failure,
    ...overrides,
  });
  return { retries, writes, sent, confirmed, failure };
}

afterEach(() => vi.useRealTimers());

describe('operator retry cancellation boundaries', () => {
  it.each(['signal', 'guard', 'throwing-guard'] as const)(
    'rejects an already cancelled %s before writing or dispatching',
    async (kind) => {
      const f = fixture();
      await f.retries.restore([unresolved]);
      const abort = new AbortController();
      if (kind === 'signal') abort.abort();
      await expect(
        f.retries.retryNow(unresolved.retirementId, {
          signal: abort.signal,
          beforeDispatch: () => {
            if (kind === 'throwing-guard') throw new Error('sensitive-fixture-detail');
            return kind !== 'guard';
          },
        }),
      ).rejects.toThrow('OPERATOR_RETRY_CANCELLED');
      expect(f.writes).toEqual([]);
      expect(f.sent).not.toHaveBeenCalled();
      expect(f.failure).not.toHaveBeenCalled();
      await f.retries.close();
    },
  );

  it('cancels before a queued intent write executes without poisoning later authorized retries', async () => {
    const f = fixture();
    await f.retries.restore([unresolved]);
    const abort = new AbortController();
    const work = f.retries.retryNow(unresolved.retirementId, { signal: abort.signal });
    abort.abort();
    await expect(work).rejects.toThrow('OPERATOR_RETRY_CANCELLED');
    await Promise.resolve();
    expect(f.writes).toEqual([]);
    expect(f.sent).not.toHaveBeenCalled();
    expect(f.failure).not.toHaveBeenCalled();
    await f.retries.retryNow(unresolved.retirementId);
    expect(f.sent).toHaveBeenCalledTimes(1);
    await f.retries.close();
  });

  it('returns on abort during fsync, prevents dispatch, and drains accepted persistence on close', async () => {
    const gate = deferred();
    const entered = deferred();
    const f = fixture({
      persist: async () => {
        entered.resolve();
        await gate.promise;
      },
    });
    await f.retries.restore([unresolved]);
    const abort = new AbortController();
    const work = f.retries.retryNow(unresolved.retirementId, { signal: abort.signal });
    await entered.promise;
    abort.abort();
    await expect(work).rejects.toThrow('OPERATOR_RETRY_CANCELLED');
    let closed = false;
    const closing = f.retries.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    gate.resolve();
    await closing;
    expect(f.sent).not.toHaveBeenCalled();
    expect(f.failure).not.toHaveBeenCalled();
  });

  it('rechecks the operation guard at actual dispatch after a budget wait', async () => {
    const gate = deferred();
    const entered = deferred();
    const dispatched = vi.fn();
    const f = fixture({
      send: async (_intent, context) => {
        entered.resolve();
        await gate.promise;
        context.beforeDispatch();
        dispatched();
        return { status: 'confirmed' };
      },
    });
    await f.retries.restore([unresolved]);
    let active = true;
    const work = f.retries.retryNow(unresolved.retirementId, { beforeDispatch: () => active });
    await entered.promise;
    active = false;
    gate.resolve();
    await expect(work).rejects.toThrow('OPERATOR_RETRY_CANCELLED');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatched).not.toHaveBeenCalled();
    expect(f.retries.snapshot()[0]?.status).toBe('UNRESOLVED');
    expect(f.failure).not.toHaveBeenCalled();
    await f.retries.close();
  });

  it('preserves a late confirmed remote result while the cancelled operation remains rejected', async () => {
    const gate = deferred();
    const dispatched = deferred();
    const f = fixture({
      send: async (_intent, context) => {
        context.beforeDispatch();
        dispatched.resolve();
        await gate.promise;
        return { status: 'confirmed' };
      },
    });
    await f.retries.restore([unresolved]);
    const abort = new AbortController();
    const work = f.retries.retryNow(unresolved.retirementId, { signal: abort.signal });
    await dispatched.promise;
    abort.abort();
    await expect(work).rejects.toThrow('OPERATOR_RETRY_CANCELLED');
    gate.resolve();
    await f.retries.close();
    expect(f.writes.at(-1)?.status).toBe('REVOKED');
    expect(f.confirmed).toHaveBeenCalledTimes(1);
    expect(f.failure).not.toHaveBeenCalled();
  });

  it('does not clear an unknown provider wait just because an operator submitted retry', async () => {
    const f = fixture();
    await f.retries.restore([{ ...unresolved, providerWaitUnknown: true }]);
    await expect(
      f.retries.retryNow(unresolved.retirementId, { signal: new AbortController().signal }),
    ).rejects.toThrow('PROVIDER_WAIT_UNCONFIRMED');
    expect(f.writes).toEqual([]);
    expect(f.sent).not.toHaveBeenCalled();
    await f.retries.close();
  });

  it.each(['unknown', 'known'] as const)(
    'persists a late %s provider wait even though its operation has already timed out',
    async (kind) => {
      const gate = deferred();
      const dispatched = deferred();
      const f = fixture({
        send: async (_intent, context) => {
          context.beforeDispatch();
          dispatched.resolve();
          await gate.promise;
          return kind === 'unknown'
            ? { status: 'blocked' }
            : { status: 'retry', retryAfterMs: 30_000 };
        },
      });
      await f.retries.restore([unresolved]);
      const abort = new AbortController();
      const work = f.retries.retryNow(unresolved.retirementId, { signal: abort.signal });
      await dispatched.promise;
      abort.abort();
      await expect(work).rejects.toThrow('OPERATOR_RETRY_CANCELLED');
      gate.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await expect(f.retries.retryNow(unresolved.retirementId)).rejects.toThrow(
        kind === 'unknown' ? 'PROVIDER_WAIT_UNCONFIRMED' : 'RETRY_NOT_DUE',
      );
      expect(f.retries.snapshot()[0]?.status).toBe('UNRESOLVED');
      expect(f.failure).not.toHaveBeenCalled();
      await f.retries.close();
    },
  );

  it('keeps unknown wait proof unchanged when cancelled before its queued confirmation write', async () => {
    const f = fixture();
    await f.retries.restore([{ ...unresolved, providerWaitUnknown: true }]);
    const abort = new AbortController();
    const work = f.retries.retryNow(unresolved.retirementId, {
      signal: abort.signal,
      providerWaitConfirmed: true,
    });
    abort.abort();
    await expect(work).rejects.toThrow('OPERATOR_RETRY_CANCELLED');
    expect(f.retries.snapshot()[0]?.providerWaitUnknown).toBe(true);
    expect(f.writes).toEqual([]);
    await f.retries.close();
  });

  it('keeps a provider Retry-After deadline for an authorized operator retry', async () => {
    const f = fixture();
    await f.retries.restore([{ ...unresolved, nextAttemptEpochMs: 125_000 }]);
    await expect(f.retries.retryNow(unresolved.retirementId)).rejects.toThrow('RETRY_NOT_DUE');
    expect(f.sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    await f.retries.retryNow(unresolved.retirementId);
    expect(f.sent).toHaveBeenCalledTimes(1);
    await f.retries.close();
  });

  it('still treats a real persistence failure as a writer failure', async () => {
    const f = fixture({ persist: async () => Promise.reject(new Error('fixture disk failure')) });
    await f.retries.restore([unresolved]);
    await expect(f.retries.retryNow(unresolved.retirementId)).rejects.toThrow(
      'fixture disk failure',
    );
    expect(f.failure).toHaveBeenCalledTimes(1);
    expect(f.sent).not.toHaveBeenCalled();
    await expect(f.retries.close()).rejects.toThrow('fixture disk failure');
  });
});

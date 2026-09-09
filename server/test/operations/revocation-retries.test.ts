import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RevocationRetries,
  type RetryAttemptResult,
  type RetryIntent,
  type RevocationRetryOptions,
  validateRetryIntent,
} from '../../src/operations/RevocationRetries.js';
import { canCompact } from '../../src/operations/RetentionPolicy.js';

afterEach(() => vi.useRealTimers());

const input = {
  retirementId: 'retirement-1',
  reservationId: 'reservation-1',
  identity: 'synthetic-identity',
  generation: 1,
};

function setup(
  send: RevocationRetryOptions['send'] = async () => ({ status: 'retry' }),
  overrides: Partial<RevocationRetryOptions> = {},
) {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const persisted: RetryIntent[] = [];
  const alarm = vi.fn();
  const confirmed = vi.fn(async () => undefined);
  const attempts: number[] = [];
  const retries = new RevocationRetries({
    epochNowMs: () => Date.now(),
    monotonicNow: () => Date.now() - 100_000,
    persist: async (intent) => {
      persisted.push(intent);
    },
    send: async (intent, context) => {
      attempts.push(Date.now());
      return send(intent, context);
    },
    isTerminal: () => true,
    onConfirmed: confirmed,
    onUnresolved: alarm,
    ...overrides,
  });
  return { retries, persisted, attempts, alarm, confirmed };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function manualTimers() {
  const timers: { callback: () => void; delayMs: number; cancelled: boolean }[] = [];
  const setTimer = (callback: () => void, delayMs: number) => {
    const timer = {
      callback: () => {
        timer.cancelled = true;
        callback();
      },
      delayMs,
      cancelled: false,
    };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (handle: unknown) => {
    (handle as (typeof timers)[number]).cancelled = true;
  };
  return { timers, setTimer, clearTimer };
}

describe('bounded revocation retry and durable retention', () => {
  it('persists the initial unknown provider wait before any timer and preserves it across boot', async () => {
    const first = setup();
    await first.retries.begin({ ...input, providerWaitUnknown: true });
    expect(first.persisted[0]).toMatchObject({
      status: 'UNRESOLVED',
      providerWaitUnknown: true,
      alarmed: true,
      nextAttemptEpochMs: null,
    });
    const snapshot = first.retries.snapshot();
    expect(first.alarm).toHaveBeenCalledTimes(1);
    await first.retries.close();
    const restored = setup();
    await restored.retries.restore(snapshot);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(restored.attempts).toEqual([]);
    expect(restored.alarm).not.toHaveBeenCalled();
    await expect(restored.retries.retryNow(input.retirementId)).rejects.toThrow(
      'PROVIDER_WAIT_UNCONFIRMED',
    );
    await restored.retries.close();
  });

  it('applies an initial known Retry-After before its first retry', async () => {
    const { retries, attempts } = setup(async () => ({ status: 'confirmed' }));
    await retries.begin({ ...input, retryAfterMs: 5_000 });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(attempts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([105_000]);
    await retries.close();
  });
  it('persists an unknown provider wait and requires explicit confirmed wait before an operator retry', async () => {
    const { retries, attempts, alarm } = setup(async () => ({ status: 'blocked' }));
    await retries.begin(input);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(attempts).toHaveLength(1);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(retries.snapshot()[0]).toMatchObject({
      status: 'UNRESOLVED',
      providerWaitUnknown: true,
    });
    await expect(retries.retryNow(input.retirementId)).rejects.toThrow('PROVIDER_WAIT_UNCONFIRMED');
    await retries.retryNow(input.retirementId, { providerWaitConfirmed: true });
    expect(attempts).toHaveLength(2);
    await retries.close();
  });
  it('persists intent then attempts after 1/2/4 seconds and alarms once at 10 seconds', async () => {
    const { retries, persisted, attempts, alarm, confirmed } = setup();
    await retries.begin(input);
    expect(persisted[0]).toMatchObject({ attempt: 0, nextAttemptEpochMs: 101_000 });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(attempts).toEqual([101_000, 103_000, 107_000]);
    expect(alarm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(persisted.at(-1)).toMatchObject({ status: 'UNRESOLVED', attempt: 3, alarmed: true });
    await vi.advanceTimersByTimeAsync(100_000);
    expect(attempts).toHaveLength(3);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(confirmed).not.toHaveBeenCalled();
    await retries.close();
  });

  it('persists remote confirmation before notifying occupancy cleanup', async () => {
    const { retries, persisted, confirmed, alarm } = setup(async () => ({ status: 'confirmed' }));
    await retries.begin(input);
    confirmed.mockImplementation(async () => {
      expect(persisted.at(-1)?.status).toBe('REVOKED');
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(retries.snapshot()[0]?.status).toBe('REVOKED');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(alarm).not.toHaveBeenCalled();
    // No usage-budget release callback exists here; official reconciliation owns that transition.
    await retries.close();
  });

  it('honors provider Retry-After beyond the target, keeps an alarm, and denies premature operator retry', async () => {
    const { retries, attempts, alarm } = setup(async () => ({
      status: 'retry',
      retryAfterMs: 20_000,
    }));
    await retries.begin(input);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts).toEqual([101_000]);
    expect(alarm).toHaveBeenCalledTimes(1);
    await expect(retries.retryNow(input.retirementId)).rejects.toThrow('RETRY_NOT_DUE');
    await vi.advanceTimersByTimeAsync(11_000);
    await retries.retryNow(input.retirementId);
    expect(attempts).toEqual([101_000, 121_000]);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(attempts).toHaveLength(2);
    expect(alarm).toHaveBeenCalledTimes(1);
    await retries.close();
  });

  it('alarms at the deadline even when a sent request has not returned; late success remains durable', async () => {
    let finish!: (value: RetryAttemptResult) => void;
    const { retries, alarm, confirmed } = setup(
      () => new Promise<RetryAttemptResult>((resolve) => (finish = resolve)),
    );
    await retries.begin(input);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(retries.snapshot()[0]?.status).toBe('UNRESOLVED');
    finish({ status: 'confirmed' });
    await vi.advanceTimersByTimeAsync(0);
    expect(retries.snapshot()[0]?.status).toBe('REVOKED');
    expect(confirmed).toHaveBeenCalledTimes(1);
    await retries.close();
  });

  it('restores an expired intent as unresolved without sending or resetting its lifetime', async () => {
    const { retries, attempts, alarm } = setup();
    await retries.restore([
      {
        ...input,
        firstRetireEpochMs: 80_000,
        lastAttemptEpochMs: 87_000,
        nextAttemptEpochMs: null,
        attempt: 3,
        status: 'REVOKING',
        alarmed: false,
        providerWaitUnknown: false,
      },
    ]);
    expect(retries.snapshot()[0]?.status).toBe('UNRESOLVED');
    expect(attempts).toEqual([]);
    expect(alarm).toHaveBeenCalledTimes(1);
    await retries.close();
  });

  it('never sends before durable intent persistence or for a nonterminal generation', async () => {
    const persist = vi.fn(async () => {
      throw new Error('disk failure');
    });
    const send = vi.fn(async (): Promise<RetryAttemptResult> => ({ status: 'confirmed' }));
    const retries = new RevocationRetries({
      epochNowMs: () => 100_000,
      monotonicNow: () => 0,
      persist,
      send,
      isTerminal: () => true,
      onConfirmed: async () => undefined,
      onUnresolved: vi.fn(),
    });
    await expect(retries.begin(input)).rejects.toThrow('disk failure');
    expect(send).not.toHaveBeenCalled();
    await expect(retries.close()).rejects.toThrow('disk failure');

    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const nonterminal = new RevocationRetries({
      epochNowMs: () => Date.now(),
      monotonicNow: () => Date.now() - 100_000,
      persist: async () => undefined,
      send,
      isTerminal: () => false,
      onConfirmed: async () => undefined,
      onUnresolved: vi.fn(),
    });
    await nonterminal.begin(input);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).not.toHaveBeenCalled();
    expect(nonterminal.snapshot()[0]?.status).toBe('UNRESOLVED');
    await nonterminal.close();
  });

  it('locks every entry on initial persistence failure and reports the failure once', async () => {
    const locked = vi.fn();
    const { retries, attempts } = setup(undefined, {
      persist: async (intent) => {
        if (intent.retirementId === 'failed') throw new Error('disk failure');
      },
      onPersistenceFailure: locked,
    });
    await retries.begin(input);
    await expect(retries.begin({ ...input, retirementId: 'failed' })).rejects.toThrow(
      'disk failure',
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempts).toEqual([]);
    expect(locked).toHaveBeenCalledTimes(1);
    await expect(retries.begin({ ...input, retirementId: 'new' })).rejects.toThrow(
      'RETRIES_CLOSED',
    );
    await expect(retries.close()).rejects.toThrow('disk failure');
    expect(locked).toHaveBeenCalledTimes(1);
  });

  it('locks retries when persisting an operator wait confirmation fails', async () => {
    const locked = vi.fn();
    const { retries, attempts } = setup(undefined, {
      persist: async (intent) => {
        if (!intent.providerWaitUnknown) throw new Error('disk failure');
      },
      onPersistenceFailure: locked,
    });
    await retries.begin({ ...input, providerWaitUnknown: true });
    await expect(
      retries.retryNow(input.retirementId, { providerWaitConfirmed: true }),
    ).rejects.toThrow('disk failure');
    expect(locked).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual([]);
    await expect(retries.retryNow(input.retirementId)).rejects.toThrow('RETRIES_CLOSED');
    await expect(retries.close()).rejects.toThrow('disk failure');
  });

  it('does not send when shutdown starts while the attempt intent is being persisted', async () => {
    const writing = deferred<void>();
    const { retries, attempts } = setup(undefined, {
      persist: async (intent) => {
        if (intent.attempt === 1) await writing.promise;
      },
    });
    await retries.begin(input);
    await vi.advanceTimersByTimeAsync(1_000);
    const closing = retries.close();
    writing.resolve();
    await closing;
    expect(attempts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send an automatic retry whose intent persistence outlives the target', async () => {
    const writing = deferred<void>();
    const { retries, attempts, alarm, confirmed } = setup(undefined, {
      persist: async (intent) => {
        if (intent.attempt === 1 && intent.status === 'REVOKING') await writing.promise;
      },
    });
    await retries.begin(input);
    await vi.advanceTimersByTimeAsync(10_000);
    writing.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([]);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(retries.snapshot()[0]).toMatchObject({ status: 'UNRESOLVED', alarmed: true });
    expect(confirmed).not.toHaveBeenCalled();
    await retries.close();
  });

  it.each(['deadline', 'shutdown', 'nonterminal'] as const)(
    'rechecks %s at actual dispatch after a downstream persistence or budget wait',
    async (boundary) => {
      const pending = deferred<void>();
      const dispatched = vi.fn();
      let terminal = true;
      const { retries, alarm } = setup(
        async (_intent, { beforeDispatch }) => {
          await pending.promise;
          beforeDispatch();
          dispatched();
          return { status: 'confirmed' };
        },
        { isTerminal: () => terminal },
      );
      await retries.begin(input);
      await vi.advanceTimersByTimeAsync(1_000);
      let closing: Promise<void> | undefined;
      if (boundary === 'shutdown') closing = retries.close();
      else if (boundary === 'deadline') await vi.advanceTimersByTimeAsync(9_000);
      else terminal = false;
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(dispatched).not.toHaveBeenCalled();
      if (boundary === 'deadline') expect(alarm).toHaveBeenCalledTimes(1);
      await (closing ?? retries.close());
    },
  );

  it('allows an explicitly authorized operator dispatch after the original target', async () => {
    const dispatched = vi.fn();
    const { retries } = setup(async (_intent, { beforeDispatch }) => {
      beforeDispatch();
      dispatched();
      return { status: 'confirmed' };
    });
    await retries.begin({ ...input, providerWaitUnknown: true });
    await vi.advanceTimersByTimeAsync(20_000);
    await retries.retryNow(input.retirementId, { providerWaitConfirmed: true });
    expect(dispatched).toHaveBeenCalledTimes(1);
    expect(retries.snapshot()[0]?.status).toBe('REVOKED');
    await retries.close();
  });

  it('does not send a retry callback delayed by the event loop beyond the target', async () => {
    const clock = manualTimers();
    const { retries, attempts, alarm } = setup(undefined, clock);
    await retries.begin(input);
    const retry = clock.timers.find((timer) => timer.delayMs === 1_000)!;
    vi.setSystemTime(111_000);
    retry.callback();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([]);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(retries.snapshot()[0]?.status).toBe('UNRESOLVED');
    await retries.close();
  });

  it('rearms early retry and alarm callbacks against their monotonic deadlines', async () => {
    const clock = manualTimers();
    let monotonic = 0;
    const { retries, attempts, alarm } = setup(undefined, {
      ...clock,
      monotonicNow: () => monotonic,
    });
    await retries.begin(input);
    monotonic = 999.75;
    clock.timers.find((timer) => timer.delayMs === 1_000)!.callback();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([]);
    expect(clock.timers.at(-1)?.delayMs).toBe(1);
    monotonic = 9_999.75;
    clock.timers.find((timer) => !timer.cancelled && timer.delayMs > 1)!.callback();
    await vi.advanceTimersByTimeAsync(0);
    expect(alarm).not.toHaveBeenCalled();
    monotonic = 10_000;
    clock.timers.find((timer) => !timer.cancelled && timer.delayMs === 1)!.callback();
    await vi.advanceTimersByTimeAsync(0);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual([]);
    await retries.close();
  });

  it.each(['invalid', 'duplicate', 'future'] as const)(
    'restores no records or timers when a later record is %s',
    async (problem) => {
      const { retries, persisted, attempts } = setup();
      const valid: RetryIntent = {
        ...input,
        firstRetireEpochMs: 100_000,
        lastAttemptEpochMs: null,
        nextAttemptEpochMs: 101_000,
        attempt: 0,
        status: 'REVOKING',
        alarmed: false,
        providerWaitUnknown: false,
      };
      const second =
        problem === 'duplicate'
          ? valid
          : {
              ...valid,
              retirementId: 'second',
              ...(problem === 'invalid'
                ? { generation: 0 }
                : { firstRetireEpochMs: 200_000, nextAttemptEpochMs: 201_000 }),
            };
      await expect(retries.restore([valid, second])).rejects.toThrow();
      expect(retries.snapshot()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(persisted).toEqual([]);
      expect(attempts).toEqual([]);
      await retries.close();
    },
  );

  it('rebases a restored known provider wait onto the new process monotonic clock', async () => {
    const first = setup();
    await first.retries.begin({ ...input, retryAfterMs: 5_000 });
    const snapshot = first.retries.snapshot();
    await first.retries.close();
    const { retries, attempts } = setup(async () => ({ status: 'confirmed' }), {
      monotonicNow: () => Date.now() - 102_000,
    });
    vi.setSystemTime(102_000);
    await retries.restore(snapshot);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(attempts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([105_000]);
    await retries.close();
  });

  it('serializes concurrent operator attempts without a second remote send', async () => {
    const remote = deferred<RetryAttemptResult>();
    const { retries, attempts } = setup(() => remote.promise);
    await retries.begin({ ...input, providerWaitUnknown: true });
    const first = retries.retryNow(input.retirementId, { providerWaitConfirmed: true });
    await vi.advanceTimersByTimeAsync(0);
    await expect(retries.retryNow(input.retirementId)).rejects.toThrow('RETRY_IN_FLIGHT');
    expect(attempts).toHaveLength(1);
    remote.resolve({ status: 'confirmed' });
    await first;
    expect(retries.snapshot()[0]?.status).toBe('REVOKED');
    await retries.close();
  });

  it('locks after occupancy confirmation fails without losing durable remote confirmation', async () => {
    const locked = vi.fn();
    const { retries, attempts, persisted } = setup(async () => ({ status: 'confirmed' }), {
      onConfirmed: async () => {
        throw new Error('occupancy write failed');
      },
      onPersistenceFailure: locked,
    });
    await retries.begin(input);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persisted.at(-1)?.status).toBe('REVOKED');
    expect(retries.snapshot()[0]?.status).toBe('REVOKED');
    expect(locked).toHaveBeenCalledTimes(1);
    await expect(retries.retryNow(input.retirementId)).rejects.toThrow('RETRIES_CLOSED');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempts).toHaveLength(1);
    await retries.close();
  });

  it('does not release occupancy when persisting the remote confirmation fails', async () => {
    const locked = vi.fn();
    const { retries, attempts, confirmed } = setup(async () => ({ status: 'confirmed' }), {
      persist: async (intent) => {
        if (intent.status === 'REVOKED') throw new Error('confirmation write failed');
      },
      onPersistenceFailure: locked,
    });
    await retries.begin(input);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(confirmed).not.toHaveBeenCalled();
    expect(retries.snapshot()[0]?.status).toBe('REVOKING');
    expect(locked).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempts).toHaveLength(1);
    await expect(retries.close()).rejects.toThrow('confirmation write failed');
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
    'requires provider wait confirmation after an invalid retry delay of %s',
    async (retryAfterMs) => {
      const { retries, attempts, alarm } = setup(async () => ({ status: 'retry', retryAfterMs }));
      await retries.begin(input);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(attempts).toHaveLength(1);
      expect(alarm).toHaveBeenCalledTimes(1);
      expect(retries.snapshot()[0]).toMatchObject({
        status: 'UNRESOLVED',
        providerWaitUnknown: true,
      });
      await expect(retries.retryNow(input.retirementId)).rejects.toThrow(
        'PROVIDER_WAIT_UNCONFIRMED',
      );
      await retries.close();
    },
  );

  it('finishes a persisted unresolved transition interrupted before its alarm was recorded', async () => {
    const { retries, persisted, alarm, attempts } = setup();
    await retries.restore([
      {
        ...input,
        firstRetireEpochMs: 90_000,
        lastAttemptEpochMs: 91_000,
        nextAttemptEpochMs: null,
        attempt: 1,
        status: 'UNRESOLVED',
        providerWaitUnknown: true,
        alarmed: false,
      },
    ]);
    expect(persisted.at(-1)).toMatchObject({ status: 'UNRESOLVED', alarmed: true });
    expect(alarm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual([]);
    await retries.close();
  });

  it('rejects contradictory persisted terminal and alarm states', () => {
    const base: RetryIntent = {
      ...input,
      firstRetireEpochMs: 100_000,
      lastAttemptEpochMs: 101_000,
      nextAttemptEpochMs: 103_000,
      attempt: 1,
      status: 'REVOKING',
      providerWaitUnknown: false,
      alarmed: false,
    };
    expect(() => validateRetryIntent({ ...base, alarmed: true })).toThrow('INVALID_RETRY_INTENT');
    expect(() => validateRetryIntent({ ...base, status: 'REVOKED' })).toThrow(
      'INVALID_RETRY_INTENT',
    );
    expect(() => validateRetryIntent({ ...base, nextAttemptEpochMs: 100_500 })).toThrow(
      'INVALID_RETRY_INTENT',
    );
  });

  it('requires all three confirmations plus 24 hours, and never compacts unresolved records', () => {
    const record = {
      status: 'REVOKED' as const,
      endedAtEpochMs: 100,
      revokedAtEpochMs: 200,
      officialAdjustedAtEpochMs: 300,
    };
    const threshold = 300 + 86_400_000;
    expect(canCompact(record, threshold - 1)).toBe(false);
    expect(canCompact(record, threshold)).toBe(true);
    expect(canCompact({ ...record, officialAdjustedAtEpochMs: null }, threshold * 10)).toBe(false);
    for (const status of ['PREPARED', 'REVOKING', 'UNRESOLVED'] as const) {
      expect(canCompact({ ...record, status }, threshold * 10)).toBe(false);
    }
  });
});

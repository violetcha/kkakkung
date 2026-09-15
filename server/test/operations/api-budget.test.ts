import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiBudget } from '../../src/operations/ApiBudget.js';

afterEach(() => vi.useRealTimers());

function setup(normal = 600, total = 900) {
  vi.useFakeTimers();
  let now = 0;
  const budget = new ApiBudget({
    monotonicNow: () => now,
    maxNormalCallsPer60s: normal,
    maxTotalCallsPer60s: total,
  });
  let id = 0;
  const dispatch = (
    priority: 'normal' | 'cleanup' = 'normal',
    run: () => Promise<unknown> = async () => 'ok',
    deadlineMs = now + 1_000,
    signal?: AbortSignal,
    beforeDispatch?: () => boolean,
  ) =>
    budget.dispatch({
      requestId: `test-${++id}`,
      method: 'test',
      target: 'digest',
      kind: priority === 'normal' ? 'grant' : 'revoke',
      priority,
      deadlineMs,
      run,
      signal,
      beforeDispatch,
    });
  return {
    budget,
    dispatch,
    advance: async (milliseconds: number) => {
      now += milliseconds;
      await vi.advanceTimersByTimeAsync(milliseconds);
    },
    setNow: (value: number) => (now = value),
  };
}

describe('project API sliding budget', () => {
  it('sends 600 normal calls, reserves cleanup through 900, and counts failed calls', async () => {
    const { budget, dispatch, advance } = setup();
    await Promise.all(Array.from({ length: 599 }, () => dispatch()));
    await expect(dispatch('normal', async () => Promise.reject(new Error('429')))).rejects.toThrow(
      '429',
    );
    const blockedNormal = dispatch();
    const normalCheck = expect(blockedNormal).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    await Promise.all(Array.from({ length: 299 }, () => dispatch('cleanup')));
    expect(budget.getSnapshot()).toMatchObject({ total60s: 899, normal60s: 600 });
    await dispatch('cleanup');
    const blockedCleanup = dispatch('cleanup');
    const cleanupCheck = expect(blockedCleanup).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED',
    });
    expect(budget.getSnapshot()).toMatchObject({
      total60s: 900,
      pendingNormal: 1,
      pendingCleanup: 1,
    });
    await advance(1_000);
    await Promise.all([normalCheck, cleanupCheck]);
    expect(budget.getSnapshot().total60s).toBe(900);
    budget.close();
  });

  it('opens the precise sliding boundary and chooses cleanup first', async () => {
    const { dispatch, advance, budget } = setup(1, 2);
    await dispatch();
    await dispatch('cleanup');
    const order: string[] = [];
    const normal = dispatch('normal', async () => order.push('normal'), 61_000);
    const cleanup = dispatch('cleanup', async () => order.push('cleanup'), 61_000);
    await advance(59_999);
    expect(order).toEqual([]);
    await advance(1);
    await cleanup;
    expect(order).toEqual(['cleanup']);
    // The cleanup consumed the only ordinary slot: normal traffic must not consume the reserve.
    const check = expect(normal).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    await advance(1_000);
    await check;
    budget.close();
  });

  it('uses rolling timestamps rather than resetting at a wall clock minute', async () => {
    const { dispatch, advance, budget } = setup(2, 2);
    await dispatch();
    await advance(30_000);
    await dispatch();
    const next = dispatch('normal', async () => 'next', 90_001);
    await advance(29_999);
    expect(budget.getSnapshot().pendingNormal).toBe(1);
    await advance(1);
    await expect(next).resolves.toBe('next');
    expect(budget.getSnapshot().total60s).toBe(2);
    budget.close();
  });

  it('normal lock cancels waiting grants but preserves cleanup and sent outcomes', async () => {
    const { dispatch, budget } = setup(1, 2);
    let finish!: (value: string) => void;
    const sent = dispatch('normal', () => new Promise<string>((resolve) => (finish = resolve)));
    const waiting = dispatch();
    const check = expect(waiting).rejects.toMatchObject({ code: 'NORMAL_LOCKED' });
    budget.lockNormal();
    await check;
    await expect(dispatch()).rejects.toMatchObject({ code: 'NORMAL_LOCKED' });
    await dispatch('cleanup');
    budget.close();
    expect(budget.getSnapshot().inFlight).toBe(1);
    finish('remote-success');
    await expect(sent).resolves.toBe('remote-success');
    await expect(dispatch('cleanup')).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it('abort cancels waiting work but cannot relabel an already sent request', async () => {
    const { dispatch, budget } = setup(1, 2);
    const sentAbort = new AbortController();
    let finish!: (value: string) => void;
    const sent = dispatch(
      'normal',
      () => new Promise<string>((resolve) => (finish = resolve)),
      1_000,
      sentAbort.signal,
    );
    const waitingAbort = new AbortController();
    const waiting = dispatch('normal', async () => 'never', 1_000, waitingAbort.signal);
    const check = expect(waiting).rejects.toMatchObject({ code: 'ABORTED' });
    sentAbort.abort();
    waitingAbort.abort();
    await check;
    finish('sent-completed');
    await expect(sent).resolves.toBe('sent-completed');
    expect(budget.getSnapshot().total60s).toBe(1);
    budget.close();
  });

  it('denies stale generations at dispatch without consuming a transport attempt', async () => {
    const { dispatch, budget, advance } = setup(1, 1);
    await dispatch();
    let current = true;
    const run = vi.fn(async () => 'not sent');
    const waiting = dispatch('normal', run, 61_000, undefined, () => current);
    const check = expect(waiting).rejects.toMatchObject({ code: 'SUPERSEDED' });
    current = false;
    await advance(60_000);
    await check;
    expect(run).not.toHaveBeenCalled();
    expect(budget.getSnapshot().total60s).toBe(0);
    budget.close();
  });

  it('rejects invalid limits and a reversed monotonic clock', async () => {
    expect(() => setup(6_001, 9_000)).toThrow('INVALID_API_BUDGET_CONFIG');
    expect(() => setup(6_000, 9_001)).toThrow('INVALID_API_BUDGET_CONFIG');
    expect(() => setup(901, 900)).toThrow('INVALID_API_BUDGET_CONFIG');
    setup(6_000, 9_000).budget.close();
    const { dispatch, setNow, budget } = setup();
    setNow(100);
    await dispatch();
    setNow(99);
    await expect(dispatch()).rejects.toMatchObject({ code: 'INVALID_CLOCK' });
    budget.close();
  });

  it('rechecks a deadline after scope validation before sending', async () => {
    const { dispatch, setNow, budget } = setup();
    const run = vi.fn(async () => 'not sent');
    await expect(
      dispatch('normal', run, 1_000, undefined, () => {
        setNow(1_000);
        return true;
      }),
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    expect(run).not.toHaveBeenCalled();
    expect(budget.getSnapshot().total60s).toBe(0);
    budget.close();
  });

  it('does not exceed its limit when scope validation enqueues another request', async () => {
    const { dispatch, advance, budget } = setup(1, 1);
    const nestedRun = vi.fn(async () => 'nested');
    let nested!: Promise<unknown>;
    await dispatch(
      'normal',
      async () => 'first',
      1_000,
      undefined,
      () => {
        nested = dispatch('normal', nestedRun, 1_000);
        return true;
      },
    );
    expect(budget.getSnapshot().total60s).toBe(1);
    expect(nestedRun).not.toHaveBeenCalled();
    const check = expect(nested).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    await advance(1_000);
    await check;
    budget.close();
  });

  it('does not send when an abort arrives during scope validation', async () => {
    const { dispatch, budget } = setup();
    const controller = new AbortController();
    const run = vi.fn(async () => 'not sent');
    await expect(
      dispatch('normal', run, 1_000, controller.signal, () => {
        controller.abort();
        return true;
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(run).not.toHaveBeenCalled();
    expect(budget.getSnapshot().total60s).toBe(0);
    budget.close();
  });

  it('dispatches cleanup enqueued by the final snapshot callback without waiting for a timer', async () => {
    let nested: Promise<string> | undefined;
    const budget = new ApiBudget({
      monotonicNow: () => 0,
      maxNormalCallsPer60s: 1,
      maxTotalCallsPer60s: 2,
      onSnapshot: (snapshot) => {
        if (snapshot.total60s === 1 && !nested)
          nested = budget.dispatch({ ...request, requestId: 'cleanup', priority: 'cleanup' });
      },
    });
    const request = {
      requestId: 'normal',
      method: 'test',
      target: 'hash',
      kind: 'query' as const,
      priority: 'normal' as const,
      deadlineMs: 1_000,
      run: async () => 'ok',
    };
    await budget.dispatch(request);
    await expect(nested).resolves.toBe('ok');
    expect(budget.getSnapshot().total60s).toBe(2);
    budget.close();
  });

  it('does not dispatch expired requests or let metric failures affect requests', async () => {
    const budget = new ApiBudget({
      monotonicNow: () => 10,
      maxNormalCallsPer60s: 1,
      maxTotalCallsPer60s: 2,
      onSnapshot: () => {
        throw new Error('exporter unavailable');
      },
    });
    const run = vi.fn(async () => 'ok');
    const request = {
      requestId: 'one',
      method: 'test',
      target: 'hash',
      kind: 'query' as const,
      priority: 'normal' as const,
      run,
    };
    await expect(budget.dispatch({ ...request, deadlineMs: 10 })).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED',
    });
    await expect(budget.dispatch({ ...request, deadlineMs: 11 })).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
    budget.close();
  });
});

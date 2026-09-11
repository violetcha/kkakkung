import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomServiceClient } from 'livekit-server-sdk';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { LiveKitGateway, type GatewayObservation } from '../../src/media/LiveKitGateway.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const config = {
  httpUrl: 'https://synthetic-sdk-test.livekit.cloud',
  apiKey: 'synthetic-test-key',
  apiSecret: 'synthetic-test-secret-only',
};

function createGateway(observe?: (event: GatewayObservation) => void) {
  const budget = new ApiBudget({
    monotonicNow: () => 10,
    maxNormalCallsPer60s: 600,
    maxTotalCallsPer60s: 900,
  });
  return {
    budget,
    gateway: new LiveKitGateway(config, budget, { monotonicNow: () => 10, observe }),
  };
}

describe('installed SDK gateway with intercepted transport (no Cloud)', () => {
  it('accepts a response after one second without replaying or extending the queue deadline', async () => {
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      timeouts.push(ms);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms).unref();
      return controller.signal;
    });
    const fetch = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
          setTimeout(() => resolve(Response.json({ rooms: [] })), 1500);
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const { gateway, budget } = createGateway();
    const result = gateway.listRooms();
    await expect(result).resolves.toEqual([]);
    expect(timeouts).toEqual([10_000]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.getSnapshot().total60s).toBe(1);
    budget.close();
  });

  it('uses the configured transport timeout and keeps failures outcome-unknown without replay', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetch = vi.fn(async () => {
      throw new Error('timeout');
    });
    vi.stubGlobal('fetch', fetch);
    const { budget } = createGateway();
    const gateway = new LiveKitGateway(config, budget, {
      monotonicNow: () => 10,
      requestTimeoutMs: 7500,
    });
    await expect(gateway.createRoom({ name: 'synthetic' })).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    expect(timeout).toHaveBeenCalledWith(7500);
    expect(fetch).toHaveBeenCalledTimes(1);
    budget.close();
  });

  it.each([0, -1, NaN, Infinity, 1.5, 2 ** 32])(
    'rejects invalid transport timeout %s before any call',
    (requestTimeoutMs) => {
      const { budget } = createGateway();
      expect(
        () => new LiveKitGateway(config, budget, { monotonicNow: () => 10, requestTimeoutMs }),
      ).toThrow('INVALID_CLOUD_REQUEST_TIMEOUT');
      expect(budget.getSnapshot().total60s).toBe(0);
      budget.close();
    },
  );
  it('preserves validated provider wait metadata but never invents a discarded Retry-After header', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ code: 'resource_exhausted', meta: { retry_after: '12' } }, { status: 429 }),
    );
    vi.stubGlobal('fetch', fetch);
    const { gateway, budget } = createGateway();
    await expect(gateway.listRooms()).rejects.toMatchObject({ status: 429, retryAfterMs: 12_000 });
    fetch.mockImplementation(async () =>
      Response.json(
        { code: 'resource_exhausted' },
        { status: 429, headers: { 'Retry-After': '12' } },
      ),
    );
    await expect(gateway.listRooms()).rejects.toMatchObject({
      status: 429,
      retryAfterMs: undefined,
    });
    budget.close();
  });
  it.each(['transport', '5xx'])('does not replay a %s failure', async (failure) => {
    const fetch = vi.fn(async () => {
      if (failure === 'transport') throw new Error('synthetic connection failure');
      return new Response('synthetic failure', { status: 503 });
    });
    vi.stubGlobal('fetch', fetch);
    const { gateway, budget } = createGateway();
    await expect(gateway.listRooms()).rejects.toMatchObject({ outcomeUnknown: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.getSnapshot().total60s).toBe(1);
    budget.close();
  });

  it('demonstrates the installed SDK default region replay before disabling it', async () => {
    const urls: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        urls.push(input.toString());
        if (input.pathname === '/settings/regions') {
          return Response.json(
            { regions: [{ url: 'https://synthetic-fallback.livekit.cloud' }] },
            { headers: { 'cache-control': 'max-age=0' } },
          );
        }
        if (input.hostname === 'synthetic-fallback.livekit.cloud')
          return Response.json({ rooms: [] });
        return new Response('failed', { status: 503 });
      }),
    );
    const sdkDefault = new RoomServiceClient(
      'https://synthetic-default-test.livekit.cloud',
      config.apiKey,
      config.apiSecret,
    );
    await expect(sdkDefault.listRooms()).resolves.toEqual([]);
    expect(urls.filter((url) => url.includes('/twirp/'))).toHaveLength(2);
    expect(urls.filter((url) => url.includes('/settings/regions'))).toHaveLength(1);
  });

  it('routes all eight methods through one budget and produces no sensitive observations', async () => {
    const fetch = vi.fn(async (input: URL) => {
      if (input.pathname.endsWith('/ListRooms')) return Response.json({ rooms: [] });
      if (input.pathname.endsWith('/ListParticipants')) return Response.json({ participants: [] });
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetch);
    const observations: GatewayObservation[] = [];
    const { gateway, budget } = createGateway((event) => observations.push(event));
    await gateway.createRoom({ name: 'synthetic-room-private' });
    await gateway.listRooms();
    await gateway.listParticipants('synthetic-room-private');
    await gateway.getParticipant('synthetic-room-private', 'synthetic-identity-private');
    await gateway.updateSubscriptions(
      'synthetic-room-private',
      'synthetic-identity-private',
      ['TR'],
      true,
    );
    await gateway.updateParticipant('synthetic-room-private', 'synthetic-identity-private', {
      permission: { canSubscribe: false },
    });
    await gateway.removeParticipant('synthetic-room-private', 'synthetic-identity-private', {
      revokeTokenTs: 2_000n,
    });
    await gateway.deleteRoom('synthetic-room-private');
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(budget.getSnapshot()).toMatchObject({ total60s: 8, normal60s: 6 });
    expect(observations.filter((event) => event.result === 'sent')).toHaveLength(8);
    expect(observations.filter((event) => event.result === 'succeeded')).toHaveLength(8);
    const text = JSON.stringify(observations);
    for (const privateValue of [
      config.apiKey,
      config.apiSecret,
      'synthetic-room-private',
      'synthetic-identity-private',
    ]) {
      expect(text).not.toContain(privateValue);
    }
    budget.close();
  });

  it('sanitizes remote errors and does not retry when observability throws', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ msg: 'token=private-secret', code: 'not_found' }, { status: 404 }),
    );
    vi.stubGlobal('fetch', fetch);
    const { gateway, budget } = createGateway(() => {
      throw new Error('metrics unavailable');
    });
    await expect(gateway.getParticipant('room', 'identity')).rejects.toMatchObject({
      message: 'not_found',
      status: 404,
      outcomeUnknown: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    budget.close();
  });

  it('does not send a superseded queued policy', async () => {
    const fetch = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const { gateway, budget } = createGateway();
    await expect(
      gateway.updateSubscriptions('room', 'identity', ['TR'], true, {
        requestId: 'stale-policy',
        deadlineMs: 1_000,
        beforeDispatch: () => false,
      }),
    ).rejects.toMatchObject({ code: 'SUPERSEDED' });
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.getSnapshot().total60s).toBe(0);
    budget.close();
  });
});

// F-02 / QA-01 fault adapter: per-request modes over a fake gateway client with a manual clock.
// The remote state is the fake's; the adapter only shapes what the caller sees and records both
// timelines. No Cloud, no timers.
import { describe, expect, it, vi } from 'vitest';
import type { GatewayClient } from '../../server/src/media/LiveKitGateway.ts';
import {
  GatewayFaultAdapter,
  LocalTimeoutError,
  digest,
} from '../../tests/cloud/GatewayFaultAdapter.ts';
import { MediaObserver } from '../../tests/cloud/MediaObserver.ts';

function fixture() {
  let now = 0;
  const pendingSleeps: { until: number; resolve: () => void }[] = [];
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => pendingSleeps.push({ until: now + ms, resolve }));
  const advance = async (ms: number) => {
    now += ms;
    for (const s of pendingSleeps.splice(0)) {
      if (s.until <= now) s.resolve();
      else pendingSleeps.push(s);
    }
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const remote = { subscriptions: new Map<string, boolean>(), removed: new Set<string>() };
  const client = {
    updateSubscriptions: vi.fn(
      async (_room: string, identity: string, sids: string[], on: boolean) => {
        for (const sid of sids) remote.subscriptions.set(`${identity}:${sid}`, on);
      },
    ),
    removeParticipant: vi.fn(async (_room: string, identity: string) => {
      remote.removed.add(identity);
    }),
    getParticipant: vi.fn(async () => ({ identity: 'x' })),
  } as unknown as GatewayClient;
  const adapter = new GatewayFaultAdapter(client, { now: () => now, sleep });
  return { adapter, client, remote, advance, now: () => now };
}

describe('gateway fault adapter', () => {
  it('normal: caller and remote agree, target is a digest, the timeline has both timestamps', async () => {
    const f = fixture();
    await f.adapter.updateSubscriptions('req-1', 'room', 'alice', ['A'], true);
    const [entry] = f.adapter.timeline();
    expect(entry).toMatchObject({
      mode: 'normal',
      callerOutcome: 'resolved',
      remoteOutcome: 'applied',
      target: digest('room/alice'),
    });
    expect(entry!.target).not.toContain('alice');
    expect(f.remote.subscriptions.get('alice:A')).toBe(true);
  });

  it('delay-before-send: the remote sees the call only after the delay', async () => {
    const f = fixture();
    f.adapter.setRule('req-1', { mode: 'delay-before-send', delayMs: 999 });
    const call = f.adapter.updateSubscriptions('req-1', 'room', 'alice', ['A'], true);
    await f.advance(500);
    expect(f.remote.subscriptions.has('alice:A')).toBe(false);
    await f.advance(499);
    await call;
    expect(f.remote.subscriptions.get('alice:A')).toBe(true);
    expect(f.adapter.timeline()[0]).toMatchObject({
      remoteAppliedAtMs: 999,
      callerOutcome: 'resolved',
    });
  });

  it('drop-response: the remote applied the change, the caller never hears back (UNKNOWN), both timelines kept', async () => {
    const f = fixture();
    f.adapter.setRule('req-1', { mode: 'drop-response' });
    let settled = false;
    void f.adapter.updateSubscriptions('req-1', 'room', 'alice', ['A'], true).then(
      () => (settled = true),
      () => (settled = true),
    );
    await f.advance(5000);
    expect(settled).toBe(false);
    expect(f.remote.subscriptions.get('alice:A')).toBe(true);
    expect(f.adapter.timeline()[0]).toMatchObject({
      callerOutcome: 'unknown',
      remoteOutcome: 'applied',
      callerRespondedAtMs: null,
    });
  });

  it('remote-success-then-local-timeout: the caller times out after its deadline while the remote already applied; the adapter never reports a cancellation', async () => {
    const f = fixture();
    f.adapter.setRule('rm-1', { mode: 'remote-success-then-local-timeout', callerTimeoutMs: 1000 });
    const call = f.adapter.removeParticipant('rm-1', 'room', 'bob');
    const outcome = call.then(
      () => 'resolved',
      (e) => (e instanceof LocalTimeoutError ? `timeout:${e.requestId}` : 'other'),
    );
    await f.advance(1000);
    expect(await outcome).toBe('timeout:rm-1');
    expect(f.remote.removed.has('bob')).toBe(true);
    const [entry] = f.adapter.timeline();
    expect(entry).toMatchObject({
      callerOutcome: 'unknown',
      remoteOutcome: 'applied',
      callerRespondedAtMs: 1000,
    });
    expect(JSON.stringify(entry)).not.toMatch(/cancel/i);
  });

  it('a remote failure is a rejection with the remote marked failed, not unknown', async () => {
    const f = fixture();
    (f.client.getParticipant as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('404'),
    );
    await expect(f.adapter.getParticipant('q-1', 'room', 'gone')).rejects.toThrow('404');
    expect(f.adapter.timeline()[0]).toMatchObject({
      callerOutcome: 'rejected',
      remoteOutcome: 'failed',
    });
  });
});

describe('media observer: SID change and buffered playback', () => {
  const key = (trackSid: string, publisherGeneration = 1) => ({
    mediaInstanceId: 'game',
    receiverGeneration: 1,
    publisherGeneration,
    trackSid,
  });

  it('a new SID starts a fresh baseline: old bytes are never summed in, resumption is judged by a new marker', () => {
    const o = new MediaObserver();
    o.track(key('A1'), 1);
    o.stats(key('A1'), { atMs: 0, bytesReceived: 1000, packetsReceived: 10 });
    o.stats(key('A1'), { atMs: 1000, bytesReceived: 9000, packetsReceived: 90 });
    o.track(key('A2'), 2);
    o.stats(key('A2'), { atMs: 2000, bytesReceived: 50, packetsReceived: 1 });
    o.stats(key('A2'), { atMs: 2500, bytesReceived: 50, packetsReceived: 1 });
    expect(o.bytesSinceBaseline(key('A1'))).toBe(8000);
    expect(o.bytesSinceBaseline(key('A2'))).toBe(0);
    // Bytes alone never prove resumption; the first marker generated after the allow does.
    expect(o.firstNewMarkerAfter(key('A2'), 2000, 120)).toBeNull();
    o.marker(key('A2'), { serial: 121, atMs: 2600 });
    expect(o.firstNewMarkerAfter(key('A2'), 2000, 120)).toEqual({ serial: 121, atMs: 2600 });
    expect(o.bindingRevision(key('A2'))).toBe(2);
  });

  it('after a deny, already buffered markers replay but no marker created after the cutoff arrives: sustained silence', () => {
    const o = new MediaObserver();
    o.track(key('A1'), 1);
    o.marker(key('A1'), { serial: 40, atMs: 900 });
    // Cutoff at 1000 with the last transmitted serial 42; buffered 41/42 drain afterwards.
    o.marker(key('A1'), { serial: 41, atMs: 1100 });
    o.marker(key('A1'), { serial: 42, atMs: 1350 });
    expect(o.sustainedSilence(key('A1'), 1000, 42, 3000)).toMatchObject({
      silent: true,
      newMarkers: 0,
    });
    o.marker(key('A1'), { serial: 43, atMs: 1800 });
    expect(o.sustainedSilence(key('A1'), 1000, 42, 3000)).toMatchObject({
      silent: false,
      newMarkers: 1,
    });
  });

  it('a same-SID replaceTrack keeps the counters and separates markers before and after', () => {
    const o = new MediaObserver();
    o.track(key('A1'), 1);
    o.stats(key('A1'), { atMs: 0, bytesReceived: 100, packetsReceived: 1 });
    o.marker(key('A1'), { serial: 1, atMs: 100 });
    o.marker(key('A1'), { serial: 2, atMs: 200 });
    o.replaced(key('A1'), 250, 2);
    o.marker(key('A1'), { serial: 3, atMs: 300 });
    o.stats(key('A1'), { atMs: 400, bytesReceived: 900, packetsReceived: 9 });
    expect(o.markersAroundReplacement(key('A1'))).toEqual({ before: 2, after: 1 });
    expect(o.bytesSinceBaseline(key('A1'))).toBe(800);
  });
});

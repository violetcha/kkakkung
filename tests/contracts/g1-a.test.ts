// F-08 / QA-03 G1-A on E's real SubscriptionController + PolicyUncertainty: an allowed request
// (v10) is in flight while a newer deny (v11) arrives; the response is late, lost, or comes after
// the local timeout. Exactly one request per receiver is ever in flight, an unknown outcome
// closes the receiver instead of guessing, and an old success can never re-allow anything.
// Cloud half: tests/cloud/g1-a.cloud.test.ts (BLOCKED until the F-02 probe harness exists).
import { describe, expect, it } from 'vitest';
import {
  flush,
  receiverKey,
  registryWith,
  subscriptionHarness,
} from '../fixtures/media-recovery-scenarios.ts';

const { generation } = registryWith(['r1', 't1']);
const r1 = receiverKey('r1', generation('r1'));
const t1 = receiverKey('t1', generation('t1'));

describe('G1-A: allow in flight, newer deny, late or lost responses', () => {
  it('v10 allow delayed 999 ms with v11 deny queued: one request in flight, deny converges after the response', async () => {
    const s = subscriptionHarness();
    s.desire(r1, 10, ['A']);
    await flush();
    expect(s.dispatched()).toHaveLength(1);
    expect(s.dispatched()[0]).toMatchObject({ subscribe: true, trackSids: ['A'] });
    // v11 removes A while v10 is still unanswered: nothing new is sent, inFlight stays 1.
    s.desire(r1, 11, []);
    await flush();
    expect(s.dispatched()).toHaveLength(1);
    expect(s.controller.inspect(r1)).toMatchObject({
      inFlight: s.dispatched()[0]!.requestId,
      policyVersion: 11,
    });
    // The allow answers just inside the 1 s window.
    s.advance(999);
    s.dispatched()[0]!.resolve();
    await flush();
    expect(s.unknown).toEqual([]);
    const second = s.dispatched()[1]!;
    expect(second).toMatchObject({ subscribe: false, trackSids: ['A'] });
    second.resolve();
    await flush();
    expect(s.controller.inspect(r1)).toMatchObject({
      acknowledgedTracks: [],
      inFlight: null,
      terminal: false,
    });
    // No third request: the target converged on v11 and stops.
    expect(s.dispatched()).toHaveLength(2);
    s.controller.dispose();
  });

  it('v10 succeeded remotely but the response is lost: UNKNOWN after 1 s, receiver closed, no new grant of anything', async () => {
    const s = subscriptionHarness();
    s.desire(r1, 10, ['A']);
    await flush();
    const sent = s.dispatched()[0]!;
    s.advance(1000);
    await flush();
    // The local deadline passed without a response: the receiver is terminal and reported once.
    expect(s.unknown).toEqual([{ key: r1, requestId: sent.requestId }]);
    expect(s.controller.inspect(r1)).toMatchObject({ terminal: true, acknowledgedTracks: [] });
    // A newer policy for this receiver produces no request; another receiver is unaffected.
    s.desire(r1, 12, ['A', 'B']);
    s.desire(t1, 1, ['B']);
    await flush();
    expect(s.dispatched().filter((x) => x.key.playerId === 'r1')).toHaveLength(1);
    expect(s.dispatched().filter((x) => x.key.playerId === 't1')).toHaveLength(1);
    // Local timeout never claims the remote apply was cancelled: it stays unknown, not "denied".
    expect(s.unknown[0]!.requestId).toBe(sent.requestId);
    s.controller.dispose();
  });

  it('a v10 success that arrives after the terminal decision is recorded as late and re-allows nothing', async () => {
    const s = subscriptionHarness();
    s.desire(r1, 10, ['A']);
    await flush();
    const sent = s.dispatched()[0]!;
    s.advance(1000);
    await flush();
    expect(s.controller.inspect(r1)?.terminal).toBe(true);
    sent.resolve();
    await flush();
    expect(s.late).toEqual([
      { requestId: sent.requestId, receiverGeneration: r1.receiverGeneration, outcome: 'resolved' },
    ]);
    expect(s.controller.inspect(r1)).toMatchObject({
      terminal: true,
      acknowledgedTracks: [],
      inFlight: sent.requestId,
    });
    expect(s.dispatched()).toHaveLength(1);
    s.controller.dispose();
  });

  it('a transport rejection after dispatch is an unknown outcome, never a silent retry', async () => {
    const s = subscriptionHarness();
    s.desire(r1, 10, ['A']);
    await flush();
    s.dispatched()[0]!.reject(new Error('response lost'));
    await flush();
    expect(s.unknown).toHaveLength(1);
    s.desire(r1, 11, ['B']);
    await flush();
    expect(s.dispatched()).toHaveLength(1);
    expect(s.controller.inspect(r1)).toMatchObject({ terminal: true, acknowledgedTracks: [] });
    s.controller.dispose();
  });

  it('retire while v10 is in flight: the late allow is consumed without reopening the receiver', async () => {
    const s = subscriptionHarness();
    s.desire(r1, 10, ['A']);
    await flush();
    const sent = s.dispatched()[0]!;
    s.controller.retire(r1);
    sent.resolve();
    await flush();
    expect(s.unknown).toEqual([]);
    expect(s.late).toEqual([
      { requestId: sent.requestId, receiverGeneration: r1.receiverGeneration, outcome: 'resolved' },
    ]);
    expect(s.controller.inspect(r1)).toMatchObject({ terminal: true, acknowledgedTracks: [] });
    s.desire(r1, 11, ['A']);
    await flush();
    expect(s.dispatched()).toHaveLength(1);
  });

  it('the dispatch gate rechecks the newest policy: a batch superseded before sending is never dispatched', async () => {
    const s = subscriptionHarness();
    s.desire(r1, 10, ['A']);
    // Before the microtask that dispatches, the policy already removed A again.
    s.desire(r1, 11, []);
    await flush();
    expect(s.sends).toHaveLength(1);
    expect(s.sends[0]!.dispatched).toBe(false);
    expect(s.dispatched()).toHaveLength(0);
    expect(s.controller.inspect(r1)).toMatchObject({ acknowledgedTracks: [], terminal: false });
    s.controller.dispose();
  });
});

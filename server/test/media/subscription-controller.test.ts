import { describe, expect, it, vi } from 'vitest';
import {
  SubscriptionController,
  type SubscriptionKey,
  type SubscriptionRequest,
} from '../../src/media/SubscriptionController.js';

const key: SubscriptionKey = {
  matchId: 'm',
  mediaInstanceId: 'i',
  mediaRoomName: 'room',
  playerId: 'p',
  receiverIdentity: 'identity',
  receiverGeneration: 1,
};
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup() {
  let now = 0;
  let valid = true;
  let bindingVersion = 1;
  const validTracks = new Set(['A', 'B', 'C']);
  const calls: (SubscriptionRequest & ReturnType<typeof deferred>)[] = [];
  const unknown = vi.fn();
  const controller = new SubscriptionController({
    now: () => now,
    timer: () => () => {},
    validateKey: () => valid,
    validateTrack: (_, sid) => validTracks.has(sid),
    getTrackFingerprint: (_, sid) => `${sid}:${bindingVersion}`,
    onUnknown: unknown,
    send: (request) => {
      const pending = deferred();
      if (request.beforeDispatch()) calls.push({ ...request, ...pending });
      else pending.resolve();
      return pending.promise;
    },
  });
  return {
    controller,
    calls,
    unknown,
    validTracks,
    changeBinding: () => {
      bindingVersion++;
    },
    time: (value: number) => {
      now = value;
    },
    invalidate: () => {
      valid = false;
    },
    desired: (tracks: string[], version: number, target = key) =>
      controller.setDesired({
        key: target,
        policyVersion: version,
        trackSids: tracks,
        generatedAtMs: now,
      }),
  };
}

describe('generation subscription controller', () => {
  it('blocks acknowledged SID before accepting the same SID under a new publisher binding', async () => {
    const s = setup();
    s.desired(['A'], 1);
    await flush();
    s.calls[0]!.resolve();
    await flush();
    s.changeBinding();
    s.desired(['A'], 2);
    await flush();
    expect(s.calls[1]).toMatchObject({ subscribe: false, trackSids: ['A'] });
    s.calls[1]!.resolve();
    await flush();
    expect(s.calls[2]).toMatchObject({ subscribe: true, trackSids: ['A'] });
    s.calls[2]!.resolve();
    await flush();
    s.controller.dispose();
  });
  it('serializes in-flight allow then newer deny, and distinguishes ack from reception', async () => {
    const s = setup();
    s.desired(['A'], 10);
    await flush();
    s.desired([], 11);
    expect(s.calls).toHaveLength(1);
    s.calls[0]!.resolve();
    await flush();
    expect(s.calls[1]!.subscribe).toBe(false);
    expect(s.calls[1]!.trackSids).toEqual(['A']);
    s.calls[1]!.resolve();
    await flush();
    expect(s.controller.inspect(key)).toMatchObject({
      acknowledgedTracks: [],
      receptionVerified: false,
    });
    s.controller.dispose();
  });
  it('blocks removed B before allowing added A, with one boolean per request', async () => {
    const s = setup();
    s.desired(['B'], 1);
    await flush();
    s.calls[0]!.resolve();
    await flush();
    s.desired(['A'], 2);
    await flush();
    expect(s.calls[1]).toMatchObject({ subscribe: false, trackSids: ['B'] });
    s.calls[1]!.resolve();
    await flush();
    expect(s.calls[2]).toMatchObject({ subscribe: true, trackSids: ['A'] });
    s.controller.dispose();
    s.calls[2]!.resolve();
    await flush();
  });
  it('rechecks SID ownership at actual dispatch and permits other receivers concurrently', async () => {
    const s = setup();
    s.desired(['A'], 1);
    s.validTracks.delete('A');
    await flush();
    expect(s.calls).toHaveLength(0);
    s.desired(['B'], 2);
    s.desired(['C'], 1, { ...key, playerId: 'p2', receiverIdentity: 'id2' });
    await flush();
    expect(s.calls).toHaveLength(2);
    s.controller.dispose();
    s.calls.forEach((call) => call.resolve());
    await flush();
  });
  it('ignores stale policy versions and does not apply response to inactive generation', async () => {
    const s = setup();
    s.desired(['A'], 4);
    await flush();
    s.desired(['B'], 3);
    s.invalidate();
    s.calls[0]!.resolve();
    await flush();
    expect(s.controller.inspect(key)).toMatchObject({
      terminal: true,
      acknowledgedTracks: [],
      policyVersion: 4,
    });
  });
  it('retirement consumes a late rejection without reopening a target', async () => {
    const s = setup();
    s.desired(['A'], 1);
    await flush();
    s.controller.retire(key);
    s.calls[0]!.reject(new Error('late network failure'));
    await flush();
    expect(s.unknown).not.toHaveBeenCalled();
    expect(s.controller.inspect(key)?.terminal).toBe(true);
  });
  it('declares transmitted failure unknown and never accepts a late allow', async () => {
    const s = setup();
    s.desired(['A'], 1);
    await flush();
    s.calls[0]!.reject(new Error('response lost'));
    await flush();
    s.desired(['B'], 2);
    expect(s.unknown).toHaveBeenCalledTimes(1);
    expect(s.calls).toHaveLength(1);
    expect(s.controller.inspect(key)?.acknowledgedTracks).toEqual([]);
  });
});

it('records only safe failure codes and keeps the terminal latch if diagnostics throws', async () => {
  const diagnostics: unknown[] = [];
  const failure = vi.fn();
  const controller = new SubscriptionController({
    now: () => 0,
    timer: () => () => {},
    validateKey: () => true,
    validateTrack: () => true,
    getTrackFingerprint: (_, sid) => sid,
    onUnknown: failure,
    onDiagnostic: (event) => {
      diagnostics.push(event);
      throw new Error('observer failed');
    },
    send: async (request) => {
      request.beforeDispatch();
      throw new Error('secret fixture credential');
    },
  });
  controller.setDesired({ key, policyVersion: 1, trackSids: ['A'], generatedAtMs: 0 });
  await flush();
  expect(failure).toHaveBeenCalledOnce();
  expect(controller.inspect(key)?.terminal).toBe(true);
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ stage: 'allow-rejected', code: 'REQUEST_FAILED' }),
  );
  expect(JSON.stringify(diagnostics)).not.toContain('secret');
  controller.dispose();
});

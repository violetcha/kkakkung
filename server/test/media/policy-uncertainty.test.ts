import { describe, expect, it, vi } from 'vitest';
import { PolicyUncertainty } from '../../src/media/PolicyUncertainty.js';
import {
  SubscriptionController,
  type SubscriptionKey,
} from '../../src/media/SubscriptionController.js';

const key: SubscriptionKey = {
  matchId: 'm',
  mediaInstanceId: 'i',
  mediaRoomName: 'r',
  playerId: 'p',
  receiverIdentity: 'id',
  receiverGeneration: 1,
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
describe('policy uncertainty', () => {
  it('rearms an early timer callback instead of losing the security deadline', () => {
    let now = 0.5;
    let callback: () => void = () => {};
    const failure = vi.fn();
    const timer = vi.fn((run: () => void, _delayMs: number) => {
      callback = run;
      return () => {};
    });
    const latch = new PolicyUncertainty(() => now, failure, timer);
    latch.requireBlock(now);

    now = 1000;
    callback();
    expect(failure).not.toHaveBeenCalled();
    expect(timer).toHaveBeenCalledTimes(2);

    now = 1001;
    callback();
    expect(failure).toHaveBeenCalledOnce();
    expect(latch.isTerminal()).toBe(true);
  });
  it('accepts 999ms response but latches UNKNOWN once at 1001ms', () => {
    let now = 0;
    const failure = vi.fn();
    const latch = new PolicyUncertainty(
      () => now,
      failure,
      () => () => {},
    );
    latch.sent(0);
    now = 999;
    latch.responded();
    latch.check();
    expect(failure).not.toHaveBeenCalled();
    latch.sent(now);
    now = 2000;
    latch.check();
    latch.check();
    latch.fail();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(latch.isTerminal()).toBe(true);
  });
  it('maintains earlier security deadline even when a later request is sent', () => {
    let now = 0;
    const failure = vi.fn();
    const latch = new PolicyUncertainty(
      () => now,
      failure,
      () => () => {},
    );
    latch.requireBlock(0);
    now = 900;
    latch.requireBlock(900);
    latch.sent(900);
    now = 1001;
    latch.check();
    expect(failure).toHaveBeenCalledOnce();
  });
  it('times out an unissued security block and treats a late allow as diagnostics only', async () => {
    let now = 0;
    let resolve!: () => void;
    const failure = vi.fn();
    const late = vi.fn();
    const controller = new SubscriptionController({
      now: () => now,
      timer: () => () => {},
      validateKey: () => true,
      validateTrack: () => true,
      getTrackFingerprint: (_, sid) => sid,
      onUnknown: failure,
      onLateResponse: late,
      send: async (request) => {
        request.beforeDispatch();
        await new Promise<void>((done) => {
          resolve = done;
        });
      },
    });
    controller.setDesired({ key, policyVersion: 1, trackSids: ['A'], generatedAtMs: 0 });
    await flush();
    controller.setDesired({ key, policyVersion: 2, trackSids: [], generatedAtMs: 0 });
    now = 1001;
    controller.checkDeadlines();
    resolve();
    await flush();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(controller.inspect(key)).toMatchObject({ terminal: true, acknowledgedTracks: [] });
    expect(late).toHaveBeenCalledOnce();
  });
  it('fails a queued denial even with no SDK request dispatched', async () => {
    let now = 0;
    const failure = vi.fn();
    const controller = new SubscriptionController({
      now: () => now,
      timer: () => () => {},
      validateKey: () => true,
      validateTrack: () => true,
      getTrackFingerprint: (_, sid) => sid,
      onUnknown: failure,
      send: async (request) => {
        if (request.subscribe) request.beforeDispatch();
        else await new Promise<void>(() => {});
      },
    });
    controller.setDesired({ key, policyVersion: 1, trackSids: ['A'], generatedAtMs: 0 });
    await flush();
    controller.setDesired({ key, policyVersion: 2, trackSids: [], generatedAtMs: 0 });
    await flush();
    now = 1001;
    controller.checkDeadlines();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(controller.inspect(key)?.terminal).toBe(true);
  });
});

it('allows a bounded 5s response but preserves a new 1s block deadline and rejects late success', async () => {
  let now = 0;
  let resolve!: () => void;
  const failure = vi.fn();
  const diagnostic = vi.fn();
  const controller = new SubscriptionController({
    now: () => now,
    timer: () => () => {},
    allowResponseTimeoutMs: 5000,
    validateKey: () => true,
    validateTrack: () => true,
    getTrackFingerprint: (_, sid) => sid,
    onUnknown: failure,
    onDiagnostic: diagnostic,
    send: async (request) => {
      request.beforeDispatch();
      await new Promise<void>((done) => {
        resolve = done;
      });
    },
  });
  controller.setDesired({ key, policyVersion: 1, trackSids: ['A'], generatedAtMs: 0 });
  await flush();
  now = 1500;
  controller.checkDeadlines();
  expect(failure).not.toHaveBeenCalled();
  controller.setDesired({ key, policyVersion: 2, trackSids: [], generatedAtMs: now });
  now = 2499;
  controller.checkDeadlines();
  expect(failure).not.toHaveBeenCalled();
  now = 2500;
  controller.checkDeadlines();
  expect(failure).toHaveBeenCalledOnce();
  expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'BLOCK_TIMEOUT' }));
  resolve();
  await flush();
  expect(controller.inspect(key)).toMatchObject({ terminal: true, acknowledgedTracks: [] });
  expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ stage: 'late-response' }));
  controller.dispose();
});
it('accepts an allow at 1500ms but terminates an unanswered allow at 5000ms', () => {
  let now = 0;
  const failed = vi.fn();
  const latch = new PolicyUncertainty(
    () => now,
    failed,
    () => () => {},
  );
  latch.sent(0, 5000);
  now = 1500;
  latch.responded();
  expect(failed).not.toHaveBeenCalled();
  latch.sent(now, 5000);
  now = 6500;
  latch.check();
  expect(failed).toHaveBeenCalledWith('RESPONSE_TIMEOUT');
});

import { describe, expect, it } from 'vitest';
import { DeploymentReception } from '../cloud/DeploymentReception.js';

const observation = (track = {}) => ({
  sid: 'local-fixture-sid',
  track,
  kind: 'audio' as const,
  bytes: 100,
  now: 0,
  bindingAllowed: true,
  allowed: false,
});

describe('deployment RTP subscription lifetime', () => {
  it('detects continuous forbidden audio beyond 2s and retains violations after unsubscribe', () => {
    const reception = new DeploymentReception();
    const input = observation();
    reception.observe(input);
    reception.observe({ ...input, bytes: 200, now: 2000 });
    expect(reception.snapshot().forbiddenReceived).toBe(0);
    reception.observe({ ...input, bytes: 300, now: 2001 });
    reception.forget(input.sid);
    expect(reception.snapshot()).toEqual({
      forbiddenReceived: 1,
      forbiddenByKind: { video: 0, audio: 1 },
      forbiddenByReason: { binding: 0, audioPolicy: 1 },
    });
  });

  it.each(['event', 'absent', 'replacement'])(
    '%s starts a new subscription observation',
    (kind) => {
      const reception = new DeploymentReception();
      const input = observation();
      reception.observe(input);
      reception.observe({ ...input, bytes: 200, now: 1000 });
      if (kind === 'event') reception.forget(input.sid);
      if (kind === 'absent') reception.retain(new Set());
      const next = { ...input, track: kind === 'replacement' ? {} : input.track };
      reception.observe({ ...next, bytes: 300, now: 10_000 });
      reception.observe({ ...next, bytes: 400, now: 10_500 });
      expect(reception.snapshot().forbiddenReceived).toBe(0);
      expect(reception.observe({ ...next, allowed: true, bytes: 500, now: 11_000 })).toBe(true);
      expect(reception.snapshot().forbiddenReceived).toBe(0);
    },
  );

  it('an allowed interval resets the window but a stats counter reset does not excuse leakage', () => {
    const reception = new DeploymentReception();
    const input = { ...observation(), kind: 'video' as const, bindingAllowed: false };
    reception.observe(input);
    reception.observe({ ...input, allowed: true, bytes: 200, now: 1000 });
    reception.observe({ ...input, bytes: 250, now: 5000 });
    reception.observe({ ...input, bytes: 0, now: 6000 });
    reception.observe({ ...input, bytes: 50, now: 7001 });
    expect(reception.snapshot()).toEqual({
      forbiddenReceived: 1,
      forbiddenByKind: { video: 1, audio: 0 },
      forbiddenByReason: { binding: 1, audioPolicy: 0 },
    });
    reception.reset();
    expect(reception.snapshot().forbiddenReceived).toBe(0);
  });
});

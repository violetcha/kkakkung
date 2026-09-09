import { describe, expect, it } from 'vitest';
import { CommandLimiter, TokenBucket } from '../../src/game/CommandLimiter.js';

describe('command token bucket', () => {
  it('allows a burst of 60 then rejects the 61st until refill', () => {
    const limiter = new CommandLimiter();
    for (let i = 0; i < 60; i++) expect(limiter.allow('c1', 1000)).toBe(true);
    expect(limiter.allow('c1', 1000)).toBe(false);
    expect(limiter.allow('c2', 1000)).toBe(true);
    // 30 tokens per second: 100ms later three more commands fit.
    expect(limiter.allow('c1', 1100)).toBe(true);
    expect(limiter.allow('c1', 1100)).toBe(true);
    expect(limiter.allow('c1', 1100)).toBe(true);
    expect(limiter.allow('c1', 1100)).toBe(false);
  });

  it('caps refill at capacity and ignores clock regressions', () => {
    const bucket = new TokenBucket();
    expect(bucket.tryTake(0)).toBe(true);
    expect(bucket.available(100_000)).toBe(60);
    expect(bucket.tryTake(50_000)).toBe(true);
    expect(bucket.available(50_000)).toBe(59);
    expect(() => bucket.tryTake(Number.NaN)).toThrow('INVALID_TIME');
    expect(() => new TokenBucket({ capacity: 0 })).toThrow('INVALID_BUCKET');
  });

  it('releases per-connection state when a connection is forgotten', () => {
    const limiter = new CommandLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(limiter.allow('c1', 0)).toBe(true);
    expect(limiter.allow('c1', 0)).toBe(false);
    limiter.forget('c1');
    expect(limiter.size).toBe(0);
    expect(limiter.allow('c1', 0)).toBe(true);
  });
});

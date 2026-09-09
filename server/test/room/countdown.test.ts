import { describe, expect, it } from 'vitest';
import { CountdownCoordinator } from '../../src/rooms/CountdownCoordinator.js';

describe('CountdownCoordinator', () => {
  it('arms once per loadId at now + 3000ms and fires exactly once', () => {
    const countdown = new CountdownCoordinator();
    expect(countdown.arm('load-1', 1000)).toBe(4000);
    expect(countdown.arm('load-1', 2000)).toBeNull();
    expect(countdown.startAt).toBe(4000);
    expect(countdown.due(3999)).toBe(false);
    expect(countdown.due(4000)).toBe(true);
    expect(countdown.due(4050)).toBe(false);
    expect(countdown.armed).toBe(false);
  });

  it('re-arms for a new loadId and cancels cleanly', () => {
    const countdown = new CountdownCoordinator({ durationMs: 500 });
    countdown.arm('load-1', 0);
    countdown.cancel();
    expect(countdown.startAt).toBeNull();
    expect(countdown.due(1000)).toBe(false);
    expect(countdown.arm('load-2', 1000)).toBe(1500);
  });
});

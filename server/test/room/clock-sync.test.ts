import { describe, expect, it } from 'vitest';
import { ClockSync } from '../../src/game/ClockSync.js';
import { fakeClock } from './test-harness.js';

describe('ClockSync', () => {
  it('stamps server monotonic receive/send times and echoes untrusted client time', () => {
    const clock = fakeClock(100);
    const sync = new ClockSync({
      serverEpoch: 'e1',
      now: () => {
        const value = clock.now();
        clock.advance(2);
        return value;
      },
    });
    const result = sync.handle('c1', { probeId: 'p1', clientSentAtMs: 9_999_999_999 });
    expect(result).toEqual({
      status: 'reply',
      reply: {
        probeId: 'p1',
        clientSentAtMs: 9_999_999_999,
        serverReceivedAtMs: 100,
        serverSentAtMs: 102,
        serverEpoch: 'e1',
      },
    });
  });

  it('rejects malformed probes and limits to five per second per connection', () => {
    const clock = fakeClock(0);
    const sync = new ClockSync({ serverEpoch: 'e1', now: clock.now });
    for (const bad of [
      { probeId: 'p', clientSentAtMs: Number.NaN },
      { probeId: 'p', clientSentAtMs: Number.POSITIVE_INFINITY },
      { probeId: 1, clientSentAtMs: 1 },
      { probeId: 'p', clientSentAtMs: 1, extra: 1 },
    ])
      expect(sync.handle('c1', bad)).toEqual({ status: 'rejected' });
    // Initial burst: five probes inside one second are all answered.
    for (let i = 0; i < 5; i++) {
      expect(sync.handle('c1', { probeId: `p${i}`, clientSentAtMs: i }).status).toBe('reply');
      clock.advance(200);
    }
    clock.set(999);
    expect(sync.handle('c1', { probeId: 'p6', clientSentAtMs: 6 })).toEqual({ status: 'limited' });
    expect(sync.handle('c2', { probeId: 'p6', clientSentAtMs: 6 }).status).toBe('reply');
    // Once the oldest probe leaves the one second window, a new probe is allowed again.
    clock.set(1000);
    expect(sync.handle('c1', { probeId: 'p7', clientSentAtMs: 7 }).status).toBe('reply');
    clock.set(10_000);
    expect(sync.handle('c1', { probeId: 'p8', clientSentAtMs: 8 }).status).toBe('reply');
  });
});

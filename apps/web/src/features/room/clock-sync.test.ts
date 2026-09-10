import { expect, it } from 'vitest';
import { createClockSync } from './clock-sync';
import type { ClockProbe } from '@kkakkung/protocol/game-messages';
it('uses round-trip median offset, rejects unknown probes and resets server epochs', () => {
  let now = 0;
  let id = 0;
  let probe!: ClockProbe;
  const clock = createClockSync({
    now: () => now,
    uuid: () => String(id++),
    send: (p) => {
      probe = p;
    },
  });
  for (let i = 0; i < 3; i++) {
    now = i * 250;
    clock.poll();
    now += 20;
    expect(
      clock.receive({
        ...probe,
        serverEpoch: 'e',
        serverReceivedAtMs: probe.clientSentAtMs + 110,
        serverSentAtMs: probe.clientSentAtMs + 110,
      }),
    ).toBe(true);
  }
  expect(clock.serverNow()).toBe(now + 100);
  clock.anchor({
    serverEpoch: 'e',
    matchId: 'm',
    heartbeatSeq: 1,
    serverTick: 10,
    serverTimeMs: 500,
  });
  expect(clock.renderTick()).toBeCloseTo(12.4);
  clock.anchor({
    serverEpoch: 'next',
    matchId: 'm',
    heartbeatSeq: 2,
    serverTick: 0,
    serverTimeMs: 0,
  });
  expect(clock.serverNow()).toBeNull();
  expect(clock.renderTick()).toBeNull();
});

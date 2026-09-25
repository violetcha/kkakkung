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

// S15P21C204-399. 10초마다 다시 잴 때 측정을 비우면 새 측정 세 개가 모일 때까지 렌더 틱을 몰라
// 11초마다 약 0.6초씩 걷기가 칸 단위로 끊겼다. 첫 추정 뒤로는 한 번도 놓치지 않아야 한다.
it('keeps the render tick across periodic re-measurement', () => {
  let now = 0;
  let id = 0;
  const rtt = 60;
  const inflight: { at: number; probe: ClockProbe }[] = [];
  const clock = createClockSync({
    now: () => now,
    uuid: () => String(id++),
    send: (probe) => inflight.push({ at: now + rtt, probe }),
  });
  clock.anchor({ serverEpoch: 'e', matchId: 'm', heartbeatSeq: 1, serverTick: 0, serverTimeMs: 0 });
  let firstKnownAt: number | null = null;
  const lostAt: number[] = [];
  for (now = 0; now <= 60_000; now += 16) {
    clock.poll();
    for (const flight of inflight.filter((f) => f.at <= now)) {
      inflight.splice(inflight.indexOf(flight), 1);
      const serverAt = flight.probe.clientSentAtMs + rtt / 2;
      clock.receive({
        ...flight.probe,
        serverEpoch: 'e',
        serverReceivedAtMs: serverAt,
        serverSentAtMs: serverAt,
      });
    }
    const known = clock.renderTick() !== null;
    if (known && firstKnownAt === null) firstKnownAt = now;
    if (!known && firstKnownAt !== null) lostAt.push(now);
  }
  expect(firstKnownAt).not.toBeNull();
  expect(firstKnownAt!).toBeLessThan(1_000);
  expect(lostAt).toEqual([]);
});

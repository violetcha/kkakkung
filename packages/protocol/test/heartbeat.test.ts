import { describe, expect, it } from 'vitest';

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  clockProbeSchema,
  clockReplySchema,
  gameHeartbeatSchema,
  heartbeatAckSchema,
} from '../src/game-messages/heartbeat.js';

describe('heartbeat and clock probe contracts', () => {
  it('fixes the 2s interval and 6s timeout', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(2000);
    expect(HEARTBEAT_TIMEOUT_MS).toBe(6000);
  });

  it('validates heartbeat and ack strictly', () => {
    const heartbeat = {
      serverEpoch: 'e1',
      matchId: 'm1',
      heartbeatSeq: 4,
      serverTick: 80,
      serverTimeMs: 4000.5,
    };
    expect(gameHeartbeatSchema.parse(heartbeat)).toEqual(heartbeat);
    expect(gameHeartbeatSchema.safeParse({ ...heartbeat, extra: 1 }).success).toBe(false);
    expect(
      heartbeatAckSchema.parse({ serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 4 }),
    ).toBeTruthy();
    expect(
      heartbeatAckSchema.safeParse({ serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: -1 }).success,
    ).toBe(false);
    expect(heartbeatAckSchema.safeParse({ serverEpoch: 'e1', matchId: 'm1' }).success).toBe(false);
  });

  it('echoes untrusted client time only when it is a finite number', () => {
    expect(clockProbeSchema.parse({ probeId: 'p1', clientSentAtMs: 123.4 })).toEqual({
      probeId: 'p1',
      clientSentAtMs: 123.4,
    });
    for (const bad of [
      { probeId: 'p1', clientSentAtMs: Number.NaN },
      { probeId: 'p1', clientSentAtMs: Number.POSITIVE_INFINITY },
      { probeId: 1, clientSentAtMs: 1 },
      { probeId: 'p1', clientSentAtMs: 1, extra: true },
      { probeId: '', clientSentAtMs: 1 },
    ])
      expect(clockProbeSchema.safeParse(bad).success).toBe(false);
    const reply = {
      probeId: 'p1',
      clientSentAtMs: 123.4,
      serverReceivedAtMs: 100,
      serverSentAtMs: 102,
      serverEpoch: 'e1',
    };
    expect(clockReplySchema.parse(reply)).toEqual(reply);
    expect(clockReplySchema.safeParse({ ...reply, serverSentAtMs: 'now' }).success).toBe(false);
  });
});

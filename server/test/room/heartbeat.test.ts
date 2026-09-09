import { describe, expect, it } from 'vitest';
import { HeartbeatTracker } from '../../src/game/Heartbeat.js';

describe('HeartbeatTracker', () => {
  it('sends every 2s and keeps a connection alive on valid acks', () => {
    const tracker = new HeartbeatTracker({ serverEpoch: 'e1' });
    tracker.register('c1', 'p1', 0);
    expect(tracker.due(0, 'm1', 10)).toHaveLength(1);
    expect(tracker.due(1999, 'm1', 20)).toHaveLength(0);
    const [second] = tracker.due(2000, 'm1', 40);
    expect(second?.heartbeat).toEqual({
      serverEpoch: 'e1',
      matchId: 'm1',
      heartbeatSeq: 2,
      serverTick: 40,
      serverTimeMs: 2000,
    });
    expect(
      tracker.ack('c1', { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 2 }, 'm1', 2100),
    ).toBe('accepted');
    expect(tracker.sweep(8000)).toEqual([]);
    expect(tracker.sweep(8100)).toEqual([{ type: 'CONNECTION_LOST', playerId: 'p1' }]);
    expect(tracker.sweep(20000)).toEqual([]);
  });

  it('ignores acks from another epoch, another match, duplicates and unsent future seqs', () => {
    const tracker = new HeartbeatTracker({ serverEpoch: 'e1' });
    tracker.register('c1', 'p1', 0);
    tracker.due(0, 'm1', 1);
    expect(
      tracker.ack('c1', { serverEpoch: 'old', matchId: 'm1', heartbeatSeq: 1 }, 'm1', 100),
    ).toBe('ignored');
    expect(
      tracker.ack('c1', { serverEpoch: 'e1', matchId: 'other', heartbeatSeq: 1 }, 'm1', 100),
    ).toBe('ignored');
    expect(
      tracker.ack('c1', { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 5 }, 'm1', 100),
    ).toBe('ignored');
    expect(
      tracker.ack(
        'c1',
        { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 1, extra: true },
        'm1',
        100,
      ),
    ).toBe('ignored');
    expect(
      tracker.ack('c1', { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 1 }, 'm1', 100),
    ).toBe('accepted');
    expect(
      tracker.ack('c1', { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 1 }, 'm1', 200),
    ).toBe('ignored');
    expect(tracker.sweep(6099)).toEqual([]);
    expect(tracker.sweep(6100)).toEqual([{ type: 'CONNECTION_LOST', playerId: 'p1' }]);
  });

  it('turns an explicit close into one immediate control and never a second one', () => {
    const tracker = new HeartbeatTracker({ serverEpoch: 'e1' });
    tracker.register('c1', 'p1', 0);
    tracker.due(0, 'm1', 1);
    tracker.ack('c1', { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 1 }, 'm1', 5900);
    expect(tracker.close('c1')).toEqual({ type: 'CONNECTION_LOST', playerId: 'p1' });
    expect(tracker.close('c1')).toBeNull();
    expect(tracker.sweep(100000)).toEqual([]);
    expect(tracker.size).toBe(0);
  });

  it('restarts liveness for a new match and drops lost connections', () => {
    const tracker = new HeartbeatTracker({ serverEpoch: 'e1' });
    tracker.register('c1', 'p1', 0);
    tracker.register('c2', 'p2', 0);
    tracker.sweep(6000);
    tracker.resetForMatch(6000);
    expect(tracker.size).toBe(0);
  });
});

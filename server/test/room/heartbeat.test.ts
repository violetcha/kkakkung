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

  // S15P21C204-337. 서버가 멈췄다 재개하면 모든 연결이 침묵한 것처럼 보인다. 멈춘 시간은 세지 않는다.
  it('does not count a server stall as client silence, but still loses a client that stays silent', () => {
    const stalls: [number, number][] = [];
    const tracker = new HeartbeatTracker({
      serverEpoch: 'e1',
      onStall: (stallMs, connections) => stalls.push([stallMs, connections]),
    });
    tracker.register('c1', 'p1', 0);
    tracker.register('c2', 'p2', 0);
    tracker.due(0, 'm1', 1);
    tracker.ack('c1', { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 1 }, 'm1', 1000);
    tracker.ack('c2', { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 1 }, 'm1', 1000);
    for (let t = 1000; t <= 3000; t += 50) expect(tracker.sweep(t)).toEqual([]);
    // 3000ms 에서 서버가 7초 멈춘다. 재개 첫 sweep 은 아무도 끊지 않는다.
    expect(tracker.sweep(10000)).toEqual([]);
    expect(stalls).toEqual([[7000, 2]]);
    // 멈추기 전 2초 침묵은 이어진다. c1 만 응답하면 c2 는 침묵 합계 6초에 정확히 한 번 끊긴다.
    tracker.due(10000, 'm1', 2);
    tracker.ack('c1', { serverEpoch: 'e1', matchId: 'm1', heartbeatSeq: 2 }, 'm1', 10100);
    let lost: unknown[] = [];
    for (let t = 10050; t <= 14000; t += 50) lost = lost.concat(tracker.sweep(t));
    expect(lost).toEqual([{ type: 'CONNECTION_LOST', playerId: 'p2' }]);
    expect(stalls).toHaveLength(1);
  });

  it('gives a connection registered during a quiet room no extra time', () => {
    const tracker = new HeartbeatTracker({ serverEpoch: 'e1' });
    tracker.sweep(0);
    tracker.register('c1', 'p1', 60000);
    // 빈 방의 긴 틈은 정지로 잡히지만, 방금 들어온 연결의 대기 시간을 늘리지는 않는다.
    expect(tracker.sweep(60000)).toEqual([]);
    for (let t = 60050; t < 66000; t += 50) expect(tracker.sweep(t)).toEqual([]);
    expect(tracker.sweep(66000)).toEqual([{ type: 'CONNECTION_LOST', playerId: 'p1' }]);
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

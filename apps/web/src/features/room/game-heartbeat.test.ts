import { expect, it, vi } from 'vitest';
import { createGameHeartbeat } from './game-heartbeat';
it('ACKs once and expires at exactly six seconds despite replayed or wrong-scope heartbeats', () => {
  let now = 0;
  const ack = vi.fn();
  const lost = vi.fn();
  const heartbeat = createGameHeartbeat({ now: () => now, ack, lost });
  heartbeat.setMatch('match');
  const value = {
    matchId: 'match',
    serverEpoch: 'epoch',
    heartbeatSeq: 1,
    serverTick: 0,
    serverTimeMs: 20,
  };
  expect(heartbeat.receive(value)).toBe(true);
  now = 5900;
  for (const invalid of [
    value,
    { ...value, heartbeatSeq: 2, serverEpoch: 'old' },
    { ...value, heartbeatSeq: 2, matchId: 'old' },
  ])
    expect(heartbeat.receive(invalid)).toBe(false);
  heartbeat.poll();
  expect(lost).not.toHaveBeenCalled();
  now = 6000;
  heartbeat.poll();
  heartbeat.close();
  expect(lost).toHaveBeenCalledOnce();
  expect(ack).toHaveBeenCalledOnce();
});

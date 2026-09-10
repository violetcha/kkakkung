import { expect, it, vi } from 'vitest';
import { createCommandLifecycle } from './command-lifecycle';
const id = '10000000-0000-4000-8000-000000000001';
function fixture() {
  let now = 0;
  const send = vi.fn();
  const changed = vi.fn();
  const life = createCommandLifecycle({ now: () => now, uuid: () => id, send, changed });
  life.setMatch('match');
  life.send({ type: 'READY', payload: { ready: true } });
  const base = { matchId: 'match', requestId: id, sequence: 0, stateVersion: 4 };
  return {
    life,
    send,
    changed,
    base,
    time: (n: number) => {
      now = n;
      life.poll();
    },
  };
}
it('ends receipt rejection immediately without waiting for outcome', () => {
  const f = fixture();
  f.life.receipt({ ...f.base, status: 'rejected', code: 'QUEUE_FULL' });
  f.time(9000);
  expect(f.life.size).toBe(0);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.changed.mock.lastCall?.[0].status).toBe('rejected');
});
it('waits for the authoritative view after applied and ignores duplicate outcomes', () => {
  const f = fixture();
  const outcome = { ...f.base, tick: 2, result: 'applied', code: null };
  f.life.outcome(outcome);
  expect(f.changed.mock.lastCall?.[0].status).toBe('waiting-view');
  f.life.view(4);
  f.life.outcome(outcome);
  expect(f.changed.mock.lastCall?.[0].status).toBe('applied');
  expect(f.changed).toHaveBeenCalledTimes(3);
});
it('queries at most three times, resyncs and never replays a command', () => {
  const f = fixture();
  for (const n of [2000, 4000, 6000, 8000, 10000]) f.time(n);
  expect(f.send.mock.calls.map((c) => c[0])).toEqual([
    'command',
    'request-status',
    'request-status',
    'request-status',
    'view-resync',
  ]);
  expect(f.changed.mock.lastCall?.[0].status).toBe('unconfirmed');
  expect(f.life.size).toBe(0);
});
it('correlates lookup results and clears pending on a new match', () => {
  const f = fixture();
  f.life.lookup({ matchId: 'match', requestId: id, status: 'unknown', outcome: null });
  expect(f.life.size).toBe(0);
  f.life.setMatch('new');
  f.time(10000);
  expect(f.send).toHaveBeenCalledTimes(2);
});

import { expect, it } from 'vitest';
import { RequestHistory } from '../../src/media/RequestHistory.js';

it('pins in-flight operations under 10,000 attempts and expires only settled history', () => {
  let now = 0;
  const history = new RequestHistory(() => now, { maxEntries: 4, retentionMs: 100 });
  const pending = { state: 'pending' };
  history.set('pending', pending);
  for (let i = 0; i < 10_000; i++) {
    const value = { state: 'done' };
    if (history.set(String(i), value)) history.settle(String(i), value);
    expect(history.retained.entries).toBeLessThanOrEqual(4);
  }
  expect(history.retained).toEqual({ entries: 4, pending: 1 });
  now = 100;
  history.prune();
  expect(history.get('pending')).toBe(pending);
  expect(history.retained).toEqual({ entries: 1, pending: 1 });
  history.settle('pending', pending);
  now = 200;
  history.prune();
  expect(history.retained.entries).toBe(0);
});

it('a late completion cannot settle a newer operation with the same request id', () => {
  let now = 0;
  const history = new RequestHistory(() => now, { maxEntries: 2, retentionMs: 10 });
  const old = {};
  const current = {};
  history.set('id', old);
  history.set('id', current);
  history.settle('id', old);
  now = 100;
  history.prune();
  expect(history.get('id')).toBe(current);
  expect(history.retained.pending).toBe(1);
});

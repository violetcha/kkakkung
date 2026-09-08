import { describe, expect, it } from 'vitest';
import { SessionStore } from '../src/session/SessionStore.js';

describe('development session boundary', () => {
  it('consumes a valid one-use token and rejects replay', () => {
    const store = new SessionStore({ now: () => 1000 });
    const issued = store.issue('하나');
    expect(store.consume(issued.token)).toEqual({ nickname: '하나' });
    expect(store.consume(issued.token)).toBeUndefined();
    expect(store.consume('not-issued')).toBeUndefined();
  });

  it('rejects an expired token, including exactly at the deadline', () => {
    let now = 1000;
    const store = new SessionStore({ now: () => now, ttlMs: 100 });
    const issued = store.issue('하나');
    now = 1100;
    expect(store.consume(issued.token)).toBeUndefined();
  });

  it('bounds pending tokens and reclaims expired capacity', () => {
    let now = 0;
    const store = new SessionStore({ now: () => now, maxEntries: 1, ttlMs: 10 });
    store.issue('하나');
    expect(() => store.issue('둘')).toThrow('SESSION_CAPACITY');
    now = 10;
    expect(store.issue('둘').token).toBeTruthy();
  });
});

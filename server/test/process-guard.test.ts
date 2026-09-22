import { describe, expect, it } from 'vitest';
import { installProcessGuard, type ProcessFaultKind } from '../src/process-guard.js';

function harness(close: () => Promise<void> = () => Promise.resolve()) {
  const listeners = new Map<ProcessFaultKind, (error: unknown) => void>();
  const reports: [ProcessFaultKind, unknown][] = [];
  const exits: number[] = [];
  const timers: [() => void, number][] = [];
  let closes = 0;
  installProcessGuard({
    on: (event, listener) => listeners.set(event, listener),
    report: (kind, error) => reports.push([kind, error]),
    close: () => {
      closes += 1;
      return close();
    },
    exit: (code) => exits.push(code),
    schedule: (callback, ms) => timers.push([callback, ms]),
  });
  return { listeners, reports, exits, timers, closes: () => closes };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// S15P21C204-336. An exception no room caught: record it, let the rooms close once, end with 1.
describe('process guard', () => {
  it('records an uncaught exception, closes once and ends the process with code 1', async () => {
    const h = harness();
    const error = new Error('outside every room');
    h.listeners.get('uncaughtException')!(error);
    expect(h.reports).toEqual([['uncaughtException', error]]);
    expect(h.closes()).toBe(1);
    expect(h.timers.map(([, ms]) => ms)).toEqual([10_000]);
    await settle();
    expect(h.exits).toEqual([1]);
  });

  it('records a later fault too but starts only one shutdown', async () => {
    const h = harness();
    h.listeners.get('unhandledRejection')!('first');
    h.listeners.get('uncaughtException')!(new Error('second'));
    expect(h.reports.map(([kind]) => kind)).toEqual(['unhandledRejection', 'uncaughtException']);
    expect(h.closes()).toBe(1);
    expect(h.timers).toHaveLength(1);
  });

  it('still ends when closing fails, and the hard stop covers a close that never settles', async () => {
    const failing = harness(() => Promise.reject(new Error('close failed')));
    failing.listeners.get('uncaughtException')!(new Error('x'));
    await settle();
    expect(failing.exits).toEqual([1]);

    const stuck = harness(() => new Promise(() => undefined));
    stuck.listeners.get('uncaughtException')!(new Error('x'));
    await settle();
    expect(stuck.exits).toEqual([]);
    stuck.timers[0]![0]();
    expect(stuck.exits).toEqual([1]);
  });
});

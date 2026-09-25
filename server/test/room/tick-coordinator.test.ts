import { describe, expect, it } from 'vitest';
import { RoomTickCoordinator } from '../../src/game/RoomTickCoordinator.js';
import type { MetricSample } from '../../src/game/ports.js';
import { fakeClock } from './test-harness.js';

function setup() {
  const clock = fakeClock(0);
  const metrics: MetricSample[] = [];
  const coordinator = new RoomTickCoordinator({
    now: clock.now,
    emitMetric: (s) => metrics.push(s),
  });
  const ticks: Record<string, number[]> = {};
  const overloads: Record<string, number[]> = {};
  const register = (id: string) => {
    ticks[id] = [];
    overloads[id] = [];
    coordinator.register(id, {
      onTick: (lag) => ticks[id]!.push(lag),
      onOverload: (lag) => overloads[id]!.push(lag),
    });
  };
  return { clock, coordinator, ticks, overloads, metrics, register };
}

describe('RoomTickCoordinator', () => {
  it('catches up late rooms in due order for at most four rounds and then yields', () => {
    const h = setup();
    h.register('a');
    h.clock.set(50 + 190);
    const result = h.coordinator.run();
    expect(result.executed).toBe(4);
    expect(result.yielded).toBe(false);
    expect(h.ticks.a).toHaveLength(4);
    expect(h.ticks.a![0]).toBe(190);
    expect(h.ticks.a![3]).toBe(40);
    h.clock.set(50 + 249);
    // 4 ticks moved nextDue to 250; a fifth tick is due but must wait for the next run.
    expect(h.coordinator.run().executed).toBe(1);
  });

  it('does not replay ticks after a long stall: overload fires once and nextDue jumps to now', () => {
    const h = setup();
    h.register('a');
    h.clock.set(2050);
    const result = h.coordinator.run();
    expect(result.executed).toBe(0);
    expect(result.overloaded).toEqual(['a']);
    expect(h.overloads.a).toEqual([2000]);
    expect(h.coordinator.run().overloaded).toEqual([]);
    expect(h.ticks.a).toEqual([]);
    h.coordinator.rearm('a');
    h.clock.advance(50);
    expect(h.coordinator.run().executed).toBe(1);
  });

  // S15P21C204-389. A single stall past 250ms no longer voids the round: the room catches up.
  it('catches up after one stall and overloads only on a third stall within 10s', () => {
    const h = setup();
    h.register('a');
    const stall = (to: number) => {
      h.clock.set(to);
      const result = h.coordinator.run();
      // Drain the catch-up so the next stall starts from an on-time room.
      while (h.coordinator.run().executed > 0);
      return result;
    };
    expect(stall(50 + 300).overloaded).toEqual([]);
    expect(h.ticks.a!.length).toBeGreaterThanOrEqual(7);
    expect(h.overloads.a).toEqual([]);
    expect(stall(1_000).overloaded).toEqual([]);
    const third = stall(1_700);
    expect(third.overloaded).toEqual(['a']);
    expect(h.overloads.a).toHaveLength(1);
  });

  it('counts one stall once while it catches up, and forgets stalls older than 10s', () => {
    const h = setup();
    h.register('a');
    // One 900ms stall takes several runs to catch up; it is still a single stall.
    h.clock.set(50 + 900);
    for (let i = 0; i < 10; i++) expect(h.coordinator.run().overloaded).toEqual([]);
    h.clock.set(1_500);
    while (h.coordinator.run().executed > 0);
    // Keep the room on time until the first stall ages out of the 10s window.
    for (let at = 1_550; at <= 11_000; at += 50) {
      h.clock.set(at);
      h.coordinator.run();
    }
    // Only one stall (1,500) is still in the window, so this second one does not overload.
    h.clock.set(11_050 + 300);
    expect(h.coordinator.run().overloaded).toEqual([]);
    expect(h.overloads.a).toEqual([]);
  });

  it('overloads at once past 1,000ms, and every room on a process-wide stall', () => {
    const h = setup();
    h.register('a');
    h.register('b');
    h.clock.set(50 + 1_200);
    const result = h.coordinator.run();
    expect(result.overloaded.sort()).toEqual(['a', 'b']);
    expect(h.overloads.a).toHaveLength(1);
    expect(h.overloads.b).toHaveLength(1);
    expect(h.coordinator.run().overloaded).toEqual([]);
  });

  it('contains a throwing tick: other rooms keep ticking and the failing room waits for rearm', () => {
    const clock = fakeClock(0);
    const reported: string[] = [];
    const metrics: MetricSample[] = [];
    const coordinator = new RoomTickCoordinator({
      now: clock.now,
      emitMetric: (sample) => metrics.push(sample),
      onTickError: (id) => reported.push(id),
    });
    const failures: unknown[] = [];
    let aTicks = 0;
    let boom = true;
    coordinator.register('a', {
      onTick: () => {
        if (boom) throw new RangeError('role mismatch for p1');
        aTicks += 1;
      },
      onOverload: () => undefined,
      onTickFailed: (error) => failures.push(error),
    });
    const bTicks: number[] = [];
    coordinator.register('b', { onTick: (lag) => bTicks.push(lag), onOverload: () => undefined });
    clock.set(50);
    const first = coordinator.run();
    expect(first.failed).toEqual(['a']);
    expect(first.overloaded).toEqual([]);
    expect(bTicks).toEqual([0]);
    expect((failures[0] as Error).message).toBe('role mismatch for p1');
    expect(reported).toEqual(['a']);
    // The failed room is counted under the registered overload name; no new metric name.
    expect(metrics.filter((m) => m.name === 'tick.overload').map((m) => m.matchRef)).toEqual(['a']);
    expect([...new Set(metrics.map((m) => m.name))].sort()).toEqual([
      'eventLoop.lag',
      'tick.due',
      'tick.duration',
      'tick.overload',
    ]);
    // 'a' is not replayed even once the fault is gone; only rearm brings it back.
    boom = false;
    clock.set(150);
    expect(coordinator.run().failed).toEqual([]);
    expect(aTicks).toBe(0);
    expect(bTicks).toHaveLength(3);
    coordinator.rearm('a');
    clock.advance(50);
    coordinator.run();
    expect(aTicks).toBe(1);
    expect(failures).toHaveLength(1);
  });

  it('survives a failure handler that throws as well', () => {
    const clock = fakeClock(0);
    const coordinator = new RoomTickCoordinator({ now: clock.now });
    coordinator.register('a', {
      onTick: () => {
        throw new Error('tick');
      },
      onOverload: () => undefined,
      onTickFailed: () => {
        throw new Error('handler');
      },
    });
    const bTicks: number[] = [];
    coordinator.register('b', { onTick: (lag) => bTicks.push(lag), onOverload: () => undefined });
    clock.set(50);
    expect(() => coordinator.run()).not.toThrow();
    expect(bTicks).toEqual([0]);
  });

  // S15P21C204-336. The overload callback aborts a match. A throw there used to leave the 10ms
  // interval and end the process with every room in it.
  it('contains an overload callback that throws and reports it as a failed room', () => {
    const clock = fakeClock(0);
    const reported: string[] = [];
    const coordinator = new RoomTickCoordinator({
      now: clock.now,
      onTickError: (id) => reported.push(id),
    });
    const failures: unknown[] = [];
    coordinator.register('a', {
      onTick: () => undefined,
      onOverload: () => {
        throw new Error('abort failed');
      },
      onTickFailed: (error) => failures.push(error),
    });
    const bTicks: number[] = [];
    coordinator.register('b', { onTick: (lag) => bTicks.push(lag), onOverload: () => undefined });
    // S15P21C204-389. Past 1,000ms is an overload at once. 'b' is just as late, so it overloads
    // too; only 'a' throws.
    clock.set(1_200);
    let result!: ReturnType<RoomTickCoordinator['run']>;
    expect(() => (result = coordinator.run())).not.toThrow();
    expect(result.overloaded.sort()).toEqual(['a', 'b']);
    expect(result.failed).toEqual(['a']);
    expect(reported).toEqual(['a']);
    expect((failures[0] as Error).message).toBe('abort failed');
    coordinator.rearm('b');
    clock.advance(50);
    coordinator.run();
    expect(bTicks).toHaveLength(1);
  });

  it('treats exactly 250ms as late but valid and emits allow-listed metric names', () => {
    const h = setup();
    h.register('a');
    h.clock.set(50 + 250);
    expect(h.coordinator.run().executed).toBe(4);
    expect(h.overloads.a).toEqual([]);
    const names = new Set(h.metrics.map((m) => m.name));
    expect([...names].sort()).toEqual([
      'eventLoop.lag',
      'tick.catchup',
      'tick.due',
      'tick.duration',
    ]);
    expect(h.metrics.every((m) => m.unit === 'count' || m.unit === 'ms')).toBe(true);
  });

  it('reports measured room work with one shared run timestamp for combined-room timing', () => {
    const h = setup();
    for (const [id, duration] of [
      ['a', 2],
      ['b', 3],
    ] as const)
      h.coordinator.register(id, {
        onTick: () => h.clock.advance(duration),
        onOverload: () => undefined,
      });
    h.clock.set(50);
    h.coordinator.run();
    const durations = h.metrics.filter((sample) => sample.name === 'tick.duration');
    expect(durations.map((sample) => [sample.matchRef, sample.value, sample.atMs])).toEqual([
      ['a', 2, 50],
      ['b', 3, 50],
    ]);
  });
});

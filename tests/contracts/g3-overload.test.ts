// F-12 / QA-07 G3-D: lag, catch-up, overload abort, TTL and the fixed deadline on the real
// composition (A matchCore, B MatchDriver + RoomTickCoordinator + CommandQueue). Fake clock for
// 100/200 ms delays and the 2 s stall; one separate case runs a real event-loop stall inside a
// child process owned by this test (scripts/isolated-server-process.mjs).
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomTickCoordinator } from '../../server/src/game/RoomTickCoordinator.ts';
import { QUEUE_LIMITS } from '../../server/src/game/CommandQueue.ts';
import type { MetricSample } from '../../server/src/game/ports.ts';
import { G3_TUNING, createG3Harness, fakeClock } from '../fixtures/g3-scenarios.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const TICK = G3_TUNING.tickMs;

function coordinated() {
  const clock = fakeClock(1000);
  const h = createG3Harness({ clock });
  const metrics: MetricSample[] = [];
  const overloads: number[] = [];
  const coordinator = new RoomTickCoordinator({
    now: clock.now,
    emitMetric: (s) => metrics.push(s),
  });
  coordinator.register(h.instance.gameInstanceId, {
    onTick: () => {
      h.driver.tick();
    },
    onOverload: (lagMs) => {
      // What KkakkungRoom does on overload: abort the match on the next tick, then re-arm.
      overloads.push(lagMs);
      h.abort('SERVER_TICK_OVERLOAD');
    },
  });
  h.driver.enqueueControl(h.instance.gameInstanceId, { type: 'START_PLAYING', startTick: 1 });
  return { h, clock, coordinator, metrics, overloads };
}

describe('G3-D lag and catch-up (injected clock)', () => {
  it('100 ms late runs the due ticks in order without aborting; the deadline does not move', () => {
    const { h, clock, coordinator } = coordinated();
    clock.set(1000 + TICK + 100);
    const run = coordinator.run();
    expect(run.executed).toBe(3);
    expect(run.overloaded).toEqual([]);
    expect(h.frame().phase).toBe('PLAYING');
    expect(h.frame().tick).toBe(3);
    expect(h.state().deadlineTick).toBe(1 + G3_TUNING.roundTicks);
  });

  it('200 ms late catches up at most four rounds per run, then yields and finishes next run', () => {
    const { h, clock, coordinator } = coordinated();
    clock.set(1000 + TICK + 200);
    const first = coordinator.run();
    expect(first.executed).toBe(4);
    expect(first.yielded).toBe(true);
    expect(first.overloaded).toEqual([]);
    const second = coordinator.run();
    expect(second.executed).toBe(1);
    expect(h.frame().tick).toBe(5);
    expect(h.state().deadlineTick).toBe(1 + G3_TUNING.roundTicks);
    expect(h.integrityFailures).toEqual([]);
  });

  it('a 2 s stall aborts with SERVER_TICK_OVERLOAD, replays nothing and never extends the deadline', () => {
    const { h, clock, coordinator, overloads, metrics } = coordinated();
    clock.set(1000 + TICK);
    coordinator.run();
    expect(h.frame().phase).toBe('PLAYING');
    const deadline = h.state().deadlineTick;
    h.move('t1');
    clock.advance(2000);
    const stalled = coordinator.run();
    expect(stalled.executed).toBe(0);
    expect(stalled.overloaded).toEqual([h.instance.gameInstanceId]);
    // nextDue was one tick after the last executed tick, so the measured lag is 2000 - TICK.
    expect(overloads).toEqual([2000 - TICK]);
    expect(metrics.filter((m) => m.name === 'tick.overload')).toHaveLength(1);
    // No mass catch-up: one more run after re-arming applies the abort on a single tick.
    coordinator.rearm(h.instance.gameInstanceId);
    clock.advance(TICK);
    const after = coordinator.run();
    expect(after.executed).toBe(1);
    expect(h.frame().tick).toBe(2);
    expect(h.frame().phase).toBe('ABORTED');
    expect(h.frame().abortReason).toBe('SERVER_TICK_OVERLOAD');
    expect(h.state().deadlineTick).toBe(deadline);
    expect(h.intents).toContainEqual({ type: 'RETIRE_INSTANCE', reason: 'aborted' });
    // The move accepted before the stall was processed on the abort tick, not replayed 40 times.
    expect(h.outcomesOf('t1')).toHaveLength(1);
    h.move('r2');
    clock.advance(TICK);
    coordinator.run();
    expect(h.lastOutcome('r2')).toMatchObject({ result: 'canceled', code: 'ROUND_ENDED' });
    // Rooms are not re-armed automatically: without rearm the room stays out of the loop.
    expect(coordinator.run().executed).toBe(0);
  });

  it('a held move expires 500 ms after its last refresh and stops re-reserving', () => {
    const h = createG3Harness();
    h.start();
    expect(QUEUE_LIMITS.heldMoveTtlMs).toBe(500);
    const before = h.player('r3').cell;
    h.move('r3');
    h.tick();
    expect(h.player('r3').heldMove).not.toBeNull();
    expect(h.player('r3').action?.kind).toBe('move');
    // 500 ms = 10 ticks after acceptance the queue emits EXPIRE_MOVE; the core drops the hold.
    h.ticks(QUEUE_LIMITS.heldMoveTtlMs / TICK);
    expect(h.player('r3').heldMove).toBeNull();
    // A move in flight still completes, then nothing new starts.
    h.ticks(G3_TUNING.moveTicks * 3);
    const after = h.player('r3').cell;
    expect(after.x).toBe(before.x);
    expect(before.y - after.y).toBeLessThanOrEqual(2);
    expect(before.y - after.y).toBeGreaterThanOrEqual(1);
    expect(h.player('r3').action).toBeNull();
    const settled = h.player('r3').cell;
    h.ticks(G3_TUNING.moveTicks * 2);
    expect(h.player('r3').cell).toEqual(settled);
  });

  it('the round deadline is fixed at start: reaching it ends the round for taggers', () => {
    const h = createG3Harness();
    h.start();
    const deadline = h.state().deadlineTick!;
    // Jump the tick counter to the deadline by ticking; every tick is 50 ms of fake time.
    h.ticks(deadline - h.frame().tick);
    expect(h.frame().tick).toBe(deadline);
    expect(h.frame().phase).toBe('RESULT');
    expect(h.frame().result).toEqual({ winner: 'taggers', reason: 'timeout' });
    expect(h.state().deadlineTick).toBe(deadline);
  });
});

describe('G3-D real event-loop stall (child process owned by the test)', () => {
  it('a real 1.5 s block trips overload exactly once and executes zero ticks during the block', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--no-warnings',
        resolve(root, 'scripts/isolated-server-process.mjs'),
        '--stall-ms',
        '1500',
      ],
      { cwd: root, encoding: 'utf8', timeout: 20_000 },
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout.trim().split('\n').at(-1)!) as {
      stallMs: number;
      ticksBeforeStall: number;
      ticksDuringStall: number;
      overloads: number;
      lagMs: number | null;
      executedAfterRearm: number;
    };
    expect(report.stallMs).toBe(1500);
    expect(report.ticksBeforeStall).toBeGreaterThan(0);
    expect(report.ticksDuringStall).toBe(0);
    expect(report.overloads).toBe(1);
    expect(report.lagMs).not.toBeNull();
    // nextDue can sit up to one tick period after the block started; the interval adds ~10 ms.
    expect(report.lagMs!).toBeGreaterThanOrEqual(1500 - TICK - 20);
    expect(report.lagMs!).toBeGreaterThan(250);
    expect(report.executedAfterRearm).toBeGreaterThan(0);
  });
});

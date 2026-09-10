#!/usr/bin/env node
// Owned by F (F-12 / QA-07). Runs B's real RoomTickCoordinator on real timers in a process the
// test owns, blocks the event loop for --stall-ms, and reports how the coordinator reacted.
// The blocking happens here, never inside the vitest worker or a shared dev server.
//
//   node --experimental-transform-types --no-warnings scripts/isolated-server-process.mjs --stall-ms 1500
//
// Output: one JSON line on stdout. Exit 0 when the run completed, 2 on bad arguments.

import { performance } from 'node:perf_hooks';
import { clearInterval, setInterval, setTimeout } from 'node:timers';
import { RoomTickCoordinator } from '../server/src/game/RoomTickCoordinator.ts';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const stallMs = Number(arg('--stall-ms', '1500'));
const warmMs = Number(arg('--warm-ms', '300'));
if (!Number.isFinite(stallMs) || stallMs <= 0 || !Number.isFinite(warmMs) || warmMs < 0) {
  console.error('usage: isolated-server-process.mjs --stall-ms <ms> [--warm-ms <ms>]');
  process.exit(2);
}

const coordinator = new RoomTickCoordinator({ now: () => performance.now() });
let ticks = 0;
const overloads = [];
coordinator.register('room', {
  onTick: () => {
    ticks += 1;
  },
  onOverload: (lagMs) => {
    overloads.push(lagMs);
  },
});

const loop = setInterval(() => {
  coordinator.run();
}, 10);

setTimeout(() => {
  const ticksBeforeStall = ticks;
  const started = performance.now();
  // Real stall: nothing else on this event loop runs until the busy loop ends.
  while (performance.now() - started < stallMs) {
    /* spin */
  }
  const ticksDuringStall = ticks - ticksBeforeStall;
  // Give the interval one turn to observe the lag, then re-arm the way the room would.
  setTimeout(() => {
    clearInterval(loop);
    const overloadCount = overloads.length;
    coordinator.rearm('room');
    const rearmStart = ticks;
    const retry = setInterval(() => {
      coordinator.run();
    }, 10);
    setTimeout(() => {
      clearInterval(retry);
      console.log(
        JSON.stringify({
          stallMs,
          ticksBeforeStall,
          ticksDuringStall,
          overloads: overloadCount,
          lagMs: overloads[0] ?? null,
          executedAfterRearm: ticks - rearmStart,
        }),
      );
    }, 200);
  }, 30);
}, warmMs);

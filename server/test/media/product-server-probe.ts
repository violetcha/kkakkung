// Test-only diagnostic, never a game clock or an acceptance gate. No IO or payload capture.
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { PHASES, type Phase } from '@kkakkung/protocol/game-schema';

export type ProbePhase = Phase | 'BOOT' | 'NO_ROOM';
type Window = Readonly<{
  fromMs: number;
  toMs: number;
  elapsedMs: number;
  lagMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  loopActiveMs: number;
  loopIdleMs: number;
  phaseBefore: ProbePhase;
  phaseAfter: ProbePhase;
}>;
export type ProductServerProbe = Readonly<{
  intervalMs: number;
  samples: number;
  elapsedMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  gcCount: number;
  gcTotalMs: number;
  gcMaxMs: number;
  gcEntriesDropped: number;
  worst: readonly (Window & { gcOverlapMs: number })[];
}>;

export function createProductServerProbe(readPhase: () => unknown) {
  const intervalMs = 10;
  const startedAt = performance.now();
  const initialCpu = process.cpuUsage();
  let previousAt = startedAt;
  let previousCpu = initialCpu;
  let previousLoop = performance.eventLoopUtilization();
  const phase = (): ProbePhase => {
    const value = readPhase();
    return (
      PHASES.find((candidate) => candidate === value) ?? (value === 'BOOT' ? 'BOOT' : 'NO_ROOM')
    );
  };
  let previousPhase = phase();
  let samples = 0;
  let gcCount = 0;
  let gcTotalMs = 0;
  let gcMaxMs = 0;
  let gcEntriesDropped = 0;
  let closed = false;
  const worst: Window[] = [];
  const gc: { fromMs: number; toMs: number }[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType !== 'gc' || !Number.isFinite(entry.duration) || entry.duration < 0)
        continue;
      gcCount += 1;
      gcTotalMs += entry.duration;
      gcMaxMs = Math.max(gcMaxMs, entry.duration);
      gc.push({
        fromMs: entry.startTime - startedAt,
        toMs: entry.startTime + entry.duration - startedAt,
      });
      if (gc.length > 2048) {
        gc.shift();
        gcEntriesDropped += 1;
      }
    }
  });
  observer.observe({ entryTypes: ['gc'] });
  const timer = setInterval(() => {
    const now = performance.now();
    const cpu = process.cpuUsage();
    const loop = performance.eventLoopUtilization();
    const currentPhase = phase();
    const elapsedMs = now - previousAt;
    const sample: Window = {
      fromMs: previousAt - startedAt,
      toMs: now - startedAt,
      elapsedMs,
      lagMs: Math.max(0, elapsedMs - intervalMs),
      cpuUserMs: Math.max(0, cpu.user - previousCpu.user) / 1000,
      cpuSystemMs: Math.max(0, cpu.system - previousCpu.system) / 1000,
      loopActiveMs: Math.max(0, loop.active - previousLoop.active),
      loopIdleMs: Math.max(0, loop.idle - previousLoop.idle),
      phaseBefore: previousPhase,
      phaseAfter: currentPhase,
    };
    samples += 1;
    if (worst.length < 8 || sample.lagMs > worst[worst.length - 1]!.lagMs) {
      worst.push(sample);
      worst.sort((left, right) => right.lagMs - left.lagMs);
      if (worst.length > 8) worst.pop();
    }
    previousAt = now;
    previousCpu = cpu;
    previousLoop = loop;
    previousPhase = currentPhase;
  }, intervalMs);
  timer.unref();
  return {
    snapshot(): ProductServerProbe {
      const cpu = process.cpuUsage();
      return {
        intervalMs,
        samples,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        cpuUserMs: Math.max(0, cpu.user - initialCpu.user) / 1000,
        cpuSystemMs: Math.max(0, cpu.system - initialCpu.system) / 1000,
        gcCount,
        gcTotalMs,
        gcMaxMs,
        gcEntriesDropped,
        worst: worst.map((sample) => ({
          ...sample,
          // Observer delivery is asynchronous; compute overlap at inspection time, after
          // already-finished intervals have had a chance to receive their GC entries.
          gcOverlapMs: gc.reduce(
            (sum, event) =>
              sum +
              Math.max(
                0,
                Math.min(event.toMs, sample.toMs) - Math.max(event.fromMs, sample.fromMs),
              ),
            0,
          ),
        })),
      };
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      observer.disconnect();
    },
  };
}

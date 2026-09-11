// Explicitly enabled test-only CPU samples. Inspector captures call frames, not arguments,
// local variables, tokens or heap snapshots. No debugger socket is opened.
import { Session } from 'node:inspector/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ProductServerProbe } from './product-server-probe.js';
import { profileProductPhases } from './product-phase-profile.js';

export async function startProductCpuProfile(
  snapshot: () => ProductServerProbe,
  phase: () => string,
) {
  const phases = profileProductPhases(phase);
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 1000 });
  const beforeMs = snapshot().elapsedMs;
  await session.post('Profiler.start');
  const afterMs = snapshot().elapsedMs;
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    try {
      const { profile } = await session.post('Profiler.stop');
      const directory = fileURLToPath(new URL('../../../.local/integration/', import.meta.url));
      await mkdir(directory, { recursive: true });
      const name = `product-child-${process.pid}`;
      await writeFile(join(directory, `${name}.cpuprofile`), JSON.stringify(profile), {
        flag: 'wx',
      });
      await writeFile(
        join(directory, `${name}.cpu-metadata.json`),
        JSON.stringify({
          profileStartProbeBeforeMs: beforeMs,
          profileStartProbeAfterMs: afterMs,
          probe: snapshot(),
          phases: phases.snapshot(),
        }),
        { flag: 'wx' },
      );
    } finally {
      phases.close();
      session.disconnect();
    }
  };
}

#!/usr/bin/env node
// Owned by F (QA). Reads the productServerProbe windows that server/test/media/product-integration.test.ts
// prints on every run (success summary line or failure Error JSON) and lists them per run.
// usage: node scripts/probe-extract.mjs <jenkins-console.log> [...more logs]
import { readFileSync } from 'node:fs';
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const files = process.argv.slice(2);
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8').replace(ANSI, '');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  let run = 0;
  for (const raw of lines) {
    const line = raw.replace(/^\[[0-9T:.Z-]+\]\s?/, '');
    if (!line.includes('"probe":{') && !line.includes('"productServerProbe":{')) continue;
    const start = line.indexOf('{');
    if (start < 0) continue;
    let json = line.slice(start);
    if (json.startsWith('{') === false) continue;
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      // failure lines start with "Error: {" — cut to the last closing brace
      const end = json.lastIndexOf('}');
      try {
        parsed = JSON.parse(json.slice(0, end + 1));
      } catch {
        continue;
      }
    }
    const probe = parsed.productServerProbe ?? parsed.server?.probe ?? null;
    if (!probe?.worst) continue;
    run += 1;
    const kind = parsed.productServerProbe ? 'pass' : 'fail';
    const head = `${file.replace(/.*builds[\\/]/, '#').replace(/[\\/]log$/, '')} run${run} ${kind} samples=${probe.samples} cpuUser=${Math.round(probe.cpuUserMs)} gc=${probe.gcCount}/${probe.gcTotalMs.toFixed(0)}ms`;
    console.log(head);
    for (const w of probe.worst) {
      console.log(
        `  ${w.phaseBefore}->${w.phaseAfter} t=${Math.round(w.fromMs)} elapsed=${w.elapsedMs.toFixed(0)} lag=${w.lagMs.toFixed(0)} cpuU=${w.cpuUserMs} cpuS=${w.cpuSystemMs} loopActive=${w.loopActiveMs.toFixed(0)} idle=${w.loopIdleMs.toFixed(0)} gc=${w.gcOverlapMs.toFixed(1)}`,
      );
    }
  }
}

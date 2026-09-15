#!/usr/bin/env node
// Owned by F (QA). Summarizes a product-integration CPU profile: E phase components from the
// cpu-metadata.json and whole-run self time by function/area from the .cpuprofile.
// usage: node scripts/profile-summary.mjs <cpu-metadata.json> [<profile.cpuprofile>]
import { readFileSync } from 'node:fs';
const [metaPath, profPath] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
console.log('== phase components (E product-phase-profile), sorted by maxMs');
const rows = Object.entries(meta.phases)
  .map(([k, v]) => ({ k, ...v }))
  .sort((a, b) => b.maxMs - a.maxMs);
for (const r of rows.slice(0, 14))
  console.log(
    `${r.k.padEnd(34)} count=${String(r.count).padStart(5)} total=${r.totalMs.toFixed(0).padStart(6)}ms own=${r.ownMs.toFixed(0).padStart(6)}ms max=${r.maxMs.toFixed(1).padStart(6)}ms`,
  );
console.log('== GAME_LOADING/* and MAP_FINALIZING/*');
for (const r of rows
  .filter((r) => /^(GAME_LOADING|MAP_FINALIZING)\//.test(r.k))
  .sort((a, b) => b.ownMs - a.ownMs))
  console.log(
    `${r.k.padEnd(34)} count=${String(r.count).padStart(5)} total=${r.totalMs.toFixed(0).padStart(6)}ms own=${r.ownMs.toFixed(0).padStart(6)}ms max=${r.maxMs.toFixed(1).padStart(6)}ms`,
  );
if (profPath) {
  const p = JSON.parse(readFileSync(profPath, 'utf8'));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const n = byId.get(p.samples[i]);
    const dt = p.timeDeltas[i] ?? 0;
    const f = n.callFrame;
    const url = (f.url || '').replace(/^file:\/\/\/?.*?S15P21C204\//, '');
    const key = `${f.functionName || '(anon)'} @ ${url || '(native)'}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0) / 1000;
  console.log(`== whole-run self time top 25 (total ${total.toFixed(0)}ms sampled)`);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`${(v / 1000).toFixed(0).padStart(7)}ms  ${k}`);
  const byArea = new Map();
  for (const [k, v] of self) {
    const m = k.match(/@ ([^:]+)/);
    const url = m ? m[1] : '(native)';
    const area = url.startsWith('server/src/')
      ? url.split('/').slice(0, 3).join('/')
      : url.startsWith('packages/')
        ? url.split('/').slice(0, 2).join('/')
        : url.includes('node_modules')
          ? 'node_modules:' +
            (url.match(/node_modules\/(?:\.pnpm\/)?([^/@]+(?:@[^/]+)?)/)?.[1] ?? '?')
          : url.startsWith('node:') || url === '(native)'
            ? 'node-internal'
            : url.split('/').slice(0, 2).join('/');
    byArea.set(area, (byArea.get(area) ?? 0) + v);
  }
  console.log('== self time by area');
  for (const [k, v] of [...byArea.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`${(v / 1000).toFixed(0).padStart(7)}ms  ${k}`);
}

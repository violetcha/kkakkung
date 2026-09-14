#!/usr/bin/env node
// Owned by F (QA). Attributes deep-equal/structuredClone samples of a product-integration CPU
// profile to the nearest application frame, and prints the local probe worst windows.
// usage: node scripts/profile-callers.mjs <cpu-metadata.json> <profile.cpuprofile> <label>
import { readFileSync } from 'node:fs';
const [metaPath, profPath, labelArg] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
console.log(`== ${labelArg} probe worst (local run)`);
for (const w of meta.probe.worst)
  console.log(
    `  ${w.phaseBefore}->${w.phaseAfter} t=${Math.round(w.fromMs)} elapsed=${w.elapsedMs.toFixed(0)} lag=${w.lagMs.toFixed(0)} cpuU=${w.cpuUserMs.toFixed(0)} loopActive=${w.loopActiveMs.toFixed(0)} gc=${w.gcOverlapMs.toFixed(1)}`,
  );
const p = JSON.parse(readFileSync(profPath, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const short = (f) =>
  `${f.functionName || '(anon)'} @ ${(f.url || '').replace(/^file:\/\/\/?.*?S15P21C204\//, '') || '(native)'}:${f.lineNumber + 1}`;
const isOurs = (f) =>
  /S15P21C204\/(server\/src|packages)\//.test(f.url || '') ||
  /^(server\/src|packages)\//.test(f.url || '');
const owner = (id) => {
  let cur = id;
  while (cur !== undefined) {
    const n = byId.get(cur);
    if (n && isOurs(n.callFrame)) return short(n.callFrame);
    cur = parent.get(cur);
  }
  return '(no app frame)';
};
const hot = /node:internal\/util\/comparisons|js_transferable|structuredClone/;
const agg = new Map();
let hotTotal = 0;
const ownerAll = new Map();
for (let i = 0; i < p.samples.length; i++) {
  const n = byId.get(p.samples[i]);
  const dt = p.timeDeltas[i] ?? 0;
  const f = n.callFrame;
  const o = owner(n.id);
  ownerAll.set(o, (ownerAll.get(o) ?? 0) + dt);
  if (hot.test(f.url || '') || f.functionName === 'structuredClone') {
    hotTotal += dt;
    agg.set(o, (agg.get(o) ?? 0) + dt);
  }
}
console.log(
  `== deep-equal / structuredClone time by nearest app caller (total ${(hotTotal / 1000).toFixed(0)}ms)`,
);
for (const [k, v] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))
  console.log(`${(v / 1000).toFixed(0).padStart(7)}ms  ${k}`);
console.log(
  '== total sampled time by nearest app frame (inclusive of node internals below it), top 20',
);
for (const [k, v] of [...ownerAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(`${(v / 1000).toFixed(0).padStart(7)}ms  ${k}`);

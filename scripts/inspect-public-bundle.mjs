#!/usr/bin/env node
// Owned by F (F-13 / QA-08). Scans a built web bundle (apps/web/dist) for server-only content
// that must never reach a browser: the authoritative map templates, the placement fallbacks,
// the match tuning file and operator secrets. Sentinels are derived from the real server files
// at run time, so a renamed template is still caught. Public assets (MediaPipe models, generic
// geometry) are allowed and never flagged.
//
//   node scripts/inspect-public-bundle.mjs --directory apps/web/dist [--evidence .local/qa/QA-08]
//
// Exit 0 when nothing leaked, 1 on any finding, 3 when the directory does not exist. Findings
// name the file and the sentinel id only, never the leaked bytes.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** File types a bundle can carry text in. Binary assets (wasm, images, fonts) are skipped. */
export const SCANNED_EXTENSIONS = Object.freeze([
  '.js',
  '.mjs',
  '.cjs',
  '.map',
  '.json',
  '.html',
  '.txt',
  '.css',
]);

/**
 * Builds the sentinel list from the server-only files. Each sentinel has an id (safe to print)
 * and a literal string that must not appear in any public file.
 */
export function deriveSentinels(serverRoot = root) {
  const sentinels = [];
  const read = (p) => {
    const file = resolve(serverRoot, p);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
  for (const name of ['master-v1', 'practice-v1']) {
    const raw = read(`server/content/maps/${name}.json`);
    if (!raw) continue;
    const json = JSON.parse(raw);
    // The template id and version pair, and the longest interior rows of the maze itself.
    sentinels.push({ id: `map:${name}:templateId`, literal: `"templateId":"${json.templateId}"` });
    sentinels.push({
      id: `map:${name}:templateId-spaced`,
      literal: `"templateId": "${json.templateId}"`,
    });
    const rows = Array.isArray(json.rows) ? json.rows : [];
    for (const [i, row] of rows.entries()) {
      if (typeof row === 'string' && /[.#]/.test(row) && row.length >= 16 && !/^#+$/.test(row))
        sentinels.push({ id: `map:${name}:row${i}`, literal: row });
    }
  }
  const fallback = read('server/content/placements/master-v1-fallback.json');
  if (fallback) {
    const json = JSON.parse(fallback);
    if (typeof json.templateHash === 'string')
      sentinels.push({ id: 'fallback:templateHash', literal: json.templateHash });
    for (const f of json.fallbacks ?? []) {
      if (typeof f.variantId === 'string' && f.layout)
        sentinels.push({
          id: `fallback:${f.variantId}`,
          literal: JSON.stringify(f.layout).slice(0, 120),
        });
    }
  }
  const tuning = read('server/config/tuning/mvp-v1.json');
  if (tuning) {
    const json = JSON.parse(tuning);
    sentinels.push({ id: 'tuning:version', literal: `"tuningVersion":"${json.tuningVersion}"` });
    sentinels.push({
      id: 'tuning:version-spaced',
      literal: `"tuningVersion": "${json.tuningVersion}"`,
    });
  }
  // Operator and Cloud secrets are configuration names the browser has no business knowing.
  for (const name of ['LIVEKIT_API_SECRET', 'OPS_TOKEN', 'LIVEKIT_API_KEY'])
    sentinels.push({ id: `secret-name:${name}`, literal: name });
  return sentinels;
}

/** Recursively lists scannable files under `directory`. */
export function listBundleFiles(directory) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(path);
    }
  };
  walk(directory);
  return out.sort();
}

/**
 * Scans every text file of the bundle for every sentinel. Returns findings with the relative
 * file, the sentinel id and the 1-based line, never the matched content.
 */
export function scanBundle(directory, sentinels) {
  const findings = [];
  const files = listBundleFiles(directory);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const sentinel of sentinels) {
      // Source maps and inlined JSON carry the same bytes with escaped quotes; both forms count.
      const escaped = JSON.stringify(sentinel.literal).slice(1, -1);
      const index = Math.max(
        text.indexOf(sentinel.literal),
        escaped === sentinel.literal ? -1 : text.indexOf(escaped),
      );
      if (index < 0) continue;
      const line = text.slice(0, index).split('\n').length;
      findings.push({
        file: relative(directory, file).replace(/\\/g, '/'),
        sentinel: sentinel.id,
        line,
      });
    }
  }
  return { files: files.map((f) => relative(directory, f).replace(/\\/g, '/')), findings };
}

if (basename(process.argv[1] ?? '') === 'inspect-public-bundle.mjs') {
  const args = process.argv.slice(2);
  const opt = { directory: null, evidence: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--directory') opt.directory = args[++i];
    else if (args[i] === '--evidence') opt.evidence = args[++i];
    else {
      console.error(`unknown argument ${args[i]}`);
      process.exit(2);
    }
  }
  if (!opt.directory) {
    console.error(
      'usage: node scripts/inspect-public-bundle.mjs --directory apps/web/dist [--evidence <dir>]',
    );
    process.exit(2);
  }
  const directory = resolve(opt.directory);
  if (!existsSync(directory)) {
    console.error(`BLOCKED: bundle directory not found ${directory} (run pnpm build first)`);
    process.exit(3);
  }
  const sentinels = deriveSentinels(root);
  const { files, findings } = scanBundle(directory, sentinels);
  const report = {
    generatedAt: new Date().toISOString(),
    directory: relative(root, directory).replace(/\\/g, '/'),
    filesScanned: files.length,
    sentinels: sentinels.length,
    findings,
    verdict: findings.length === 0 ? 'PASS' : 'FAIL',
  };
  if (opt.evidence) {
    mkdirSync(resolve(opt.evidence), { recursive: true });
    writeFileSync(
      resolve(opt.evidence, 'public-bundle.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  for (const f of findings) console.log(`LEAK  ${f.file}:${f.line}  ${f.sentinel}`);
  console.log(
    `inspect-public-bundle: ${report.verdict} files=${files.length} sentinels=${sentinels.length} findings=${findings.length}`,
  );
  process.exit(findings.length === 0 ? 0 : 1);
}

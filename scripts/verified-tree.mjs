#!/usr/bin/env node
// Owned by F (F-04 / DP-04). Remembers which source trees `scripts/ci-verify.mjs` has already
// verified so a develop merge whose tree is identical to a verified MR head can skip the
// 7-8 minute Verify stage. The key is the git *tree* hash, not the commit: a GitLab merge
// commit has a new commit id but the same tree when nothing else landed in between. Any
// other tree (a real merge of two changes) still verifies in full.
//
//   node scripts/verified-tree.mjs record --state-dir /opt/kkakkung --tree <tree> --commit <sha> --build "kkakkung-mr#131"
//   node scripts/verified-tree.mjs check  --state-dir /opt/kkakkung --tree <tree>   # prints the recorder or nothing
//
// Markers live in <state-dir>/verified-trees/<tree>.json; the newest 200 are kept.
//
// S15P21C204-368. MR and deploy builds no longer run the same checks (scripts/ci-plan.mjs), so
// a marker only vouches for its own scope: `--scope mr` (default, the directory above) or
// `--scope deploy` (<state-dir>/verified-trees-deploy). A tree an MR verified still gets the
// deploy checks, which are the ones MR builds leave out.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERIFIED_TREES_DIR = 'verified-trees';
export const MAX_MARKERS = 200;
export const SCOPES = Object.freeze({ mr: VERIFIED_TREES_DIR, deploy: 'verified-trees-deploy' });
const TREE = /^[0-9a-f]{40}$/;

function markerDir(stateDir, scope = 'mr') {
  const dir = SCOPES[scope];
  if (!dir) throw new Error(`unknown scope: ${scope}`);
  return resolve(stateDir, dir);
}

/** Writes the marker for a verified tree and prunes old ones. Returns the marker path. */
export function recordVerifiedTree(input) {
  if (!TREE.test(input.tree)) throw new Error('tree must be a 40-hex git tree hash');
  const dir = markerDir(input.stateDir, input.scope);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${input.tree}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        tree: input.tree,
        commit: input.commit,
        build: input.build,
        verifiedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, mtime: statSync(resolve(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of entries.slice(MAX_MARKERS)) unlinkSync(resolve(dir, stale.name));
  return path;
}

/** Returns the recorded marker for a tree, or null. Malformed markers count as absent. */
export function findVerifiedTree(stateDir, tree, scope = 'mr') {
  if (!TREE.test(tree)) return null;
  const path = resolve(markerDir(stateDir, scope), `${tree}.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (
      parsed?.tree !== tree ||
      typeof parsed.build !== 'string' ||
      typeof parsed.commit !== 'string'
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i] ?? '';
    else out.command = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = args.scope ?? 'mr';
  if (
    !args['state-dir'] ||
    !args.tree ||
    !['record', 'check'].includes(args.command) ||
    !(scope in SCOPES)
  ) {
    console.error(
      'usage: verified-tree.mjs record|check --state-dir <dir> --tree <tree> [--scope mr|deploy] [--commit <sha> --build <label>]',
    );
    process.exitCode = 2;
    return;
  }
  if (args.command === 'record') {
    if (!args.commit || !args.build) {
      console.error('record needs --commit and --build');
      process.exitCode = 2;
      return;
    }
    const path = recordVerifiedTree({
      stateDir: args['state-dir'],
      tree: args.tree,
      commit: args.commit,
      build: args.build,
      scope,
    });
    console.error(`verified-tree: recorded ${args.tree.slice(0, 12)} → ${path}`);
    return;
  }
  const found = findVerifiedTree(args['state-dir'], args.tree, scope);
  // stdout carries only the recorder label so the Jenkinsfile can capture it into a variable.
  if (found)
    console.log(`${found.build} (${String(found.commit).slice(0, 8)}, ${found.verifiedAt})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

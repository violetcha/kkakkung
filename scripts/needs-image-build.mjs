#!/usr/bin/env node
// S15P21C204-322. Whether this build has to produce release images.
//
// A deploy build always does: the Deploy stage runs the images it names. An MR build does not —
// it skips Deploy, and `build-release-images.mjs` tags by commit SHA, so the merge commit that
// actually deploys never reuses an MR's image. Those two builds (3~6 minutes each, inside the
// host lock every other job queues behind) were thrown away every time.
//
// What an MR build still has to catch is a change that breaks the image build itself. `pnpm
// verify` already compiles every workspace project, so a source-level break fails there. What it
// cannot see is the Dockerfiles, the files they COPY, and the install they run inside the
// container. When this build touches one of those, the images are built.
//
//   node scripts/needs-image-build.mjs --deploy true|false --base origin/develop
//
// Prints `true` or `false`. An unknown base (missing ref, shallow clone, git failure) prints
// `true`: not knowing what changed is never a reason to skip the check.

import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Exact repository-root paths the two Dockerfiles read. */
export const IMAGE_INPUT_FILES = Object.freeze([
  '.npmrc',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.packages.json',
]);
/** Directories whose contents are copied into an image. */
export const IMAGE_INPUT_DIRS = Object.freeze(['infra/docker/', 'infra/nginx/']);

/**
 * Every `package.json` counts: the build stage copies each workspace manifest before installing,
 * so a changed dependency or build script changes what the image installs and runs.
 */
export function touchesImageInputs(files) {
  return files.some(
    (file) =>
      IMAGE_INPUT_FILES.includes(file) ||
      IMAGE_INPUT_DIRS.some((dir) => file.startsWith(dir)) ||
      basename(file) === 'package.json',
  );
}

export function needsImageBuild({ deploy, changedFiles }) {
  if (deploy) return true;
  // null means "could not be determined", which is not the same as "nothing changed".
  if (changedFiles === null) return true;
  return touchesImageInputs(changedFiles);
}

/** Files this branch changes relative to `base`, or null when the comparison is not possible. */
export function changedFilesAgainst(base, run = gitRun) {
  if (!base) return null;
  if (run(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) === null) return null;
  const merged = run(['merge-base', base, 'HEAD']);
  if (merged === null) return null;
  const listed = run(['diff', '--name-only', `${merged}`, 'HEAD']);
  if (listed === null) return null;
  return listed.split('\n').filter((line) => line !== '');
}

function gitRun(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function main(argv) {
  let deploy = false;
  let base = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--deploy') deploy = argv[++i] === 'true';
    else if (argv[i] === '--base') base = argv[++i] ?? '';
  }
  const changedFiles = deploy ? [] : changedFilesAgainst(base);
  process.stdout.write(needsImageBuild({ deploy, changedFiles }) ? 'true' : 'false');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));

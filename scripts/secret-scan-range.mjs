#!/usr/bin/env node
// S15P21C204-322. The commit range gitleaks has to read on this build.
//
// `gitleaks detect` without `--log-opts` walks every blob in the history. That cost grows with
// the repository and is paid again on every build, while the commits before this branch were
// already scanned by the builds that introduced them. This prints the range for the commits this
// build actually adds.
//
//   node scripts/secret-scan-range.mjs origin/develop [more-bases...]
//
// Prints `<base>..HEAD` for the first base that resolves to a commit and is an ancestor of HEAD,
// or nothing. **Nothing means scan the whole history**, which is what a first build, a shallow
// clone, a rewritten branch or a pruned last-good tag gets. Narrowing is an optimisation; being
// unable to narrow never turns into skipping the scan.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The first usable base, or null. `run` returns trimmed stdout, or null on a nonzero exit.
 *
 * `base..HEAD` is git log's own range: every commit reachable from HEAD but not from base. The
 * base does **not** have to be an ancestor, which matters because `origin/develop` has almost
 * always moved on since a branch was cut. Requiring ancestry here sent every MR that was not
 * freshly rebased down the full-history path, so the only thing left to check is that the range
 * holds at least one commit — an empty range would scan nothing at all.
 */
export function scanRange(bases, run = gitRun) {
  for (const base of bases) {
    const candidate = String(base ?? '').trim();
    // Only a plain ref or SHA. This value reaches a shell argument and a git revision.
    if (!/^[A-Za-z0-9._/-]{1,255}$/.test(candidate)) continue;
    if (run(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]) === null) continue;
    const count = run(['rev-list', '--count', `${candidate}..HEAD`]);
    if (count === null || !/^[1-9]\d*$/.test(count)) continue;
    return `${candidate}..HEAD`;
  }
  return null;
}

function gitRun(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.stdout.write(scanRange(process.argv.slice(2)) ?? '');

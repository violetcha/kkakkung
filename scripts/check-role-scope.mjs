import { execFileSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOwner } from './lib/execution-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (
  ![4, 5].includes(args.length) ||
  args[0] !== '--role' ||
  !/^[A-F]$/.test(args[1]) ||
  args[2] !== '--base' ||
  !args[3] ||
  args[3].startsWith('-') ||
  (args.length === 5 && args[4] !== '--contract-sync')
)
  throw new Error(
    'Usage: node scripts/check-role-scope.mjs --role A --base <recorded-start-SHA> [--contract-sync]',
  );
const role = args[1];
const contractSync = args.length === 5;
if (contractSync && !['B', 'F'].includes(role))
  throw new Error('--contract-sync is reserved for contract owner B and synchronization owner F.');
const git = (...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
  });
const base = git('rev-parse', '--verify', args[3] + '^{commit}').trim();
const split = (text) => text.split('\0').filter(Boolean);
const changed = (...args) =>
  new Set(split(git('diff', '--no-renames', '--name-only', '-z', ...args, '--')));
// Inspect each changed Git version. An unchanged old index is not a staged edit.
// --no-renames preserves the removed source path as well as the new target.
const versions = [
  { name: 'committed', paths: changed(base, 'HEAD'), ref: 'HEAD', rawArgs: [base, 'HEAD'] },
  { name: 'staged', paths: changed('--cached'), ref: '', rawArgs: ['--cached', base] },
  { name: 'working', paths: changed(), ref: null, rawArgs: [base] },
];
const untracked = new Set(split(git('ls-files', '--others', '--exclude-standard', '-z')));
const paths = [
  ...new Set([...versions.flatMap((version) => [...version.paths]), ...untracked]),
].sort();
const registry = JSON.parse(await readFile(resolve(root, 'docs/execution/ownership.json'), 'utf8'));
const roleDocuments = new Set(
  Object.values(registry.roles).map(({ document }) => `docs/execution/${document}`),
);
const commonPath = 'docs/execution/common.md';
const begin = '<!-- BEGIN EXEC-CONTRACT-3 COMMON -->';
const end = '<!-- END EXEC-CONTRACT-3 COMMON -->';
const normalize = (text) => text.replaceAll('\r\n', '\n');
const commonBlock = (text) => {
  if (text === null) return null;
  text = normalize(text);
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (
    start < 0 ||
    finish < start + begin.length ||
    text.indexOf(begin, start + 1) >= 0 ||
    text.indexOf(end, finish + 1) >= 0
  )
    return null;
  return {
    before: text.slice(0, start),
    after: text.slice(finish + end.length),
    body: text.slice(start + begin.length, finish).trim(),
  };
};
const content = async (path, ref) => {
  try {
    if (ref === null) {
      if (!(await lstat(resolve(root, path))).isFile()) return null;
      return await readFile(resolve(root, path), 'utf8');
    }
    return git('show', `${ref}:${path}`);
  } catch {
    return null; // Missing, deleted, unmerged or unreadable files never qualify.
  }
};
const commonByVersion = new Map();
const exemptions = [];
const violations = [];
for (const path of paths) {
  const owner = resolveOwner(path, registry);
  if (owner === role) continue;
  const touchedVersions = versions.filter((version) => version.paths.has(path));
  let eligible = contractSync && roleDocuments.has(path) && !untracked.has(path);
  const previous = eligible ? commonBlock(await content(path, base)) : null;
  eligible &&= previous !== null;
  const failedVersions = [];
  if (eligible) {
    for (const version of touchedVersions) {
      const current = commonBlock(await content(path, version.ref));
      if (!commonByVersion.has(version.name))
        commonByVersion.set(version.name, await content(commonPath, version.ref));
      const source = commonByVersion.get(version.name);
      // A generated-content exception never permits a deletion or file-mode change.
      const raw = git('diff', '--raw', '--no-renames', ...version.rawArgs, '--', path);
      const modeChange = raw
        .split('\n')
        .filter(Boolean)
        .some((line) => {
          const modes = /^:(\d+) (\d+) /.exec(line);
          return !modes || modes[1] !== modes[2] || !['100644', '100755'].includes(modes[1]);
        });
      if (
        !current ||
        source === null ||
        modeChange ||
        current.before !== previous.before ||
        current.after !== previous.after ||
        current.body !== normalize(source).trim()
      )
        failedVersions.push(version.name);
    }
  }
  if (eligible && touchedVersions.length > 0 && failedVersions.length === 0)
    exemptions.push({
      path,
      owner,
      versions: touchedVersions.map(({ name }) => name),
      reason: 'VERIFIED_COMMON_BLOCK_ONLY',
    });
  else violations.push({ path, owner, ...(failedVersions.length ? { failedVersions } : {}) });
}
console.log(
  JSON.stringify(
    {
      status: violations.length ? 'FAIL' : 'PASS',
      role,
      base,
      contractSync,
      checkedPaths: paths.length,
      violations,
      exemptions,
      note: 'Only --contract-sync for B/F permits verified generated COMMON-only edits to other role documents. Each changed Git version is checked against its own common source. Run check:execution for whole-plan synchronization. No write permission is granted.',
    },
    null,
    2,
  ),
);
if (violations.length) process.exitCode = 1;

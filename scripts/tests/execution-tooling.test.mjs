import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  readExecutionPlan,
  resolveOwner,
  canonicalPath,
  checkDeclaredOwnership,
} from '../lib/execution-plan.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plan = await readExecutionPlan(root);

test('every task file has exactly its declared role, including new tests and handoffs', () => {
  assert.equal(plan.tasks.length, 122);
  assert.equal(plan.tasks.filter((task) => task.pending).length, 6);
  assert.deepEqual(checkDeclaredOwnership(plan), []);
  assert.equal(resolveOwner('apps/web/public/models/pose/model.task', plan.registry), 'D');
  assert.equal(resolveOwner('apps/web/public/avatars/face.png', plan.registry), 'C');
  assert.equal(resolveOwner('server/src/domain/index.ts', plan.registry), 'A');
  assert.equal(resolveOwner('server/src/config/env.ts', plan.registry), 'F');
  assert.equal(resolveOwner('apps/web/package.json', plan.registry), 'F');
  assert.equal(resolveOwner('new-workspace/file.ts', plan.registry), null);
});

test('directory claims cannot hide a cross-role nested file', () => {
  const modified = {
    ...plan,
    tasks: [{ fixed: 'C-01', role: 'C', paths: ['apps/web/public/models/face.task'] }],
  };
  assert.match(checkDeclaredOwnership(modified).join('\n'), /belongs to D/);
  for (const path of [
    '../secret',
    '/etc/file',
    'C:/file',
    'server/../apps/file',
    'apps/web/**',
    'server/{src,test}',
  ])
    assert.throws(() => canonicalPath(path));
});

const prepare = (...args) =>
  spawnSync(process.execPath, [resolve(root, 'scripts/prepare-execution.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });

test('fixed numbers and day-relative numbers produce different explicit batches', () => {
  const fixed = prepare('--role', 'A', '--tasks', '1-5');
  const day = prepare('--role', 'A', '--day', 'D2', '--tasks', '1-5');
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.equal(day.status, 0, day.stderr);
  assert.deepEqual(
    JSON.parse(fixed.stdout).tasks.map((task) => task.fixed),
    ['A-01', 'A-02', 'A-03', 'A-04', 'A-05'],
  );
  const result = JSON.parse(day.stdout);
  assert.equal(result.tasks[0].fixed, 'A-19');
  assert.equal(result.tasks[4].fixed, 'A-23');
  assert.ok(result.outsideRequestedRange.length);
  assert.equal(result.productCompletionInferred, false);
});

test('holds are preserved and invalid or ambiguous ranges fail', () => {
  const result = prepare('--role', 'A', '--tasks', '6-7');
  assert.equal(result.status, 0, result.stderr);
  const tasks = JSON.parse(result.stdout).tasks;
  assert.equal(tasks[0].pending, true);
  assert.equal(tasks[1].fixed, 'A-07');
  for (const args of [
    ['--role', 'Z', '--tasks', '1-5'],
    ['--role', 'C', '--day', 'D1', '--tasks', '1-5'],
    ['--role', 'A', '--tasks', '5-1'],
    ['--role', 'A', '--tasks', '1-99'],
    ['--role', 'A'],
  ])
    assert.notEqual(prepare(...args).status, 0);
});

test('integration acceptance prerequisites stay separate from implementation prerequisites', () => {
  const result = prepare('--role', 'C', '--tasks', '3-3');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.tasks[0].integrationDependencies, ['B-14']);
  assert.deepEqual(output.integrationDependencies, ['B-14']);
  assert.deepEqual(output.integrationOutsideRequestedRange, ['B-14']);
  assert.ok(!output.outsideRequestedRange.includes('B-14'));
  assert.ok(output.integrationPrerequisiteHandoffs.includes('docs/execution/handoffs/B.md'));
  assert.equal(output.productCompletionInferred, false);
});

test('D3 selects real new tasks but never invents IDs for follow-up rows', () => {
  for (const [role, range, expected] of [
    ['C', '1-2', ['C-18', 'C-19']],
    ['F', '1-5', ['F-15', 'F-16', 'F-17', 'F-18', 'F-19']],
  ]) {
    const result = prepare('--role', role, '--day', 'D3', '--tasks', range);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout).tasks.map(({ fixed }) => fixed),
      expected,
    );
  }
  for (const role of ['A', 'B', 'D', 'E']) {
    const result = prepare('--role', role, '--day', 'D3', '--tasks', '1-5');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /D3 follow-up rows have no new fixed IDs/);
  }
});

async function withContractFixture(run) {
  const scratch = await mkdtemp(join(tmpdir(), 'kkakkung-contract-scope-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: scratch,
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'pipe',
    });
  const commonPath = 'docs/execution/common.md';
  const documentPath = 'docs/execution/c-web-ui.md';
  const begin = '<!-- BEGIN EXEC-CONTRACT-3 COMMON -->';
  const end = '<!-- END EXEC-CONTRACT-3 COMMON -->';
  const replaceCommon = (document, common) => {
    const start = document.indexOf(begin) + begin.length;
    const finish = document.indexOf(end);
    assert.ok(start >= begin.length && finish > start);
    return document.slice(0, start) + '\n\n' + common.trim() + '\n\n' + document.slice(finish);
  };
  try {
    await mkdir(join(scratch, 'scripts/lib'), { recursive: true });
    for (const path of ['scripts/lib/execution-plan.mjs', 'scripts/check-role-scope.mjs'])
      await cp(resolve(root, path), join(scratch, path));
    await cp(resolve(root, 'docs/execution'), join(scratch, 'docs/execution'), { recursive: true });
    const common = (await readFile(join(scratch, commonPath), 'utf8')).replaceAll('\r\n', '\n');
    const document = (await readFile(join(scratch, documentPath), 'utf8')).replaceAll('\r\n', '\n');
    // Deliberately old generated content in the baseline makes F-only synchronization testable.
    await writeFile(join(scratch, documentPath), replaceCommon(document, 'Old generated contract'));
    git('init', '--quiet');
    git('config', 'core.autocrlf', 'false');
    git('config', 'core.hooksPath', '.fixture-no-hooks');
    git('add', '.');
    const commit = () =>
      git(
        '-c',
        'user.name=Scope Fixture',
        '-c',
        'user.email=fixture@invalid.example',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      );
    commit();
    const base = git('rev-parse', 'HEAD').trim();
    const check = (role = 'B', sync = true) => {
      const before = git('status', '--porcelain', '-z');
      const result = spawnSync(
        process.execPath,
        [
          join(scratch, 'scripts/check-role-scope.mjs'),
          '--role',
          role,
          '--base',
          base,
          ...(sync ? ['--contract-sync'] : []),
        ],
        { cwd: scratch, encoding: 'utf8', windowsHide: true },
      );
      assert.equal(
        git('status', '--porcelain', '-z'),
        before,
        'scope inspection must not mutate Git state',
      );
      return result;
    };
    const syncTo = async (source) => {
      await writeFile(join(scratch, commonPath), source);
      await writeFile(join(scratch, documentPath), replaceCommon(document, source));
    };
    await run({
      scratch,
      git,
      common,
      document,
      commonPath,
      documentPath,
      replaceCommon,
      commit,
      check,
      syncTo,
    });
  } finally {
    assert.ok(
      resolve(scratch).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')),
    );
    await rm(scratch, { recursive: true, force: true });
  }
}

test('contract sync is explicit, limited to B/F, and tolerates an unchanged old index', async () => {
  await withContractFixture(async ({ common, syncTo, check, commonPath }) => {
    await syncTo(common);
    assert.equal(check('B', false).status, 1);
    assert.equal(check('C').status, 1);
    for (const role of ['B', 'F']) {
      const result = check(role);
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.exemptions.length, 1);
      assert.deepEqual(output.exemptions[0].versions, ['working']);
      assert.equal(output.exemptions[0].reason, 'VERIFIED_COMMON_BLOCK_ONLY');
    }
    await syncTo(common + '\n\nA new contract source\n');
    const result = check('F');
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).violations.some(({ path }) => path === commonPath));
  });
});

test('contract sync compares staged, committed and working copies to their own common source', async () => {
  await withContractFixture(
    async ({ common, syncTo, git, commit, check, commonPath, documentPath }) => {
      const first = common + '\n\nFirst contract update\n';
      const second = common + '\n\nSecond contract update\n';
      await syncTo(first);
      git('add', commonPath, documentPath);
      await syncTo(second);
      let result = check();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).exemptions[0].versions, ['staged', 'working']);
      commit();
      result = check();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).exemptions[0].versions, ['committed', 'working']);
    },
  );
});

test('a valid working copy cannot conceal staged content mismatches or other role edits', async () => {
  await withContractFixture(
    async ({
      scratch,
      common,
      document,
      documentPath,
      replaceCommon,
      syncTo,
      git,
      commit,
      check,
    }) => {
      await syncTo(common);
      await writeFile(
        join(scratch, documentPath),
        replaceCommon(document, 'Invalid staged contract'),
      );
      git('add', documentPath);
      await syncTo(common);
      let result = check();
      assert.equal(result.status, 1);
      assert.ok(
        JSON.parse(result.stdout).violations.some(
          ({ path, failedVersions }) => path === documentPath && failedVersions.includes('staged'),
        ),
      );
      await writeFile(
        join(scratch, documentPath),
        replaceCommon(document, common) + '\nUnauthorized role instructions\n',
      );
      git('add', documentPath);
      await syncTo(common);
      result = check();
      assert.equal(result.status, 1);
      assert.ok(
        JSON.parse(result.stdout).violations.some(
          ({ path, failedVersions }) => path === documentPath && failedVersions.includes('staged'),
        ),
      );
      commit();
      result = check();
      assert.equal(result.status, 1);
      assert.ok(
        JSON.parse(result.stdout).violations.some(
          ({ path, failedVersions }) =>
            path === documentPath && failedVersions.includes('committed'),
        ),
      );
    },
  );
});

test('contract sync rejects mismatched content, duplicate markers, role-document deletion and other paths', async () => {
  await withContractFixture(
    async ({ scratch, common, document, documentPath, replaceCommon, syncTo, check }) => {
      await syncTo(common);
      for (const bad of [
        replaceCommon(document, 'Not the current common contract'),
        replaceCommon(document, common) + '\n<!-- BEGIN EXEC-CONTRACT-3 COMMON -->\n',
      ]) {
        await writeFile(join(scratch, documentPath), bad);
        const result = check();
        assert.equal(result.status, 1);
        assert.ok(JSON.parse(result.stdout).violations.some(({ path }) => path === documentPath));
      }
      await rm(join(scratch, documentPath));
      assert.equal(check().status, 1);
      await syncTo(common);
      await mkdir(join(scratch, 'apps/web/src/app'), { recursive: true });
      await writeFile(join(scratch, 'apps/web/src/app/unowned.ts'), 'export {};\n');
      const result = check();
      assert.equal(result.status, 1);
      assert.ok(
        JSON.parse(result.stdout).violations.some(
          ({ path }) => path === 'apps/web/src/app/unowned.ts',
        ),
      );
    },
  );
});

test('scope check catches rename sources, staged changes, untracked files and committed changes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'kkakkung-role-scope-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: scratch, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  try {
    await mkdir(join(scratch, 'scripts/lib'), { recursive: true });
    await cp(
      resolve(root, 'scripts/lib/execution-plan.mjs'),
      join(scratch, 'scripts/lib/execution-plan.mjs'),
    );
    await cp(
      resolve(root, 'scripts/check-role-scope.mjs'),
      join(scratch, 'scripts/check-role-scope.mjs'),
    );
    await cp(resolve(root, 'docs/execution'), join(scratch, 'docs/execution'), { recursive: true });
    await mkdir(join(scratch, 'apps/web/src/app'), { recursive: true });
    await writeFile(join(scratch, 'apps/web/src/app/example.ts'), 'export {};\n');
    git('init', '--quiet');
    git('config', 'core.autocrlf', 'false');
    git('config', 'core.hooksPath', '.fixture-no-hooks');
    git('add', '.');
    git(
      '-c',
      'user.name=Scope Fixture',
      '-c',
      'user.email=fixture@invalid.example',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    );
    const base = git('rev-parse', 'HEAD').trim();
    const check = () =>
      spawnSync(
        process.execPath,
        [join(scratch, 'scripts/check-role-scope.mjs'), '--role', 'D', '--base', base],
        { cwd: scratch, encoding: 'utf8', windowsHide: true },
      );
    assert.equal(check().status, 0);
    await mkdir(join(scratch, 'apps/web/src/features/input'), { recursive: true });
    git('mv', 'apps/web/src/app/example.ts', 'apps/web/src/features/input/example.ts');
    let result = check();
    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      JSON.parse(result.stdout).violations.some(
        (entry) => entry.path === 'apps/web/src/app/example.ts',
      ),
    );
    git(
      '-c',
      'user.name=Scope Fixture',
      '-c',
      'user.email=fixture@invalid.example',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'rename',
    );
    assert.equal(check().status, 1);
    await writeFile(join(scratch, 'unknown.ts'), 'export {};\n');
    result = check();
    assert.ok(
      JSON.parse(result.stdout).violations.some(
        (entry) => entry.path === 'unknown.ts' && entry.owner === null,
      ),
    );
  } finally {
    // mkdtemp returned this absolute path beneath the OS temporary directory.
    assert.ok(
      resolve(scratch).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')),
    );
    await rm(scratch, { recursive: true, force: true });
  }
});

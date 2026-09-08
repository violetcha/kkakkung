import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as prettier from 'prettier';
import { parsers } from 'prettier/plugins/markdown';

const root = fileURLToPath(new URL('../', import.meta.url));
const execution = resolve(root, 'docs/execution');
const sync = process.argv.includes('--sync');
if (process.argv.slice(2).some((arg) => arg !== '--sync'))
  throw new Error('Usage: node scripts/check-execution-plan.mjs [--sync]');
const version = 'EXEC-CONTRACT-2';
const scope = 'D-2026-09-08-01';
const deferred = new Set(['MP-06', 'EQ-06', 'EQ-07', 'EQ-08', 'EQ-09', 'EQ-12']);
const expectedRoles = { A: 33, B: 18, C: 19, D: 17, E: 16, F: 19 };
const errors = [];
const fail = (text) => errors.push(text);
const normalize = (text) => text.replace(/\r\n/g, '\n').trim();
const files = (await readdir(execution)).filter((file) => /^[a-f]-.*\.md$/.test(file)).sort();
const typesPath = resolve(execution, 'contracts/types.ts');
const commonPath = resolve(execution, 'common.md');
const prettierOptions = (await prettier.resolveConfig(commonPath)) ?? {};
const types = await readFile(typesPath, 'utf8');
const rawCommon = await readFile(commonPath, 'utf8');
const typesBlock =
  '<!-- BEGIN CONTRACT-TYPES -->\n\n```ts\n' +
  types.trim() +
  '\n```\n\n<!-- END CONTRACT-TYPES -->';
const desiredCommon = await prettier.format(
  rawCommon.replace(
    /<!-- BEGIN CONTRACT-TYPES -->[\s\S]*?<!-- END CONTRACT-TYPES -->/,
    () => typesBlock,
  ),
  { ...prettierOptions, parser: 'markdown' },
);
if (!rawCommon.includes('<!-- BEGIN CONTRACT-TYPES -->'))
  fail('common.md: missing type source markers');
if (sync) await writeFile(commonPath, desiredCommon, 'utf8');
else if (normalize(rawCommon) !== normalize(desiredCommon))
  fail('common.md: type source changed; run --sync');
if (!types.includes(version) || !types.includes(scope)) fail('types.ts: version or scope differs');

const expectedCommon = normalize(desiredCommon);
const tasks = [];
const owners = new Map();
const stats = { tasks: 0, active: 0, decisionPending: 0, steps: 0, cases: 0 };
const contents = new Map();
for (const file of files) {
  const path = resolve(execution, file);
  let text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  const marker =
    /<!-- BEGIN EXEC-CONTRACT-[12] COMMON -->[\s\S]*?<!-- END EXEC-CONTRACT-[12] COMMON -->/;
  const block =
    '<!-- BEGIN EXEC-CONTRACT-2 COMMON -->\n\n' +
    desiredCommon.trim() +
    '\n\n<!-- END EXEC-CONTRACT-2 COMMON -->';
  if (!marker.test(text)) {
    fail(file + ': missing common markers');
    continue;
  }
  if (sync) {
    text = text.replaceAll('EXEC-CONTRACT-1', version).replace(marker, () => block);
    text = await prettier.format(text, { ...prettierOptions, parser: 'markdown' });
    await writeFile(path, text, 'utf8');
  }
  contents.set(file, text);
  const common = text.match(
    /<!-- BEGIN EXEC-CONTRACT-2 COMMON -->\s*([\s\S]*?)\s*<!-- END EXEC-CONTRACT-2 COMMON -->/,
  );
  if (!common || normalize(common[1]) !== expectedCommon) fail(file + ': common block differs');
  const owner = file[0].toUpperCase();
  const chunks = [
    ...text.matchAll(/^### ([A-F]-\d{2})\n([\s\S]*?)(?=^### [A-F]-\d{2}\n|$(?![\s\S]))/gm),
  ];
  if (chunks.length !== expectedRoles[owner])
    fail(file + ': unexpected task count ' + chunks.length);
  for (const [, fixed, body] of chunks) {
    const id = body.match(/^\*\*([A-Z]{2}-\d{2}) ·/m)?.[1];
    if (!id) {
      fail(fixed + ': missing original ID');
      continue;
    }
    const pending = body.includes('실행 상태: **PRODUCT_DECISION_PENDING**');
    const day = body.match(/(?:일정|기존 일정 식별): (D[123])/m)?.[1];
    const today = Number(body.match(/오늘 (\d+)번/)?.[1]);
    const depLine = body.match(/^선행 완료 결과: (.*)$/m)?.[1] ?? '';
    const deps = [...depLine.matchAll(/\]\([^#)]*#([a-f]-\d{2})\)/g)].map((m) =>
      m[1].toUpperCase(),
    );
    tasks.push({ id, fixed, owner, day, today, pending, deps });
    stats.tasks++;
    if (pending) {
      stats.decisionPending++;
      if (!deferred.has(id)) fail(fixed + ': unexpected decision-pending task');
      if (/\*\*실행할 검사\*\*|\*\*작업 완료 커밋 제목\*\*|pnpm exec|git commit/.test(body))
        fail(fixed + ': deferred task contains execution instructions');
      continue;
    }
    stats.active++;
    if (deferred.has(id)) fail(fixed + ': undecided item task is executable');
    for (const heading of [
      '수정·생성 파일',
      '구현 순서',
      '연결 계약과 경계',
      '시험 입력 → 기대 결과',
      '추가·보완할 시험 파일',
      '실행할 검사',
      '완료 조건',
      '작업 완료 커밋 제목',
      'MR 본문에 채울 변경 사항',
      'MR 리뷰 포인트',
      '완료 인계',
    ]) {
      if (!body.includes('**' + heading + '**')) fail(fixed + ': missing ' + heading);
    }
    if (
      /\bUSE_ITEM\b|\bdecoyOffset\b|\bItemKind\b|\bitemInstanceId\b|\bmediaGeneration\b/.test(body)
    )
      fail(fixed + ': active task has a retired contract identifier');
    const stepBlock = body.split('**구현 순서**')[1]?.split('**연결 계약과 경계**')[0] ?? '';
    const caseBlock =
      body.split('**시험 입력 → 기대 결과**')[1]?.split('**추가·보완할 시험 파일**')[0] ?? '';
    stats.steps += (stepBlock.match(/^\d+\. /gm) ?? []).length;
    stats.cases += (caseBlock.match(/^- /gm) ?? []).length;
    if (
      (stepBlock.match(/^\d+\. /gm) ?? []).length < 3 ||
      (caseBlock.match(/^- /gm) ?? []).length < 3
    )
      fail(fixed + ': insufficient actionable steps or cases');
    const commit = body.match(/\*\*작업 완료 커밋 제목\*\*[\s\S]*?```text\n([^\n]+)/)?.[1];
    if (!/^(feat|fix|refactor|docs|chore|ci|test|design): .+/.test(commit ?? ''))
      fail(fixed + ': invalid commit title');
    const blocks = [
      body.split('**수정·생성 파일**')[1]?.split('**구현 순서**')[0] ?? '',
      body.split('**추가·보완할 시험 파일**')[1]?.split('**실행할 검사**')[0] ?? '',
    ];
    for (const blockText of blocks)
      for (const match of blockText.matchAll(/^- `([^`]+)`/gm)) {
        const p = match[1];
        if (owners.has(p) && owners.get(p) !== owner)
          fail(p + ': conflicting owners ' + owners.get(p) + '/' + owner);
        owners.set(p, owner);
      }
  }
}

const original = await readFile(resolve(root, 'docs/mvp-work-plan.md'), 'utf8');
const originalIds = [...original.matchAll(/^\|\s*([A-Z]{2}-\d{2})\s*\|/gm)].map((m) => m[1]);
const ids = new Set(tasks.map((t) => t.id));
if (originalIds.length !== 122 || tasks.length !== 122 || ids.size !== 122)
  fail('Original/execution task IDs are not exactly 122 unique IDs');
for (const id of originalIds) if (!ids.has(id)) fail('Missing original ID ' + id);
for (const id of ids) if (!originalIds.includes(id)) fail('Unexpected new ID ' + id);
if (stats.decisionPending !== 6 || stats.active !== 116)
  fail('Expected 116 active tasks plus 6 product decision holds');

const byFixed = new Map(tasks.map((t) => [t.fixed, t]));
const visiting = new Set();
const visited = new Set();
function visit(id) {
  if (visiting.has(id)) {
    fail('Dependency cycle at ' + id);
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  const task = byFixed.get(id);
  for (const dep of task.deps) {
    const predecessor = byFixed.get(dep);
    if (!predecessor) {
      fail(id + ': missing prerequisite ' + dep);
      continue;
    }
    if (!task.pending && predecessor.pending)
      fail(id + ': active task waits for undecided item ' + dep);
    if (predecessor.day > task.day) fail(id + ': prerequisite is scheduled on a later day: ' + dep);
    if (predecessor.owner === task.owner && predecessor.fixed > task.fixed)
      fail(id + ': same owner prerequisite is later: ' + dep);
    visit(dep);
  }
  visiting.delete(id);
  visited.add(id);
}
for (const task of tasks) visit(task.fixed);
for (const owner of Object.keys(expectedRoles))
  for (const day of ['D1', 'D2', 'D3']) {
    const sameDay = tasks.filter((t) => t.owner === owner && t.day === day);
    if (sameDay.some((t, i) => t.today !== i + 1))
      fail(owner + '/' + day + ': today numbering is not sequential');
  }

for (const extra of [
  'common.md',
  'README.md',
  '../mvp-work-plan.md',
  '../spec/README.md',
  '../spec/decisions.md',
]) {
  const p = resolve(execution, extra);
  contents.set(extra, await readFile(p, 'utf8'));
}
for (const [file, text] of contents) {
  const ast = parsers.markdown.parse(text);
  const links = [];
  function scan(node) {
    if (node.type === 'table') {
      const width = node.children[0].children.length;
      for (const row of node.children.slice(1))
        if (row.children.length !== width)
          fail(
            file +
              ':' +
              row.position.start.line +
              ': broken Markdown table (' +
              row.children.length +
              ' cells, expected ' +
              width +
              ')',
          );
    }
    if (node.type === 'link' && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(node.url)) links.push(node.url);
    if (node.type === 'code' && ['ts', 'typescript'].includes(node.lang)) {
      const parsed = ts.createSourceFile(
        'example.ts',
        node.value,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      for (const diagnostic of parsed.parseDiagnostics ?? [])
        fail(
          file +
            ':' +
            node.position.start.line +
            ': invalid TypeScript example: ' +
            ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        );
    }
    for (const child of node.children ?? []) scan(child);
  }
  scan(ast);
  for (const link of links) {
    const [targetName, anchor] = link.split('#');
    const target = resolve(dirname(resolve(execution, file)), decodeURIComponent(targetName));
    try {
      await access(target);
    } catch {
      fail(file + ': broken link ' + link);
      continue;
    }
    if (anchor && /^[a-f]-\d{2}$/.test(anchor)) {
      const targetText = await readFile(target, 'utf8');
      if (!new RegExp('^### ' + anchor.toUpperCase() + '$', 'm').test(targetText))
        fail(file + ': broken task anchor ' + link);
    }
  }
}

const configPath = resolve(execution, 'contracts/tsconfig.json');
const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
if (configRead.error) fail(ts.flattenDiagnosticMessageText(configRead.error.messageText, '\n'));
else {
  const config = ts.parseJsonConfigFileContent(configRead.config, ts.sys, dirname(configPath));
  const program = ts.createProgram(config.fileNames, config.options);
  for (const diagnostic of [...config.errors, ...ts.getPreEmitDiagnostics(program)]) {
    const where =
      diagnostic.file && diagnostic.start !== undefined
        ? relative(root, diagnostic.file.fileName) +
          ':' +
          (diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1) +
          ': '
        : '';
    fail(where + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }
}
const fixtureRun = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=tap', resolve(execution, 'contracts/fixtures.test.ts')],
  { cwd: root, encoding: 'utf8', windowsHide: true },
);
if (fixtureRun.error || fixtureRun.status !== 0)
  fail(
    'Contract fixture verification failed:\n' +
      (fixtureRun.error?.message ?? '') +
      fixtureRun.stdout +
      fixtureRun.stderr,
  );
const fixtureChecks = Number(fixtureRun.stdout?.match(/^# tests (\d+)\s*$/m)?.[1] ?? 0);
if (fixtureChecks === 0) fail('Contract fixture run did not report any tests');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  const hash = createHash('sha256').update(expectedCommon).digest('hex');
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        contractVersion: version,
        scopeVersion: scope,
        ...stats,
        ownedPaths: owners.size,
        commonHash: hash,
        fixtureChecks,
        productIntegrationTested: false,
      },
      null,
      2,
    ),
  );
}

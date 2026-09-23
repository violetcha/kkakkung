#!/usr/bin/env node
// Owned by F (F-04 / DP-04). Single CI entry point: fixed toolchain check → expected commit
// check → frozen install → Chromium present → checks. The exit code of the first failing step is
// returned unchanged. No Cloud or paid test is started here.
//
// Without CI_VERIFY_MODE the checks are `pnpm verify`, exactly once (the full local suite).
// With CI_VERIFY_MODE=mr|deploy the checks are the plan from scripts/ci-plan.mjs: an MR runs what
// its changed files can break, a deploy runs the heavy integration tests (S15P21C204-368).
//
//   EXPECTED_SOURCE_SHA=<sha> CI_VERIFY_MODE=mr node scripts/ci-verify.mjs
//   CI_VERIFY_DRY_RUN=1 node scripts/ci-verify.mjs   # print the plan, run nothing

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { changedPaths, planChecks } from './ci-plan.mjs';
import { runTool, runToolCollected } from './lib/run-tool.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const REQUIRED = Object.freeze({ node: '24.19.0', pnpm: '11.19.0' });
const dryRun = process.env.CI_VERIFY_DRY_RUN === '1';
const pnpm = 'pnpm';
const mode = process.env.CI_VERIFY_MODE ?? '';

/** Ordered plan without CI_VERIFY_MODE. `pnpm verify` appears once; nothing repeats its checks. */
export const PLAN = Object.freeze([
  { id: 'toolchain', description: 'Node 24.19.0 / pnpm 11.19.0 확인' },
  { id: 'source-sha', description: 'EXPECTED_SOURCE_SHA 와 git rev-parse HEAD 대조 (설정 시)' },
  { id: 'install', command: [pnpm, 'install', '--frozen-lockfile'] },
  // CI 이미지(Dockerfile.ci)에는 Chromium 이 PLAYWRIGHT_BROWSERS_PATH 에 이미 있어 설치를 건너뜁니다.
  { id: 'chromium', command: [pnpm, 'exec', 'playwright', 'install', 'chromium'] },
  { id: 'verify', command: [pnpm, 'verify'] },
]);

function fail(step, message, code = 1) {
  console.error(`ci-verify: ${step} FAILED: ${message}`);
  process.exit(code);
}

function run(step, command, env = process.env) {
  console.log(`ci-verify: ${step}: ${command.join(' ')}`);
  if (dryRun) return;
  const r = runTool(command[0], command.slice(1), { cwd: root, stdio: 'inherit', env });
  if (r.error) fail(step, r.error.message, 127);
  if (r.status !== 0) fail(step, `exit ${r.status}`, r.status ?? 1);
}

/** One plan step: a single command streams live, several run at once and print in turn. */
async function runStep(step) {
  const env = { ...process.env, ...(step.env ?? {}) };
  const label = `${step.id}${step.env ? ` (${Object.keys(step.env).join(', ')})` : ''}`;
  if (step.commands.length === 1) return run(label, step.commands[0], env);
  for (const command of step.commands) console.log(`ci-verify: ${label}: ${command.join(' ')}`);
  if (dryRun) return;
  const results = await Promise.all(
    step.commands.map((command) =>
      runToolCollected(command[0], command.slice(1), { cwd: root, env }),
    ),
  );
  results.forEach((result, i) => {
    console.log(`ci-verify: ${label}: ${step.commands[i].join(' ')} → exit ${result.status}`);
    process.stdout.write(result.output);
  });
  const failed = results.find((result) => result.status !== 0);
  if (failed) fail(label, `exit ${failed.status}`, failed.status);
}

function gitRun(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

export function chromiumPresent(browsersPath) {
  if (!browsersPath || !existsSync(browsersPath)) return false;
  return readdirSync(browsersPath).some((d) => /^chromium/.test(d));
}

export function checkToolchain(nodeVersion, pnpmVersion) {
  const problems = [];
  if (nodeVersion !== REQUIRED.node) problems.push(`node ${nodeVersion} (필요 ${REQUIRED.node})`);
  if (pnpmVersion !== REQUIRED.pnpm)
    problems.push(`pnpm ${pnpmVersion ?? '없음'} (필요 ${REQUIRED.pnpm})`);
  return problems;
}

export function checkSourceSha(expected, head) {
  if (!expected) return null;
  if (!/^[0-9a-f]{7,40}$/i.test(expected)) return `EXPECTED_SOURCE_SHA 형식 오류`;
  if (!head) return 'git rev-parse HEAD 실패';
  if (!head.toLowerCase().startsWith(expected.toLowerCase()))
    return `체크아웃 ${head.slice(0, 12)} 이 검증 대상 ${expected.slice(0, 12)} 과 다릅니다`;
  return null;
}

async function main() {
  // 1. toolchain (never skipped, even in dry run)
  const pnpmVersion = (() => {
    const r = runTool(pnpm, ['--version'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  })();
  const problems = checkToolchain(process.versions.node, pnpmVersion);
  console.log(`ci-verify: toolchain: node ${process.versions.node}, pnpm ${pnpmVersion ?? '없음'}`);
  if (problems.length) fail('toolchain', problems.join(', '), 2);

  // 2. source sha — before any install; never fall back to another commit
  const expected = process.env.EXPECTED_SOURCE_SHA ?? '';
  const headResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const head = headResult.status === 0 ? headResult.stdout.trim() : null;
  const shaProblem = checkSourceSha(expected, head);
  console.log(
    `ci-verify: source-sha: head ${head ?? '?'}${expected ? `, expected ${expected}` : ' (EXPECTED_SOURCE_SHA 없음, 대조 생략)'}`,
  );
  if (shaProblem) fail('source-sha', shaProblem, 3);

  if (mode && !['mr', 'deploy'].includes(mode))
    fail('mode', `알 수 없는 CI_VERIFY_MODE: ${mode}`, 2);

  // 3-5. install → chromium → checks
  for (const step of PLAN) {
    if (!step.command) continue;
    if (step.id === 'verify' && mode) break;
    if (step.id === 'chromium' && chromiumPresent(process.env.PLAYWRIGHT_BROWSERS_PATH)) {
      console.log(
        `ci-verify: chromium: 이미 설치됨 (${process.env.PLAYWRIGHT_BROWSERS_PATH}), 설치 생략`,
      );
      continue;
    }
    run(step.id, step.command);
  }
  if (mode) {
    // MR 빌드의 작업 공간은 develop 과 합친 상태다. 그 상태와 develop 의 차이가 곧 이 MR 이다.
    const changed =
      mode === 'mr' ? changedPaths(process.env.CI_VERIFY_BASE ?? 'origin/develop', gitRun) : null;
    console.log(
      `ci-verify: plan: mode ${mode}${mode === 'mr' ? `, changed ${changed === null ? '알 수 없음 (전부 검사)' : `${changed.length}개`}` : ''}`,
    );
    for (const step of planChecks({ mode, changed })) await runStep(step);
  }
  console.log(dryRun ? 'ci-verify: DRY_RUN 완료' : 'ci-verify: 완료');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

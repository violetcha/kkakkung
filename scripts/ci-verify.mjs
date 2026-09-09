#!/usr/bin/env node
// Owned by F (F-04 / DP-04). Single CI entry point: fixed toolchain check → expected commit
// check → frozen install → Chromium present → `pnpm verify` exactly once. The exit code of the
// first failing step is returned unchanged. No Cloud or paid test is started here.
//
//   EXPECTED_SOURCE_SHA=<sha> node scripts/ci-verify.mjs
//   CI_VERIFY_DRY_RUN=1 node scripts/ci-verify.mjs   # print the plan, run nothing

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { runTool } from './lib/run-tool.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const REQUIRED = Object.freeze({ node: '24.19.0', pnpm: '11.19.0' });
const dryRun = process.env.CI_VERIFY_DRY_RUN === '1';
const pnpm = 'pnpm';

/** Ordered plan. `pnpm verify` appears exactly once; nothing repeats its checks. */
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

function run(step, command) {
  console.log(`ci-verify: ${step}: ${command.join(' ')}`);
  if (dryRun) return;
  const r = runTool(command[0], command.slice(1), { cwd: root, stdio: 'inherit' });
  if (r.error) fail(step, r.error.message, 127);
  if (r.status !== 0) fail(step, `exit ${r.status}`, r.status ?? 1);
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

function main() {
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

  // 3-5. install → chromium → verify (exactly once)
  for (const step of PLAN) {
    if (!step.command) continue;
    if (step.id === 'chromium' && chromiumPresent(process.env.PLAYWRIGHT_BROWSERS_PATH)) {
      console.log(
        `ci-verify: chromium: 이미 설치됨 (${process.env.PLAYWRIGHT_BROWSERS_PATH}), 설치 생략`,
      );
      continue;
    }
    run(step.id, step.command);
  }
  console.log(dryRun ? 'ci-verify: DRY_RUN 완료' : 'ci-verify: 완료');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

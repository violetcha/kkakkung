// F-04 / DP-04 CI contract: the Jenkinsfile runs the single entry point, the entry point runs
// `pnpm verify` exactly once, the expected commit is checked before install, and the toolchain
// is pinned. Nothing here starts Docker, Jenkins, a browser or the network.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN, REQUIRED, checkSourceSha, checkToolchain } from '../../scripts/ci-verify.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jenkinsfile = readFileSync(resolve(root, 'Jenkinsfile'), 'utf8');
const dockerfileCi = readFileSync(resolve(root, 'infra/docker/Dockerfile.ci'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  packageManager: string;
  engines: { node: string; pnpm: string };
  scripts: Record<string, string>;
};
const runCiVerify = (env: Record<string, string>) =>
  spawnSync(process.execPath, [resolve(root, 'scripts/ci-verify.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CI_VERIFY_DRY_RUN: '1', ...env },
  });

describe('ci-verify plan', () => {
  it('runs pnpm verify exactly once and never repeats its inner checks', () => {
    const commands = PLAN.filter((s) => s.command).map(
      (s) => s.command!.slice(1).join(' ') as string,
    );
    expect(commands.filter((c) => c === 'verify')).toHaveLength(1);
    for (const inner of [
      'format:check',
      'check:execution',
      'lint',
      'typecheck',
      'test',
      'build',
      'test:e2e',
    ])
      expect(commands.some((c) => c.split(' ').includes(inner))).toBe(false);
    expect(commands[commands.length - 1]).toBe('verify');
  });
  it('orders toolchain → source-sha → install → chromium → verify', () => {
    expect(PLAN.map((s) => s.id)).toEqual([
      'toolchain',
      'source-sha',
      'install',
      'chromium',
      'verify',
    ]);
    expect(PLAN.find((s) => s.id === 'install')!.command!.slice(1)).toEqual([
      'install',
      '--frozen-lockfile',
    ]);
  });
  it('pins the toolchain to the repository versions', () => {
    expect(REQUIRED.node).toBe('24.19.0');
    expect(REQUIRED.pnpm).toBe('11.19.0');
    expect(pkg.packageManager).toBe(`pnpm@${REQUIRED.pnpm}`);
    expect(pkg.engines.node).toContain(REQUIRED.node);
    expect(dockerfileCi).toContain(`FROM node:${REQUIRED.node}-bookworm`);
    expect(dockerfileCi).toContain(`PNPM_VERSION=${REQUIRED.pnpm}`);
    expect(dockerfileCi).toMatch(/PLAYWRIGHT_VERSION=1\.63\.0/);
    expect(pkg.scripts.verify).toMatch(/^pnpm format:check && pnpm check:execution && /);
  });
  it('rejects a toolchain mismatch and a checkout that differs from the expected commit', () => {
    expect(checkToolchain('24.18.0', '11.19.0')).toHaveLength(1);
    expect(checkToolchain('24.19.0', null)).toHaveLength(1);
    expect(checkToolchain('24.19.0', '11.19.0')).toHaveLength(0);
    expect(checkSourceSha('', 'abc')).toBeNull();
    expect(checkSourceSha('abcdef1', 'abcdef1234567890abcdef1234567890abcdef12')).toBeNull();
    expect(checkSourceSha('1234567', 'abcdef1234567890abcdef1234567890abcdef12')).toMatch(
      /다릅니다/,
    );
    expect(checkSourceSha('not-a-sha', 'abc')).toMatch(/형식/);
    expect(checkSourceSha('abcdef1', null)).toMatch(/실패/);
  });
});

describe('ci-verify process (dry run, nothing executed)', () => {
  it('prints the plan with a single pnpm verify when the toolchain matches', () => {
    const r = runCiVerify({ EXPECTED_SOURCE_SHA: '' });
    if (r.status === 2) return; // local toolchain differs from CI; contract is covered by the unit checks above
    expect(r.status).toBe(0);
    expect(r.stdout.match(/pnpm(?:\.cmd)? verify/g)).toHaveLength(1);
    expect(r.stdout).toContain('DRY_RUN');
  });
  it('fails before install when the expected commit does not match the checkout', () => {
    const r = runCiVerify({ EXPECTED_SOURCE_SHA: '0000000000000000000000000000000000000000' });
    if (r.status === 2) return;
    expect(r.status).toBe(3);
    expect(r.stdout).not.toContain('install --frozen-lockfile');
    expect(r.stderr).toMatch(/source-sha FAILED/);
  });
});

describe('Jenkinsfile uses the single entry point', () => {
  it('calls scripts/ci-verify.mjs inside the pinned CI image and passes the expected SHA', () => {
    expect(jenkinsfile).toContain('node scripts/ci-verify.mjs');
    expect(jenkinsfile).toContain('infra/docker/Dockerfile.ci');
    expect(jenkinsfile).toContain('EXPECTED_SOURCE_SHA');
    expect(jenkinsfile).toMatch(/gitlabAfter/);
  });
  it('does not list the individual verify checks again (regression to the old CI branch)', () => {
    const verifyStage = jenkinsfile.slice(
      jenkinsfile.indexOf("stage('Verify')"),
      jenkinsfile.indexOf("stage('Build images')"),
    );
    for (const inner of [
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test',
      'pnpm check:execution',
    ])
      expect(verifyStage).not.toContain(inner);
    expect(jenkinsfile).not.toContain('RUN_NODE');
  });
  it('deploys only on the develop branch and injects secrets from the Secret file credential', () => {
    expect(jenkinsfile).toContain("DEPLOY_BRANCH = 'develop'");
    expect(jenkinsfile).toMatch(/when \{ environment name: 'IS_DEPLOY', value: 'true' \}/);
    expect(jenkinsfile).toContain("file(credentialsId: 'kkakkung-production-env'");
    expect(jenkinsfile).not.toMatch(/LIVEKIT_API_SECRET\s*=/);
  });
  it('never turns a failure into success in post actions', () => {
    const post = jenkinsfile.slice(jenkinsfile.indexOf('  post {'));
    expect(post).toMatch(/failure \{/);
    expect(post).not.toMatch(/currentBuild\.result\s*=\s*'SUCCESS'/);
  });
});

// F-04 / DP-04 CI contract: the Jenkinsfile runs the single entry point, the entry point runs
// `pnpm verify` exactly once, the expected commit is checked before install, and the toolchain
// is pinned. Nothing here starts Docker, Jenkins, a browser or the network.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN, REQUIRED, checkSourceSha, checkToolchain } from '../../scripts/ci-verify.mjs';
import {
  changedFilesAgainst,
  needsImageBuild,
  touchesImageInputs,
} from '../../scripts/needs-image-build.mjs';
import { scanRange } from '../../scripts/secret-scan-range.mjs';
import { triggerVerdict } from '../../scripts/trigger-commit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jenkinsfile = readFileSync(resolve(root, 'Jenkinsfile'), 'utf8');
const imageScanJenkinsfile = readFileSync(
  resolve(root, 'infra/jenkins/image-scan.Jenkinsfile'),
  'utf8',
);
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
    for (const inner of ['format:check', 'lint', 'typecheck', 'test', 'build', 'test:e2e'])
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
    expect(pkg.scripts.verify).toMatch(/^pnpm format:check && pnpm lint && /);
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

// S15P21C204-345. 연속 머지로 푸시 웹훅이 한 빌드로 합쳐지면 알려온 것은 첫 push 이고 체크아웃은
// 마지막 develop 이다. 대조하던 때는 배포가 통째로 멈췄다(kkakkung #205: 머지 셋, 배포 0). 플러그인은
// push 빌드에도 MR 커밋 변수를 채우므로 어느 값이 있는지로 트리거를 가를 수도 없었다(#209).
describe('trigger commit guard', () => {
  const HEAD = 'a'.repeat(40);
  const OLDER = 'f'.repeat(40);

  it('deploys the develop checkout as it is, whatever the folded webhook announced', () => {
    // #209 그대로: push 빌드인데 MR 커밋 변수에도 같은 값이 들어왔다.
    expect(triggerVerdict({ head: HEAD, deploy: 'true', mr: OLDER, push: OLDER })).toMatchObject({
      ok: true,
      sha: HEAD,
      announced: OLDER,
    });
    expect(triggerVerdict({ head: HEAD, deploy: 'true', push: OLDER })).toMatchObject({
      ok: true,
      sha: HEAD,
    });
  });

  // MR 은 중단하면 새 push 의 빌드가 따라온다. 완화하면 오래된 커밋이 성공 상태를 받는다.
  it('keeps the exact match for builds that do not deploy', () => {
    for (const input of [
      { head: HEAD, deploy: 'false', mr: OLDER },
      { head: HEAD, deploy: 'false', push: OLDER },
      { head: HEAD, mr: OLDER },
    ]) {
      const verdict = triggerVerdict(input);
      expect(verdict.ok, JSON.stringify(input)).toBe(false);
      if (!verdict.ok) expect(verdict.message).toMatch(/다릅니다/);
    }
    // 짧은 해시로 와도 접두사로 맞으면 통과한다 (ci-verify 와 같은 규칙).
    expect(triggerVerdict({ head: HEAD, deploy: 'false', mr: HEAD.slice(0, 8) })).toMatchObject({
      ok: true,
      sha: HEAD,
    });
  });

  it('uses the checkout as it is when nothing was announced, and refuses what it cannot read', () => {
    expect(triggerVerdict({ head: HEAD })).toMatchObject({ ok: true, sha: HEAD, announced: '' });
    // 읽을 수 없거나 형식이 이상하면 배포 빌드라도 막는다. 모르는 것이 통과의 이유가 되지 않는다.
    for (const input of [
      { head: '' },
      { head: 'not-a-sha', deploy: 'true' },
      { head: HEAD, deploy: 'true', push: 'nope' },
      { head: HEAD, mr: 'nope' },
    ])
      expect(triggerVerdict(input).ok, JSON.stringify(input)).toBe(false);
  });
});

describe('Jenkinsfile uses the single entry point', () => {
  it('calls scripts/ci-verify.mjs inside the pinned CI image and passes the expected SHA', () => {
    expect(jenkinsfile).toContain('node scripts/ci-verify.mjs');
    expect(jenkinsfile).toContain('infra/docker/Dockerfile.ci');
    expect(jenkinsfile).toContain('EXPECTED_SOURCE_SHA');
    expect(jenkinsfile).toMatch(/gitlabAfter/);
  });
  // S15P21C204-345. 대조는 스크립트가 하고 Jenkinsfile 은 결과만 받는다. 배포 여부를 먼저 정해
  // 넘겨야 스크립트가 MR(정확 일치)과 develop 배포(체크아웃 그대로)를 갈라 볼 수 있다.
  it('decides the trigger match in the script and verifies against the checked-out commit', () => {
    const prepare = jenkinsfile.slice(
      jenkinsfile.indexOf("stage('Prepare')"),
      jenkinsfile.indexOf("stage('Secret scan')"),
    );
    expect(prepare).toContain('node scripts/trigger-commit.mjs');
    expect(prepare).toMatch(/--head "\$GIT_SHA"/);
    expect(prepare).toContain('--deploy "$IS_DEPLOY"');
    expect(prepare.indexOf('env.IS_DEPLOY =')).toBeLessThan(prepare.indexOf('trigger-commit.mjs'));
    expect(prepare).toContain('TRIGGER_MR=${env.gitlabMergeRequestLastCommit');
    expect(prepare).toContain('TRIGGER_PUSH=${env.gitlabAfter');
    expect(prepare).toMatch(/env\.EXPECTED_SOURCE_SHA = sh\(/);
    // 옛 인라인 비교가 남아 있으면 스크립트의 판단을 덮어쓴다.
    expect(prepare).not.toMatch(/expected != head/);
  });
  it('does not list the individual verify checks again (regression to the old CI branch)', () => {
    const verifyStage = jenkinsfile.slice(
      jenkinsfile.indexOf("stage('Verify')"),
      jenkinsfile.indexOf("stage('Build images')"),
    );
    expect(verifyStage).not.toBe('');
    for (const inner of ['pnpm format:check', 'pnpm lint', 'pnpm typecheck', 'pnpm test'])
      expect(verifyStage).not.toContain(inner);
    expect(jenkinsfile).not.toContain('RUN_NODE');
  });
  it('deploys only on the develop branch and injects secrets from the Secret file credential', () => {
    expect(jenkinsfile).toContain("DEPLOY_BRANCH = 'develop'");
    expect(jenkinsfile).toMatch(/when \{ environment name: 'IS_DEPLOY', value: 'true' \}/);
    expect(jenkinsfile).toContain("file(credentialsId: 'kkakkung-production-env'");
    expect(jenkinsfile).not.toMatch(/LIVEKIT_API_SECRET\s*=/);
  });
  // S15P21C204-343. Verify 는 같은 트리를 다른 잡이 검증했으면 건너뛰는데, 그 잡은 작업 공간이
  // 다르다. 배포 스모크는 이 작업 공간의 웹 클라이언트 소스를 돌리고 그 소스는 packages/*/dist 를
  // 읽으므로, 검증을 건너뛴 배포는 옛 dist 로 스모크를 돌려 무너졌다(kkakkung #203).
  it('brings the deploy workspace up to date before the release scripts read it', () => {
    const deploy = jenkinsfile.slice(jenkinsfile.indexOf("stage('Deploy')"));
    const prepare = deploy.slice(0, deploy.indexOf('withCredentials'));
    expect(prepare).toContain('pnpm install --frozen-lockfile');
    expect(prepare).toContain('pnpm build:packages');
    // 검증 때와 같은 도구체인·같은 store 로 만들어야 dist 가 검증된 것과 같다.
    expect(prepare).toContain('"$CI_IMAGE:$CI_TAG"');
    expect(prepare).toContain('/var/lib/jenkins/.cache/pnpm-store:/tmp/pnpm-store');
    // 무거운 단계는 호스트 잠금 아래에서만 돈다 (SETUP.md §6).
    expect(prepare).toMatch(/flock 9/);
    // 조건을 달면 이번 사고와 같은 종류의 암묵적 결합이 되돌아온다.
    expect(prepare).not.toMatch(/VERIFIED_BY/);
  });
  it('reports commit status to GitLab for running, success and failure', () => {
    expect(jenkinsfile).toContain("gitLabConnection('ssafy-gitlab')");
    for (const state of ['running', 'failed', 'success'])
      expect(jenkinsfile).toContain(`updateGitlabCommitStatus name: 'jenkins', state: '${state}'`);
  });
  it('prunes release images only through the age-guarded script under the host lock', () => {
    const post = jenkinsfile.slice(jenkinsfile.indexOf('  post {'));
    expect(post).toMatch(
      /flock \/var\/lib\/jenkins\/verify\.lock node scripts\/prune-release-images\.mjs[\s\S]*--min-age-minutes 60[\s\S]*--protect "\$TAG"[\s\S]*last-good-tag/,
    );
    expect(post).not.toMatch(/docker rmi/);
    expect(post).not.toMatch(/tail -n \+6/);
  });
  it('never turns a failure into success in post actions', () => {
    const post = jenkinsfile.slice(jenkinsfile.indexOf('  post {'));
    expect(post).toMatch(/failure \{/);
    expect(post).not.toMatch(/currentBuild\.result\s*=\s*'SUCCESS'/);
  });
});

// S15P21C204-322. 파이프라인에서 결과에 영향을 주지 않던 단계를 걷어낸 상태를 고정한다.
describe('pipeline carries no stage that cannot change its verdict', () => {
  it('builds images only when they are deployed or their inputs changed', () => {
    expect(jenkinsfile).toContain(
      'node scripts/needs-image-build.mjs --deploy "$IS_DEPLOY" --base origin/develop',
    );
    const stage = jenkinsfile.slice(jenkinsfile.indexOf("stage('Build images')"));
    expect(stage.slice(0, stage.indexOf('steps'))).toMatch(
      /when \{ environment name: 'NEEDS_IMAGES', value: 'true' \}/,
    );
  });
  it('scans images in the nightly job, not in the build that cannot fail on the result', () => {
    // 옛 단계는 `--exit-code 0` 이라 취약점이 나와도 통과시키면서 잠금을 1~3분 쥐고 있었다.
    expect(jenkinsfile).not.toContain("stage('Scan images')");
    expect(jenkinsfile).not.toContain('trivy');
    expect(imageScanJenkinsfile).toContain('aquasec/trivy:');
    expect(imageScanJenkinsfile).toMatch(/triggers \{ cron\(/);
    // 배포된 것만 본다. 아무도 쓰지 않는 MR 이미지를 스캔하던 것이 문제였다.
    expect(imageScanJenkinsfile).toContain('last-good-tag');
  });
  it('pins every scanner tag so a build never silently changes what it ran', () => {
    for (const source of [jenkinsfile, imageScanJenkinsfile])
      expect(source).not.toMatch(/(gitleaks|trivy):latest/);
    expect(jenkinsfile).toMatch(/GITLEAKS_IMAGE = 'zricethezav\/gitleaks:v\d+\.\d+\.\d+'/);
    expect(imageScanJenkinsfile).toMatch(/TRIVY_IMAGE = 'aquasec\/trivy:\d+\.\d+\.\d+'/);
  });
  it('bounds the secret scan to this build without ever skipping it', () => {
    expect(jenkinsfile).toContain('node scripts/secret-scan-range.mjs "$SCAN_BASE"');
    const stage = jenkinsfile.slice(
      jenkinsfile.indexOf("stage('Secret scan')"),
      jenkinsfile.indexOf("stage('Verify')"),
    );
    expect(stage).toContain('--exit-code 1');
    // 범위를 못 정하면 인자 없이 전체를 읽는다. 건너뛰는 갈래가 없어야 한다.
    expect(stage).toMatch(/set --\s*$/m);
    expect(stage).not.toMatch(/exit 0/);
  });
});

describe('needs-image-build decides conservatively', () => {
  const infra = ['infra/docker/Dockerfile.web'];
  const source = ['server/src/rooms/KkakkungRoom.ts', 'docs/testing.md'];
  it('always builds for a deploy', () => {
    expect(needsImageBuild({ deploy: true, changedFiles: [] })).toBe(true);
  });
  it('builds when an image input changed and skips when only source did', () => {
    expect(needsImageBuild({ deploy: false, changedFiles: infra })).toBe(true);
    expect(needsImageBuild({ deploy: false, changedFiles: source })).toBe(false);
  });
  it('builds when the comparison itself failed', () => {
    // 얕은 클론·없는 ref·git 실패. 무엇이 바뀌었는지 모르는 것은 안 바뀐 것과 다르다.
    expect(needsImageBuild({ deploy: false, changedFiles: null })).toBe(true);
    expect(changedFilesAgainst('')).toBeNull();
    expect(changedFilesAgainst('no-such-ref-for-a-test')).toBeNull();
  });
  it('covers every path the two Dockerfiles read', () => {
    const dockerfiles = ['infra/docker/Dockerfile.game-server', 'infra/docker/Dockerfile.web']
      .map((file) => readFileSync(resolve(root, file), 'utf8'))
      .join('\n');
    const copied = [...dockerfiles.matchAll(/^COPY (?!--from)(\S+)/gm)].map((match) => match[1]!);
    // COPY 한 경로가 하나라도 판정 밖에 있으면, 그 파일만 바꾼 MR 이 깨진 이미지를 통과시킨다.
    const missed = copied.filter(
      (path) => !touchesImageInputs([path.endsWith('/') ? `${path}x` : path]),
    );
    expect(missed.filter((path) => !['packages', 'server', 'apps/web'].includes(path))).toEqual([]);
  });
});

describe('secret-scan-range narrows only when it is certain', () => {
  /** A repository where `name` resolves and `name..HEAD` holds `count` commits. */
  const repo = (name: string, count: string) => (args: readonly string[]) => {
    if (args[0] === 'rev-parse') return args[3]?.startsWith(name) ? 'sha' : null;
    if (args[0] === 'rev-list') return args[2]!.startsWith(name) ? count : null;
    return null;
  };
  it('uses the first base that resolves to a non-empty range', () => {
    expect(scanRange(['missing', 'origin/develop'], repo('origin/develop', '3'))).toBe(
      'origin/develop..HEAD',
    );
  });
  it('narrows even when the base is not an ancestor of HEAD', () => {
    // MR 브랜치를 딴 뒤 develop 이 앞서 나간 보통의 상황. `base..HEAD` 는 그래도 이 브랜치가
    // 더한 커밋만 가리킨다. 조상일 것을 요구하면 거의 모든 MR 이 전체 스캔으로 떨어진다.
    const diverged = (args: readonly string[]) => {
      if (args[0] === 'merge-base') return null; // --is-ancestor 가 거짓인 저장소
      return repo('origin/develop', '2')(args);
    };
    expect(scanRange(['origin/develop'], diverged)).toBe('origin/develop..HEAD');
  });
  it('falls back to the whole history rather than scanning nothing', () => {
    expect(scanRange([''], repo('x', '1'))).toBeNull();
    expect(scanRange(['no-such-ref'], repo('origin/develop', '1'))).toBeNull();
    // 범위가 비면 커밋을 하나도 읽지 않는다. 그럴 바엔 전체를 읽는다.
    expect(scanRange(['origin/develop'], repo('origin/develop', '0'))).toBeNull();
    expect(scanRange(['origin/develop'], repo('origin/develop', 'not-a-number'))).toBeNull();
  });
  it('refuses a base that is not a plain ref', () => {
    expect(scanRange(['a; rm -rf /'], () => 'sha')).toBeNull();
    expect(scanRange(['$(whoami)'], () => 'sha')).toBeNull();
  });
});

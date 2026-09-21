// F-04 / DP-04 failure notification contract: the recipient map is complete and well formed, the
// Jenkinsfile wires the notifier through the Secret text credential only, and the notifier never
// exposes the webhook URL. Nothing here contacts Mattermost.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXCERPT_LIMITS,
  buildPayload,
  excerptLog,
  failedTests,
  loadMap,
  readBuildLog,
  redact,
  resolveRecipient,
} from '../../scripts/notify-build-failure.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jenkinsfile = readFileSync(resolve(root, 'Jenkinsfile'), 'utf8');
const map = loadMap();

describe('notify-map.json', () => {
  it('maps the six team emails and GitLab usernames to the same Mattermost usernames', () => {
    const entries = Object.entries(map.byEmail);
    expect(entries).toHaveLength(6);
    for (const [email, user] of entries) {
      expect(email).toMatch(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(user).toMatch(/^[a-z0-9._-]+$/);
    }
    expect(new Set(Object.values(map.byEmail)).size).toBe(6);
    expect(Object.keys(map.byGitlabUsername)).toHaveLength(6);
    expect(new Set(Object.values(map.byGitlabUsername))).toEqual(
      new Set(Object.values(map.byEmail)),
    );
    // GitLab usernames seen in webhook records must resolve even when the account email differs.
    expect(map.byGitlabUsername.jhsfw0506).toBe('jhsfw0506');
    expect(map.byGitlabUsername.a4651001).toBe('ljh12160569');
    expect(map.mergeRequestBaseUrl).toMatch(/^https:\/\/lab\.ssafy\.com\/.+\/merge_requests\/$/);
  });

  it('holds no webhook URL or token', () => {
    const raw = readFileSync(resolve(root, 'infra/jenkins/notify-map.json'), 'utf8');
    expect(raw).not.toMatch(/hooks\//);
    expect(raw).not.toMatch(/token/i);
  });
});

describe('Jenkinsfile wiring', () => {
  it('records the running stage so the failure message can name it', () => {
    const stages = [...jenkinsfile.matchAll(/stage\('([^']+)'\)/g)].map((m) => m[1]);
    // S15P21C204-322. 개수 하한(옛 단계 수 6)이 아니라 이름을 고정한다. 하한만 보면 단계가
    // 사라져도 지나가고, 실제로 `Scan images` 를 야간 잡으로 옮겼을 때 이 시험이 남은 5개를
    // 문제 삼는 대신 무엇이 빠졌는지 말해 줘야 한다.
    expect(stages).toEqual(['Prepare', 'Secret scan', 'Verify', 'Build images', 'Deploy']);
    const markers = jenkinsfile.match(/env\.FAILED_STAGE = env\.STAGE_NAME/g) ?? [];
    expect(markers).toHaveLength(stages.length);
  });

  it('binds the webhook only from the Secret text credential and never fails the build on it', () => {
    expect(jenkinsfile).toContain(
      "string(credentialsId: 'mattermost-webhook', variable: 'MM_WEBHOOK')",
    );
    expect(jenkinsfile).toMatch(/node scripts\/notify-build-failure\.mjs \|\| true/);
    expect(jenkinsfile).not.toMatch(/hooks\/[A-Za-z0-9]/);
  });
});

describe('notifier payload', () => {
  const baseEnv = {
    JOB_NAME: 'kkakkung-mr',
    BUILD_NUMBER: '16',
    BUILD_URL: 'https://j15c204.p.ssafy.io/jenkins/job/kkakkung-mr/16/',
    gitlabSourceBranch: 'feat/S15P21C204-157-observability',
    TAG: '92aa417e',
    FAILED_STAGE: 'Verify',
    gitlabMergeRequestIid: '64',
  };

  it('resolves the recipient by webhook email, then GitLab username, then commit author', () => {
    const [email, user] = Object.entries(map.byEmail)[0]!;
    expect(resolveRecipient(map, email.toUpperCase())).toBe(user);
    expect(resolveRecipient(map, undefined, 'nobody@example.com', email)).toBe(user);
    expect(resolveRecipient(map, 'nobody@example.com')).toBeNull();
    expect(resolveRecipient(map, { email: 'other@example.com' }, { username: 'a4651001' })).toBe(
      'ljh12160569',
    );
    expect(resolveRecipient(map, { username: 'unknown-user' })).toBeNull();
  });

  it('a GitLab account email that differs from the map still reaches the right person via username', () => {
    const { payload, recipient } = buildPayload(
      { ...baseEnv, gitlabUserEmail: 'private@example.com', gitlabMergedByUser: 'a4651001' },
      map,
    );
    expect(recipient).toBe('ljh12160569');
    expect(payload.channel).toBe('@ljh12160569');
  });

  it('sends a direct message with job, branch, commit, stage, MR and console links', () => {
    const [email, user] = Object.entries(map.byEmail)[1]!;
    const { payload, recipient } = buildPayload({ ...baseEnv, gitlabUserEmail: email }, map);
    expect(recipient).toBe(user);
    expect(payload.channel).toBe(`@${user}`);
    expect(payload.text).toContain('kkakkung-mr #16');
    expect(payload.text).toContain('feat/S15P21C204-157-observability');
    expect(payload.text).toContain('92aa417e');
    expect(payload.text).toContain('**Verify**');
    expect(payload.text).toContain(`${map.mergeRequestBaseUrl}64`);
    expect(payload.text).toContain('https://j15c204.p.ssafy.io/jenkins/job/kkakkung-mr/16/console');
  });

  it('falls back to the default channel for an unmapped sender', () => {
    const { payload, recipient } = buildPayload(
      { ...baseEnv, CULPRIT_EMAIL: 'x@example.com' },
      map,
    );
    expect(recipient).toBeNull();
    expect(payload.channel).toBeUndefined();
    expect(payload.text).toContain('(수신자 미등록)');
  });

  it('dry run prints the payload and never the webhook, and exits 0 without network', () => {
    const [email] = Object.entries(map.byEmail)[2]!;
    const result = spawnSync(
      process.execPath,
      [resolve(root, 'scripts/notify-build-failure.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          ...process.env,
          ...baseEnv,
          gitlabUserEmail: email,
          NOTIFY_DRY_RUN: '1',
          MM_WEBHOOK: 'https://example.invalid/hooks/DO-NOT-PRINT-ME',
        },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"dryRun": true');
    expect(result.stdout).not.toContain('DO-NOT-PRINT-ME');
    expect(result.stderr).toBe('');
  });

  it('a missing webhook is a skipped notification, not an error', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, 'scripts/notify-build-failure.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, ...baseEnv, MM_WEBHOOK: '' },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('건너뜁니다');
  });
});

describe('failure log excerpt', () => {
  const esc = String.fromCharCode(27);
  const sampleLog = [
    '[2026-09-10T07:44:01.000Z] [Pipeline] sh',
    `[2026-09-10T07:44:02.000Z] ${esc}[8mha:////AAAA${esc}[0m[Pipeline] updateGitlabCommitStatus`,
    '[2026-09-10T07:45:03.000Z]  ✓ tests/contracts/ci-contract.test.ts (11 tests) 2998ms',
    `[2026-09-10T07:45:04.000Z]      ${esc}[31m×${esc}[39m connects six runtimes 19350ms`,
    '[2026-09-10T07:45:05.000Z]  ✓ server/test/health/readiness.test.ts (25 tests)',
    `[2026-09-10T07:46:32.000Z] ${esc}[31m⎯⎯⎯${esc}[39m${esc}[1m Failed Tests 1 ${esc}[22m`,
    `[2026-09-10T07:46:32.000Z] ${esc}[41m FAIL ${esc}[49m server/test/media/product-integration.test.ts${esc}[2m > ${esc}[22msuite${esc}[2m > ${esc}[22mconnects six runtimes`,
    '[2026-09-10T07:46:32.000Z] Error: {"abortReason":"SERVER_TICK_OVERLOAD"}',
    '[2026-09-10T07:46:32.000Z] authorization: Bearer abc.def.ghi token=sekrit https://mm.example/hooks/XYZ123',
    ...Array.from({ length: 60 }, (_, i) => `[2026-09-10T07:46:32.000Z]   detail line ${i}`),
    '[2026-09-10T07:46:32.000Z]  Test Files  1 failed | 211 passed (212)',
    '[2026-09-10T07:46:32.000Z]       Tests  1 failed | 2063 passed (2064)',
    '[2026-09-10T07:46:33.000Z] ci-verify: verify FAILED: exit 1',
    'ERROR: script returned exit code 1',
  ].join('\n');

  it('starts at the vitest failure block, drops pipeline plumbing and passing ticks, keeps the summary', () => {
    const excerpt = excerptLog(sampleLog)!;
    const lines = excerpt.split('\n');
    expect(lines[0]).toMatch(/^⎯⎯⎯ Failed Tests 1/);
    expect(excerpt).not.toContain('[Pipeline]');
    expect(excerpt).not.toContain('ha:////');
    expect(excerpt).not.toContain('2026-09-10T07');
    expect(excerpt).not.toMatch(/✓/);
    expect(excerpt).not.toContain(esc);
    expect(excerpt).toContain(
      'FAIL  server/test/media/product-integration.test.ts > suite > connects six runtimes',
    );
    expect(excerpt).toContain('SERVER_TICK_OVERLOAD');
    expect(lines.length).toBeLessThanOrEqual(EXCERPT_LIMITS.maxLines + 7);
    expect(excerpt).toMatch(/… \(\d+줄 생략\)/);
    expect(excerpt).toContain('Test Files  1 failed | 211 passed (212)');
    expect(excerpt).toContain('ERROR: script returned exit code 1');
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_LIMITS.maxChars + 20);
  });

  it('redacts bearer tokens, token=values and webhook URLs before the text leaves the host', () => {
    const excerpt = excerptLog(sampleLog)!;
    expect(excerpt).not.toContain('abc.def.ghi');
    expect(excerpt).not.toContain('sekrit');
    expect(excerpt).not.toContain('hooks/XYZ123');
    expect(excerpt).toContain('Bearer [redacted]');
    expect(excerpt).toContain('token=[redacted]');
    expect(excerpt).toContain('[redacted-url]');
    expect(redact('cookie: session=abc')).toBe('cookie: [redacted]');
  });

  it('falls back to the tail of the log when no failure marker exists, and to null for an empty log', () => {
    const plain = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const excerpt = excerptLog(plain)!;
    expect(excerpt.split('\n')).toHaveLength(EXCERPT_LIMITS.maxLines);
    expect(excerpt.endsWith('line 99')).toBe(true);
    expect(excerptLog('')).toBeNull();
    expect(excerptLog(undefined)).toBeNull();
  });

  it('lists failed vitest cases once each and puts them in the message', () => {
    expect(failedTests(sampleLog)).toEqual([
      'server/test/media/product-integration.test.ts > suite > connects six runtimes',
    ]);
    const { payload } = buildPayload(
      { JOB_NAME: 'kkakkung-mr', BUILD_NUMBER: '70', FAILED_STAGE: 'Verify' },
      map,
      sampleLog,
    );
    expect(payload.text).toContain(
      '- 실패 시험: `server/test/media/product-integration.test.ts > suite > connects six runtimes`',
    );
    expect(payload.text).toContain('**실패 로그 발췌** (전체는 콘솔 링크)');
    expect(payload.text).toContain('```\n⎯⎯⎯ Failed Tests 1');
    expect(payload.text.length).toBeLessThan(6000);
  });

  it('reads the controller log by JENKINS_HOME/JOB_NAME/BUILD_NUMBER and tolerates a missing file', () => {
    const home = mkdtempSync(join(tmpdir(), 'kkakkung-jenkins-home-'));
    const dir = join(home, 'jobs', 'kkakkung-mr', 'builds', '70');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'log'), sampleLog);
    expect(readBuildLog({ JENKINS_HOME: home, JOB_NAME: 'kkakkung-mr', BUILD_NUMBER: '70' })).toBe(
      sampleLog,
    );
    expect(
      readBuildLog({ JENKINS_HOME: home, JOB_NAME: 'kkakkung-mr', BUILD_NUMBER: '71' }),
    ).toBeNull();
    expect(readBuildLog({})).toBeNull();
    // Without a log the message is the same as before: no excerpt section, no failure.
    const { payload } = buildPayload(
      { JOB_NAME: 'kkakkung', BUILD_NUMBER: '1', FAILED_STAGE: 'Verify' },
      map,
      null,
    );
    expect(payload.text).not.toContain('실패 로그 발췌');
    expect(payload.text).not.toContain('실패 시험');
  });
});

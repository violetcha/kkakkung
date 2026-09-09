// F-04 / DP-04 failure notification contract: the recipient map is complete and well formed, the
// Jenkinsfile wires the notifier through the Secret text credential only, and the notifier never
// exposes the webhook URL. Nothing here contacts Mattermost.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayload, loadMap, resolveRecipient } from '../../scripts/notify-build-failure.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jenkinsfile = readFileSync(resolve(root, 'Jenkinsfile'), 'utf8');
const map = loadMap();

describe('notify-map.json', () => {
  it('maps the six team emails to Mattermost usernames', () => {
    const entries = Object.entries(map.byEmail);
    expect(entries).toHaveLength(6);
    for (const [email, user] of entries) {
      expect(email).toMatch(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(user).toMatch(/^[a-z0-9._-]+$/);
    }
    expect(new Set(Object.values(map.byEmail)).size).toBe(6);
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
    expect(stages.length).toBeGreaterThanOrEqual(6);
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

  it('resolves the recipient from the GitLab webhook email first, then the commit author', () => {
    const [email, user] = Object.entries(map.byEmail)[0]!;
    expect(resolveRecipient(map, email.toUpperCase())).toBe(user);
    expect(resolveRecipient(map, undefined, 'nobody@example.com', email)).toBe(user);
    expect(resolveRecipient(map, 'nobody@example.com')).toBeNull();
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

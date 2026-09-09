#!/usr/bin/env node
// Owned by F (F-04 / DP-04). Sends one Mattermost message when a Jenkins build fails.
//
// Runs on the Jenkins host inside `post { failure }` (host Node 24, no dependencies). The
// webhook URL arrives only through the MM_WEBHOOK environment variable, bound from the
// Jenkins Secret text credential `mattermost-webhook`; it is never printed. The recipient is
// resolved from the GitLab webhook user email or the failing commit's author email through
// infra/jenkins/notify-map.json and receives a direct message (`channel: "@user"`). Unknown
// senders fall back to the webhook's default channel. The script always exits 0 so a
// notification problem never changes the build result.
//
//   NOTIFY_DRY_RUN=1 node scripts/notify-build-failure.mjs   # prints the payload, sends nothing

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function loadMap(path = resolve(root, 'infra/jenkins/notify-map.json')) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const byEmail = {};
  for (const [email, user] of Object.entries(parsed.byEmail ?? {}))
    byEmail[String(email).trim().toLowerCase()] = String(user).trim().replace(/^@/, '');
  return { byEmail, mergeRequestBaseUrl: String(parsed.mergeRequestBaseUrl ?? '') };
}

export function resolveRecipient(map, ...emails) {
  for (const email of emails) {
    if (!email) continue;
    const user = map.byEmail[String(email).trim().toLowerCase()];
    if (user) return user;
  }
  return null;
}

export function buildPayload(env, map) {
  const job = env.JOB_NAME ?? 'jenkins';
  const number = env.BUILD_NUMBER ?? '?';
  const buildUrl = env.BUILD_URL ? `${env.BUILD_URL.replace(/\/?$/, '/')}console` : null;
  const branch = env.gitlabSourceBranch ?? env.GIT_BRANCH ?? env.BRANCH_NAME ?? '(unknown)';
  const sha = env.TAG ?? (env.GIT_COMMIT ? env.GIT_COMMIT.slice(0, 8) : '(unknown)');
  const stage = env.FAILED_STAGE ?? '(unknown)';
  const mrIid = env.gitlabMergeRequestIid ?? '';
  const mrUrl = mrIid && map.mergeRequestBaseUrl ? `${map.mergeRequestBaseUrl}${mrIid}` : null;
  const recipient = resolveRecipient(map, env.gitlabUserEmail, env.CULPRIT_EMAIL);
  const who = recipient ? `@${recipient}` : '(수신자 미등록)';
  const lines = [
    `:x: **Jenkins 실패** ${job} #${number} · ${who}`,
    `- 브랜치 \`${branch}\` · 커밋 \`${sha}\` · 실패 단계 **${stage}**`,
  ];
  if (mrUrl) lines.push(`- MR: ${mrUrl}`);
  if (buildUrl) lines.push(`- 콘솔: ${buildUrl}`);
  lines.push('- 고친 뒤 같은 브랜치에 push 하면 다시 검증됩니다.');
  const payload = { text: lines.join('\n'), username: 'kkakkung-ci' };
  if (recipient) payload.channel = `@${recipient}`;
  return { payload, recipient };
}

async function main() {
  const env = process.env;
  const map = loadMap(env.NOTIFY_MAP ? resolve(env.NOTIFY_MAP) : undefined);
  const { payload, recipient } = buildPayload(env, map);
  if (env.NOTIFY_DRY_RUN === '1') {
    console.log(JSON.stringify({ dryRun: true, recipient, payload }, null, 2));
    return;
  }
  const webhook = env.MM_WEBHOOK;
  if (!webhook) {
    console.log('notify: MM_WEBHOOK 이 없어 알림을 건너뜁니다');
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    console.log(
      `notify: Mattermost ${response.status} → ${recipient ? `@${recipient}` : '기본 채널'}`,
    );
  } catch (error) {
    console.log(`notify: 전송 실패 (${error instanceof Error ? error.name : 'error'})`);
  } finally {
    clearTimeout(timer);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch(() => process.exit(0));

#!/usr/bin/env node
// Owned by F (F-04 / DP-04). Sends one Mattermost message when a Jenkins build fails.
//
// Runs on the Jenkins host inside `post { failure }` (host Node 24, no dependencies). The
// webhook URL arrives only through the MM_WEBHOOK environment variable, bound from the
// Jenkins Secret text credential `mattermost-webhook`; it is never printed. The recipient is
// resolved through infra/jenkins/notify-map.json in this order: GitLab webhook user email,
// GitLab username (gitlabMergedByUser / gitlabUserUsername), failing commit author email. The
// recipient gets a direct message (`channel: "@user"`); unknown senders fall back to the
// webhook's default channel. The message carries a short excerpt of the build log (failed test
// names, the vitest failure block, the final error line) read from the controller's own log file;
// the excerpt is capped and redacted, and the full console stays behind the link. The script
// always exits 0 so a notification problem never changes the build result.
//
//   NOTIFY_DRY_RUN=1 node scripts/notify-build-failure.mjs   # prints the payload, sends nothing

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function loadMap(path = resolve(root, 'infra/jenkins/notify-map.json')) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const normalize = (table) => {
    const out = {};
    for (const [key, user] of Object.entries(table ?? {}))
      out[String(key).trim().toLowerCase()] = String(user).trim().replace(/^@/, '');
    return out;
  };
  return {
    byEmail: normalize(parsed.byEmail),
    byGitlabUsername: normalize(parsed.byGitlabUsername),
    mergeRequestBaseUrl: String(parsed.mergeRequestBaseUrl ?? ''),
  };
}

/** Each key is { email } or { username }; the first that maps wins. */
export function resolveRecipient(map, ...keys) {
  for (const key of keys) {
    if (!key) continue;
    const value = typeof key === 'string' ? { email: key } : key;
    const table = value.username !== undefined ? map.byGitlabUsername : map.byEmail;
    const raw = value.username ?? value.email;
    if (!raw) continue;
    const user = table[String(raw).trim().toLowerCase()];
    if (user) return user;
  }
  return null;
}

// ESC[...m colour codes (built from the char code: eslint forbids control characters in regex literals).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const JENKINS_LINK = /ha:\/\/\/\/[A-Za-z0-9+/=]+/g;
const TIMESTAMP = /^\[\d{4}-\d{2}-\d{2}T[^\]]*\]\s?/;
const LINE_MAX = 300;
export const EXCERPT_LIMITS = Object.freeze({ maxLines: 40, maxChars: 3500 });

/** Anything that could be a credential is cut before the text leaves the host. */
export function redact(line) {
  return line
    .replace(/https?:\/\/\S*hooks\/\S+/gi, '[redacted-url]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(
      /\b(token|secret|password|passwd|api[_-]?key|cookie)\b(\s*[:=]\s*)\S+/gi,
      '$1$2[redacted]',
    );
}

function cleanLine(raw) {
  return redact(raw.replace(TIMESTAMP, '').replace(ANSI, '').replace(JENKINS_LINK, '')).trimEnd();
}

// Strongest marker first: the vitest failure block, then a FAIL line, then compiler/script errors,
// then a lone × or BLOCKED. Progress ticks (× in the running list) come earlier than the block
// that explains them, so they must not win.
const FAILURE_MARKERS = [
  /Failed (Tests|Suites)/,
  /^\s*FAIL\s/,
  /error TS\d|ERROR:|FAILED|Error:|✖/,
  /×|BLOCKED:/,
];
const SUMMARY =
  /Test Files|^\s*Tests\s+\d|verify FAILED|script returned exit code|ERROR:|exit code/;
const PASSING = /^\s*✓/;

/**
 * Picks the part of a console log a reader needs first: from the strongest failure marker to
 * the end, capped in lines and characters, always keeping the final summary lines. Pipeline
 * plumbing, passing-test ticks and empty lines are dropped. Returns null for an empty log.
 */
export function excerptLog(text, limits = EXCERPT_LIMITS) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => !l.includes('[Pipeline]'))
    .map(cleanLine)
    .filter((l) => l.trim().length > 0 && !PASSING.test(l))
    .map((l) => (l.length > LINE_MAX ? l.slice(0, LINE_MAX) + ' …' : l));
  if (lines.length === 0) return null;
  let start = -1;
  for (const marker of FAILURE_MARKERS) {
    start = lines.findIndex((l) => marker.test(l));
    if (start >= 0) break;
  }
  const from = start >= 0 ? start : Math.max(0, lines.length - limits.maxLines);
  const body = lines.slice(from);
  const head = body.slice(0, limits.maxLines);
  const tail = body
    .slice(limits.maxLines)
    .filter((l) => SUMMARY.test(l))
    .slice(-6);
  const dropped = body.length - head.length - tail.length;
  const kept = dropped > 0 ? [...head, `… (${dropped}줄 생략)`, ...tail] : [...head, ...tail];
  let out = kept.join('\n');
  if (out.length > limits.maxChars) out = out.slice(0, limits.maxChars) + '\n… (잘림)';
  return out;
}

/** Test files/names reported as failed by vitest ("FAIL  path > suite > case"). */
export function failedTests(text) {
  const seen = new Set();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = cleanLine(raw).match(/^\s*FAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s*>\s*(.+))?/);
    if (m) seen.add(m[2] ? `${m[1]} > ${m[2].replace(/\s*>\s*/g, ' > ')}` : m[1]);
  }
  return [...seen];
}

/**
 * The controller writes each build's console to $JENKINS_HOME/jobs/<job>/builds/<n>/log; the
 * post step runs on the same host, so the file is readable without an API token. BUILD_LOG_FILE
 * overrides the path (tests). A missing or unreadable file yields null, never an error.
 */
export function readBuildLog(env) {
  try {
    let path = env.BUILD_LOG_FILE || null;
    if (!path && env.JENKINS_HOME && env.JOB_NAME && env.BUILD_NUMBER) {
      const jobPath = String(env.JOB_NAME).split('/').join('/jobs/');
      path = resolve(env.JENKINS_HOME, 'jobs', jobPath, 'builds', String(env.BUILD_NUMBER), 'log');
    }
    if (!path || !existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function buildPayload(env, map, log = readBuildLog(env)) {
  const job = env.JOB_NAME ?? 'jenkins';
  const number = env.BUILD_NUMBER ?? '?';
  const buildUrl = env.BUILD_URL ? `${env.BUILD_URL.replace(/\/?$/, '/')}console` : null;
  const branch = env.gitlabSourceBranch ?? env.GIT_BRANCH ?? env.BRANCH_NAME ?? '(unknown)';
  const sha = env.TAG ?? (env.GIT_COMMIT ? env.GIT_COMMIT.slice(0, 8) : '(unknown)');
  const stage = env.FAILED_STAGE ?? '(unknown)';
  const mrIid = env.gitlabMergeRequestIid ?? '';
  const mrUrl = mrIid && map.mergeRequestBaseUrl ? `${map.mergeRequestBaseUrl}${mrIid}` : null;
  const recipient = resolveRecipient(
    map,
    { email: env.gitlabUserEmail },
    { username: env.gitlabMergedByUser },
    { username: env.gitlabUserUsername },
    { email: env.CULPRIT_EMAIL },
  );
  const who = recipient ? `@${recipient}` : '(수신자 미등록)';
  const lines = [
    `:x: **Jenkins 실패** ${job} #${number} · ${who}`,
    `- 브랜치 \`${branch}\` · 커밋 \`${sha}\` · 실패 단계 **${stage}**`,
  ];
  if (mrUrl) lines.push(`- MR: ${mrUrl}`);
  if (buildUrl) lines.push(`- 콘솔: ${buildUrl}`);
  const failed = failedTests(log);
  if (failed.length) {
    const shown = failed
      .slice(0, 3)
      .map((t) => `\`${t}\``)
      .join(', ');
    const more = failed.length > 3 ? ` 외 ${failed.length - 3}개` : '';
    lines.push(`- 실패 시험: ${shown}${more}`);
  }
  lines.push('- 고친 뒤 같은 브랜치에 push 하면 다시 검증됩니다.');
  const excerpt = excerptLog(log);
  if (excerpt) lines.push('', '**실패 로그 발췌** (전체는 콘솔 링크)', '```', excerpt, '```');
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

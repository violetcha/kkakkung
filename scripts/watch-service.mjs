#!/usr/bin/env node
// S15P21C204-288. Liveness watch from outside the game process. The server cannot report its own
// death, and Docker restarts a container only when its process exits: a hung server stays
// "unhealthy" forever. This script runs on the deploy host from the Jenkins job in
// infra/jenkins/watchdog.Jenkinsfile (host Node 24, no dependencies) and tells the team channel
// when the service stops answering, when Docker had to restart the game server, and when it
// recovers.
//
// Each run inspects kkakkung-game and kkakkung-web and asks the web proxy for /health/live on
// loopback. The judgement is pure (`decideWatch`) and the previous state lives in a small JSON
// file, so one message goes out per transition rather than one per run:
// - DOWN after `downAfterChecks` consecutive failed runs (a deploy recreating the containers
//   between two runs is not an outage), then a reminder every `remindEveryMs` while it lasts;
// - RESTARTED when the same container's RestartCount went up (a deploy creates a new container,
//   so its restarts never count);
// - RECOVERED once a run passes after an announced outage.
// The state is written only after every notice was delivered; a failed delivery is retried by the
// next run. The webhook URL arrives in MM_WEBHOOK (Jenkins Secret text `mattermost-webhook`) and
// is never printed.
//
//   node scripts/watch-service.mjs --state /opt/kkakkung/watchdog-state.json
//   node scripts/watch-service.mjs --test            # one test message, nothing else
//   WATCH_DRY_RUN=1 node scripts/watch-service.mjs --state <file>   # prints, sends and writes nothing
//
// Exit codes: 0 checked (whatever the service state), 1 delivery failed / webhook missing /
// Docker unavailable, 2 usage.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WATCH_POLICY = Object.freeze({
  downAfterChecks: 2,
  remindEveryMs: 60 * 60_000,
  httpTimeoutMs: 5_000,
  sendTimeoutMs: 10_000,
});

export const WATCH_TARGETS = Object.freeze({
  game: 'kkakkung-game',
  web: 'kkakkung-web',
  liveUrl: 'http://127.0.0.1:8080/health/live',
});

export const INITIAL_WATCH_STATE = Object.freeze({
  version: 1,
  failures: 0,
  downSinceMs: null,
  announcedDown: false,
  remindedAtMs: null,
  game: null,
});

/**
 * Pure: turns inspect records and the HTTP probe into problem codes. `game`/`web` are null when
 * the container does not exist and undefined when Docker could not be asked at all.
 */
export function summarize(observation) {
  const problems = [];
  const { game, web, live } = observation;
  if (game === null) problems.push('GAME_MISSING');
  else if (game && !game.running) problems.push('GAME_NOT_RUNNING');
  else if (game && game.health === 'unhealthy') problems.push('GAME_UNHEALTHY');
  if (web === null) problems.push('WEB_MISSING');
  else if (web && !web.running) problems.push('WEB_NOT_RUNNING');
  if (!live.ok) problems.push(live.status ? `LIVE_HTTP_${live.status}` : 'LIVE_UNREACHABLE');
  return { healthy: problems.length === 0, problems };
}

function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

/** Pure message text. Carries codes and durations only. */
export function formatWatchNotice(kind, input) {
  const head = `· ${input.label} (호스트 감시)`;
  const causes = input.problems?.length ? `- 확인된 증상: ${input.problems.join(', ')}` : null;
  const look = '- 확인: `docker ps -a` · `docker logs --since 30m kkakkung-game`';
  switch (kind) {
    case 'DOWN':
      return [
        `:red_circle: **서비스 무응답** ${head}`,
        `- 연속 ${input.failures}회 확인 실패, ${duration(input.lastedMs)} 전부터`,
        causes,
        look,
      ]
        .filter(Boolean)
        .join('\n');
    case 'STILL_DOWN':
      return [
        `:red_circle: **여전히 무응답** ${head}`,
        `- ${duration(input.lastedMs)}째`,
        causes,
        look,
      ]
        .filter(Boolean)
        .join('\n');
    case 'RECOVERED':
      return [
        `:large_green_circle: **서비스 복구** ${head}`,
        `- 약 ${duration(input.lastedMs)} 중단`,
      ].join('\n');
    case 'RESTARTED':
      return [
        `:warning: **게임 서버 비정상 재시작** ${head}`,
        `- 프로세스가 종료돼 Docker가 ${input.delta}회 다시 띄웠다(이 컨테이너 누적 ${input.restartCount}회)`,
        '- 진행 중이던 경기는 복원되지 않는다',
        look,
      ].join('\n');
    case 'TEST':
      return `:information_source: **알림 경로 시험** ${head}\n- 이 메시지가 보이면 전달 경로가 정상이다`;
    default:
      throw new Error(`unknown notice ${kind}`);
  }
}

function readState(value) {
  const s = value && typeof value === 'object' ? value : {};
  const game =
    s.game && typeof s.game.id === 'string' && Number.isSafeInteger(s.game.restartCount)
      ? { id: s.game.id, restartCount: s.game.restartCount }
      : null;
  return {
    version: 1,
    failures: Number.isSafeInteger(s.failures) && s.failures >= 0 ? s.failures : 0,
    downSinceMs: Number.isFinite(s.downSinceMs) ? s.downSinceMs : null,
    announcedDown: s.announcedDown === true,
    remindedAtMs: Number.isFinite(s.remindedAtMs) ? s.remindedAtMs : null,
    game,
  };
}

/**
 * Pure transition. `previous` is whatever was stored (a missing or damaged file behaves as the
 * initial state). Returns the state to store once every notice was delivered.
 */
export function decideWatch(previous, observation, nowMs, options = {}) {
  const policy = { ...WATCH_POLICY, ...options.policy };
  const label = options.label ?? 'kkakkung';
  const prev = readState(previous);
  const { healthy, problems } = summarize(observation);
  const notices = [];
  const game = observation.game;

  // Only the same container restarting counts; a new container id is a deploy, not a crash.
  if (game && prev.game && game.id === prev.game.id && game.restartCount > prev.game.restartCount)
    notices.push({
      kind: 'RESTARTED',
      text: formatWatchNotice('RESTARTED', {
        label,
        delta: game.restartCount - prev.game.restartCount,
        restartCount: game.restartCount,
      }),
    });

  const next = {
    ...prev,
    game: game ? { id: game.id, restartCount: game.restartCount } : prev.game,
    checkedAtMs: nowMs,
    problems,
  };

  if (!healthy) {
    next.failures = prev.failures + 1;
    next.downSinceMs = prev.downSinceMs ?? nowMs;
    const lastedMs = nowMs - next.downSinceMs;
    if (!prev.announcedDown && next.failures >= policy.downAfterChecks) {
      notices.push({
        kind: 'DOWN',
        text: formatWatchNotice('DOWN', { label, failures: next.failures, lastedMs, problems }),
      });
      next.announcedDown = true;
      next.remindedAtMs = nowMs;
    } else if (
      prev.announcedDown &&
      nowMs - (prev.remindedAtMs ?? next.downSinceMs) >= policy.remindEveryMs
    ) {
      notices.push({
        kind: 'STILL_DOWN',
        text: formatWatchNotice('STILL_DOWN', { label, lastedMs, problems }),
      });
      next.remindedAtMs = nowMs;
    }
  } else {
    if (prev.announcedDown)
      notices.push({
        kind: 'RECOVERED',
        text: formatWatchNotice('RECOVERED', {
          label,
          lastedMs: nowMs - (prev.downSinceMs ?? nowMs),
        }),
      });
    next.failures = 0;
    next.downSinceMs = null;
    next.announcedDown = false;
    next.remindedAtMs = null;
  }
  return { healthy, problems, notices, next };
}

// ------------------------------------------------------------------------------------------
// IO shell. Everything below touches Docker, the network or the file system.
// ------------------------------------------------------------------------------------------

function dockerAvailable() {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/** One container: null when it does not exist. */
function inspect(name) {
  let out;
  try {
    out = execFileSync('docker', ['inspect', '--type', 'container', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const record = JSON.parse(out)[0];
  return {
    id: String(record.Id),
    running: record.State?.Running === true,
    health: record.State?.Health?.Status ?? 'none',
    restartCount: Number.isSafeInteger(record.RestartCount) ? record.RestartCount : 0,
  };
}

async function probeLive(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.body?.cancel().catch(() => {});
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function send(webhook, channel, text) {
  const payload = { text, username: 'kkakkung-watchdog' };
  if (channel) payload.channel = channel;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WATCH_POLICY.sendTimeoutMs);
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => {});
    console.log(`notify: Mattermost ${response.status}`);
    return response.ok;
  } catch {
    console.log(`notify: 전송 실패 (${controller.signal.aborted ? 'TIMEOUT' : 'NETWORK'})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function loadState(path) {
  if (!existsSync(path)) return INITIAL_WATCH_STATE;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return INITIAL_WATCH_STATE;
  }
}

function saveState(path, state) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}

function parseArgs(argv) {
  const opt = { state: null, label: 'kkakkung', test: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') opt.state = argv[++i];
    else if (a === '--label') opt.label = argv[++i];
    else if (a === '--test') opt.test = true;
    else return null;
  }
  if (!opt.test && !opt.state) return null;
  return opt;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt) {
    console.error('usage: watch-service.mjs --state <file> [--label <name>] | --test');
    return 2;
  }
  const dryRun = process.env.WATCH_DRY_RUN === '1';
  const webhook = process.env.MM_WEBHOOK;
  const channel = process.env.WATCH_CHANNEL || null;
  if (!dryRun && !webhook) {
    console.log('watch: MM_WEBHOOK 이 없어 알릴 수 없다');
    return 1;
  }
  if (opt.test) {
    const text = formatWatchNotice('TEST', { label: opt.label });
    if (dryRun) {
      console.log(text);
      return 0;
    }
    return (await send(webhook, channel, text)) ? 0 : 1;
  }

  const docker = dockerAvailable();
  const observation = {
    game: docker ? inspect(WATCH_TARGETS.game) : undefined,
    web: docker ? inspect(WATCH_TARGETS.web) : undefined,
    live: await probeLive(WATCH_TARGETS.liveUrl, WATCH_POLICY.httpTimeoutMs),
  };
  const statePath = resolve(opt.state);
  const result = decideWatch(loadState(statePath), observation, Date.now(), { label: opt.label });
  const g = observation.game;
  console.log(
    `watch: ${result.healthy ? 'UP' : 'DOWN'} game=${g === undefined ? '?' : g === null ? 'missing' : `${g.running ? g.health : 'stopped'}(restarts ${g.restartCount})`} ` +
      `web=${observation.web === undefined ? '?' : observation.web === null ? 'missing' : observation.web.running ? 'running' : 'stopped'} ` +
      `live=${observation.live.status ?? 'unreachable'} failures=${result.next.failures} notices=${result.notices.map((n) => n.kind).join(',') || '-'}`,
  );
  if (dryRun) {
    for (const notice of result.notices) console.log(notice.text);
    return docker ? 0 : 1;
  }
  let delivered = true;
  for (const notice of result.notices)
    delivered = (await send(webhook, channel, notice.text)) && delivered;
  // A notice that did not arrive is retried by the next run from the unchanged state.
  if (delivered) saveState(statePath, result.next);
  if (!docker) console.log('watch: docker 에 물을 수 없어 컨테이너 상태를 건너뛰었다');
  return delivered && docker ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly)
  main().then(
    (code) => process.exit(code),
    () => process.exit(1),
  );

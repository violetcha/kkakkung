#!/usr/bin/env node
// Owned by F (F-16 / DP-06). The single deploy entry for Jenkins and for the manual path
// (infra/deploy.sh). It wires real adapters (HTTP, docker compose, docker inspect, the smoke
// runners, the host state files) into scripts/lib/release-sequence.mjs and records every step
// in <evidence>/release.json. The operator token comes only from OPS_TOKEN in the environment
// and is never printed or written; every HTTP/terminal failure is a nonzero exit.
//
//   OPS_TOKEN=... node scripts/deploy-release.mjs --manifest /opt/kkakkung/releases/<tag>.json \
//     --evidence /opt/kkakkung/releases/<tag> --base-url https://j15c204.p.ssafy.io \
//     [--local-url http://127.0.0.1:8080] [--state-dir /opt/kkakkung] [--preflight <file>] \
//     [--compose "infra/compose.yaml infra/compose.production.yaml"] [--drain-timeout-seconds 120]
//
// Exit 0: result READY (product) or DEPLOYED_WITHOUT_OPERATIONS (skeleton profile only).
// Exit 1: FAILED / ROLLED_BACK / PUBLISH_BLOCKED / ROLLBACK_BLOCKED. Exit 3: BLOCKED. Exit 2: usage.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_DEADLINES, runRelease } from './lib/release-sequence.mjs';
import { prepareDeploymentSmoke } from './lib/deployment-smoke-preflight.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const opt = {
  manifest: null,
  evidence: null,
  baseUrl: null,
  localUrl: 'http://127.0.0.1:8080',
  stateDir: '/opt/kkakkung',
  preflight: null,
  compose: 'infra/compose.yaml infra/compose.production.yaml',
  deadlines: { ...DEFAULT_DEADLINES },
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--manifest') opt.manifest = args[++i];
  else if (a === '--evidence') opt.evidence = args[++i];
  else if (a === '--base-url') opt.baseUrl = args[++i];
  else if (a === '--local-url') opt.localUrl = args[++i];
  else if (a === '--state-dir') opt.stateDir = args[++i];
  else if (a === '--preflight') opt.preflight = args[++i];
  else if (a === '--compose') opt.compose = args[++i];
  else if (a === '--drain-timeout-seconds') opt.deadlines.drainMs = Number(args[++i]) * 1000;
  else if (a === '--ready-timeout-seconds') opt.deadlines.readyMs = Number(args[++i]) * 1000;
  else if (a === '--recover-timeout-seconds') opt.deadlines.recoverMs = Number(args[++i]) * 1000;
  else {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
if (
  !opt.manifest ||
  !opt.evidence ||
  !opt.baseUrl ||
  !/^https:\/\/[a-z0-9.-]+$/.test(opt.baseUrl)
) {
  console.error(
    'usage: node scripts/deploy-release.mjs --manifest <file> --evidence <dir> --base-url https://<host> [--local-url http://127.0.0.1:8080] [--state-dir /opt/kkakkung] [--preflight <file>] [--compose "<base> <override>"]',
  );
  process.exit(2);
}
if (!existsSync(opt.manifest)) {
  console.error(`BLOCKED: manifest not found ${opt.manifest}`);
  process.exit(3);
}
const manifest = JSON.parse(readFileSync(opt.manifest, 'utf8'));
const evidenceDir = resolve(opt.evidence);
mkdirSync(evidenceDir, { recursive: true });
const token = process.env.OPS_TOKEN ?? '';
let cloudSmoke;
if (manifest.profile === 'product') {
  try {
    cloudSmoke = prepareDeploymentSmoke({
      root,
      preflightPath: opt.preflight,
      sourceCommit: manifest.releaseSha,
      env: process.env,
      nowEpochMs: Date.now(),
    });
  } catch {
    // Fixed code only: validation errors must not echo arbitrary operator file contents.
    console.error('BLOCKED: DP06_PREFLIGHT_OR_CREDENTIALS_INVALID');
    process.exit(3);
  }
}
const composeFiles = opt.compose.split(/\s+/).filter(Boolean);

const log = (line) => console.log(`[deploy-release ${new Date().toISOString()}] ${line}`);
const writeRelease = (state, outcome = null) =>
  writeFileSync(
    resolve(evidenceDir, 'release.json'),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        releaseSha: manifest.releaseSha,
        tag: manifest.tag,
        profile: manifest.profile,
        previousTag: manifest.previous?.tag ?? null,
        phase: state.phase,
        result: outcome?.result ?? null,
        reason: outcome?.reason ?? null,
        detail: outcome?.detail ?? null,
        lastGoodWritten: outcome?.lastGoodWritten ?? false,
        steps: state.steps,
        isolation: 'GitLab SSO gate (DP-03) stays on before, during and after the release',
        note: 'Bearer token and cookie values are never written here.',
      },
      null,
      2,
    ) + '\n',
  );

const adapters = {
  now: () => Date.now(),
  sleep: (ms) => sleep(ms),
  log,
  onStep: (state) => writeRelease(state),
  async http(method, url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const headers = { accept: 'application/json' };
      if (options.bearer) headers.authorization = `Bearer ${token}`;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'manual',
        signal: controller.signal,
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  },
  async inspectImage(ref) {
    const result = spawnSync(
      'docker',
      [
        'image',
        'inspect',
        '--format',
        '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}',
        ref,
      ],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) return null;
    const [id, revision] = result.stdout.trim().split(/\s+/);
    return { id, revision: revision || null };
  },
  async runningImage(service) {
    const container = service === 'game' ? 'kkakkung-game' : 'kkakkung-web';
    const result = spawnSync('docker', ['inspect', '--format', '{{.Image}}', container], {
      encoding: 'utf8',
    });
    return result.status === 0 ? result.stdout.trim() : null;
  },
  async compose(tag) {
    const composeArgs = ['compose', ...composeFiles.flatMap((f) => ['-f', f]), 'up', '-d'];
    const result = spawnSync('docker', composeArgs, {
      cwd: root,
      env: { ...process.env, TAG: tag },
      stdio: 'inherit',
    });
    return { code: result.status ?? 1 };
  },
  runSmoke(mode) {
    const smokeDir = mode === 'cloud' ? cloudSmoke.evidenceDir : resolve(evidenceDir, 'smoke');
    const cmd =
      mode === 'cloud'
        ? [
            'scripts/run-cloud-check.mjs',
            '--case',
            'DP-06',
            '--preflight',
            opt.preflight,
            '--evidence',
            smokeDir,
          ]
        : ['scripts/deployment-smoke.mjs', '--base-url', opt.baseUrl, '--evidence', smokeDir];
    return new Promise((resolveCode) => {
      // The child inherits the environment (SMOKE_COOKIE / LiveKit names) but stdout is ours.
      const child = spawn(process.execPath, cmd, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, SMOKE_BASE_URL: opt.baseUrl },
      });
      child.on('exit', (code) => resolveCode({ code: code ?? 1 }));
      child.on('error', () => resolveCode({ code: 1 }));
    });
  },
  writeState(name, text) {
    mkdirSync(opt.stateDir, { recursive: true });
    writeFileSync(resolve(opt.stateDir, name), text);
  },
};

const outcome = await runRelease(
  {
    manifest,
    baseUrl: opt.baseUrl,
    localUrl: opt.localUrl,
    opsTokenPresent: token.length > 0,
    smokePreflightPresent: Boolean(opt.preflight && existsSync(opt.preflight)),
    nowEpochMs: () => Date.now(),
    deadlines: opt.deadlines,
  },
  adapters,
);
writeRelease({ phase: outcome.phase, steps: outcome.steps }, outcome);
log(
  `done: result=${outcome.result} phase=${outcome.phase}${outcome.reason ? ` reason=${outcome.reason}` : ''}${outcome.detail ? ` (${outcome.detail})` : ''} evidence=${evidenceDir}`,
);
process.exit(outcome.exitCode);

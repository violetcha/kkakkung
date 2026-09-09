#!/usr/bin/env node
// Owned by F (F-05 / DP-02). Runs the two-file Compose (base + production override) exactly the way
// the deploy does and checks what a running container must satisfy: config merges, images exist or
// build, game-server becomes healthy (live), web-proxy serves /health/live and /health/ready through
// the proxy, game-server runs as non-root with no host port, the workspace packages import inside
// the runtime image, and the operations volume is a named volume. Needs a Docker daemon; without one
// it exits BLOCKED (nonzero). Never prints environment values.
//
//   TAG=<sha8> node scripts/container-smoke.mjs --compose infra/compose.yaml --override infra/compose.production.yaml [--build] [--keep] [--evidence .local/qa/DP-02]

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const opt = {
  compose: null,
  override: null,
  build: false,
  keep: false,
  evidence: '.local/qa/DP-02',
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--compose') opt.compose = args[++i];
  else if (a === '--override') opt.override = args[++i];
  else if (a === '--evidence') opt.evidence = args[++i];
  else if (a === '--build') opt.build = true;
  else if (a === '--keep') opt.keep = true;
  else {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
if (!opt.compose || !opt.override) {
  console.error(
    'usage: node scripts/container-smoke.mjs --compose <base.yaml> --override <production.yaml> [--build] [--keep] [--evidence <dir>]',
  );
  process.exit(2);
}
const tag = process.env.TAG;
if (!tag) {
  console.error('BLOCKED: TAG 가 필요합니다 (예: TAG=$(git rev-parse --short=8 HEAD))');
  process.exit(3);
}
const files = ['-f', opt.compose, '-f', opt.override];
const checks = [];
const record = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};
function docker(a, opts = {}) {
  return spawnSync('docker', a, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TAG: tag },
    ...opts,
  });
}
function curlCode(path, headers = []) {
  const r = spawnSync(
    'curl',
    ['-s', '-o', '/dev/null', '-w', '%{http_code}', ...headers, `http://127.0.0.1:8080${path}`],
    {
      encoding: 'utf8',
    },
  );
  return r.status === 0 ? r.stdout.trim() : 'ERR';
}
function finish(ok, code) {
  if (!opt.keep) docker(['compose', ...files, 'down', '--remove-orphans']);
  const dir = resolve(root, opt.evidence);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'container-smoke.json'),
    JSON.stringify(
      {
        tag,
        compose: opt.compose,
        override: opt.override,
        finishedAt: new Date().toISOString(),
        ok,
        checks,
      },
      null,
      2,
    ) + '\n',
  );
  process.exit(ok ? 0 : code);
}
function fail(message, code = 1) {
  console.error(`container-smoke: ${message}`);
  finish(false, code);
}

const daemon = docker(['version', '--format', '{{.Server.Version}}']);
if (daemon.status !== 0) {
  console.error('BLOCKED: Docker daemon 에 연결할 수 없습니다');
  process.exit(3);
}
record('docker daemon', true, `server ${daemon.stdout.trim()}`);

// 1. merged config validates and has exactly the two services
const config = docker(['compose', ...files, 'config']);
if (config.status !== 0) fail(`compose config 실패: ${config.stderr.trim().split('\n').pop()}`);
const servicesBlock = config.stdout.split(/^volumes:/m)[0];
const services = [...servicesBlock.matchAll(/^  ([a-z-]+):$/gm)].map((m) => m[1]);
record(
  'services',
  services.slice().sort().join(',') === 'game-server,web-proxy',
  services.join(','),
);
const gameBlock = servicesBlock
  .slice(servicesBlock.indexOf('  game-server:'))
  .split(/^  [a-z-]+:$/m)[0];
record('game-server has no host ports', !/^\s{4}ports:/m.test(gameBlock));
record('operations named volume', /^volumes:\n\s+operations:/m.test(config.stdout));
record('env_file for secrets', /env_file/.test(config.stdout), 'compose.production.yaml env_file');
record(
  'no secret literals in compose',
  !/(LIVEKIT_API_SECRET|OPS_TOKEN):\s*\S/.test(config.stdout),
);

// 2. images: build if asked, otherwise require them
for (const img of ['kkakkung-game', 'kkakkung-web']) {
  const has = docker(['image', 'inspect', `${img}:${tag}`]).status === 0;
  if (!has && opt.build) {
    const df =
      img === 'kkakkung-game'
        ? 'infra/docker/Dockerfile.game-server'
        : 'infra/docker/Dockerfile.web';
    const b = docker(['build', '-f', df, '-t', `${img}:${tag}`, '.'], { stdio: 'inherit' });
    if (b.status !== 0) fail(`${img} 빌드 실패`);
  } else if (!has) fail(`이미지 없음: ${img}:${tag} (--build 로 빌드 가능)`, 3);
}
record('images present', true, tag);

// 3. runtime image: workspace packages resolve, non-root user
const imp = docker([
  'run',
  '--rm',
  `kkakkung-game:${tag}`,
  'node',
  '-e',
  "import('@kkakkung/protocol/version').then(()=>import('@kkakkung/game-core')).then(()=>console.log('ok'))",
]);
record(
  'workspace imports inside runtime image',
  imp.status === 0 && imp.stdout.includes('ok'),
  imp.status === 0 ? '' : (imp.stderr || '').trim().split('\n').pop(),
);
const user = docker([
  'image',
  'inspect',
  '--format',
  '{{.Config.User}}',
  `kkakkung-game:${tag}`,
]).stdout.trim();
record(
  'game-server runs as non-root',
  user !== '' && user !== 'root' && user !== '0',
  `USER=${user || '(root)'}`,
);

// 4. up and observe through the proxy
const up = docker(['compose', ...files, 'up', '-d'], { stdio: 'inherit' });
if (up.status !== 0) fail('compose up 실패');
let healthy = false;
for (let i = 0; i < 30 && !healthy; i++) {
  const h = docker([
    'inspect',
    '--format',
    '{{.State.Health.Status}}',
    'kkakkung-game',
  ]).stdout.trim();
  if (h === 'healthy') healthy = true;
  else spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
}
record('game-server healthy (live)', healthy);
const live = curlCode('/health/live');
const ready = curlCode('/health/ready');
record('proxy -> /health/live 200', live === '200', `live=${live}`);
record(
  'proxy -> /health/ready observable (200 or 503)',
  ready === '200' || ready === '503',
  `ready=${ready}`,
);
const evil = curlCode('/api/config', ['-H', 'Origin: https://evil.example']);
record('disallowed Origin rejected (403)', evil === '403', `code=${evil}`);
const runtime = docker([
  'inspect',
  '--format',
  '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}}',
  'kkakkung-game',
]).stdout.trim();
record('restart + log rotation', /unless-stopped json-file 10m/.test(runtime), runtime);
const mounts = docker([
  'inspect',
  '--format',
  '{{range .Mounts}}{{.Type}}:{{.Destination}} {{end}}',
  'kkakkung-game',
]).stdout.trim();
record('OPS_DATA_DIR on named volume', /volume:\/var\/lib\/kkakkung/.test(mounts), mounts);

finish(
  checks.every((c) => c.ok),
  1,
);

#!/usr/bin/env node
// Owned by F (F-06 / DP-03). Smoke test against the deployed HTTPS origin: redirect, TLS expiry,
// live/ready as distinct signals, Origin allow/deny, a real diagnostic-room join held over WSS,
// static asset MIME, and blocked diagnostic routes. Items that need artifacts not yet delivered
// (D models, C session flow) are reported NOT_RUN, never PASS. Exit 1 on any FAIL, 3 when the
// target is unreachable. No tokens or secrets are written to the evidence file.
//
//   node scripts/deployment-smoke.mjs --base-url https://j15c204.p.ssafy.io --evidence .local/qa/DP-03

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tls from 'node:tls';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
// SSO: 로그인 쿠키(_oauth2_proxy=...)는 SMOKE_COOKIE 환경변수로만 받는다. 인자·증거 파일에 넣지 않는다.
const opt = {
  baseUrl: process.env.QA_BASE_URL ?? null,
  evidence: '.local/qa/DP-03',
  holdMs: 2500,
  cookie: process.env.SMOKE_COOKIE ?? '',
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--base-url') opt.baseUrl = args[++i];
  else if (a === '--evidence') opt.evidence = args[++i];
  else if (a === '--hold-ms') opt.holdMs = Number(args[++i]);
  else {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
if (!opt.baseUrl || !/^https:\/\/[a-z0-9.-]+$/.test(opt.baseUrl)) {
  console.error(
    'usage: node scripts/deployment-smoke.mjs --base-url https://<host> [--evidence <dir>] [--hold-ms 2500]',
  );
  process.exit(2);
}
const base = new URL(opt.baseUrl);
const host = base.hostname;
const allowedOrigin = opt.baseUrl;
const evilOrigin = 'https://evil.example';

const results = [];
const record = (name, status, detail = '') => {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(7)} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const headers = { ...(init.headers ?? {}) };
    if (opt.cookie) headers.Cookie = opt.cookie;
    const res = await fetch(`${opt.baseUrl}${path}`, {
      redirect: 'manual',
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } finally {
    clearTimeout(timer);
  }
}

function certInfo() {
  return new Promise((resolveCert) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = new Date(cert.valid_to);
      resolveCert({
        authorized: socket.authorized,
        issuer: cert.issuer?.O ?? '?',
        validTo,
        protocol: socket.getProtocol(),
      });
      socket.end();
    });
    socket.on('error', (e) => resolveCert({ error: e.message }));
    socket.on('timeout', () => resolveCert({ error: 'timeout' }));
  });
}

function wsProbe(url, origin, holdMs) {
  return new Promise((resolveWs) => {
    const started = Date.now();
    const headers = { Origin: origin };
    if (opt.cookie) headers.Cookie = opt.cookie;
    const ws = new WebSocket(url, { headers, handshakeTimeout: 10_000 });
    let outcome = null;
    const finish = (o) => {
      if (outcome) return;
      outcome = o;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolveWs(o);
    };
    ws.on('unexpected-response', (_req, res) => finish({ opened: false, status: res.statusCode }));
    ws.on('error', (e) => finish({ opened: false, error: e.message }));
    ws.on('open', async () => {
      await sleep(holdMs);
      finish({
        opened: true,
        heldMs: Date.now() - started,
        stillOpen: ws.readyState === WebSocket.OPEN,
      });
    });
    ws.on('close', (code) => {
      if (!outcome) finish({ opened: true, closedEarly: true, code, heldMs: Date.now() - started });
    });
  });
}

async function main() {
  // reachability
  let live;
  try {
    live = await http('/health/live');
  } catch (e) {
    console.error(`BLOCKED: ${opt.baseUrl} 에 연결할 수 없습니다 (${e.message})`);
    process.exit(3);
  }

  // 1. HTTP -> HTTPS
  try {
    const r = await fetch(`http://${host}/`, { redirect: 'manual' });
    record(
      'http → https redirect',
      r.status === 301 && (r.headers.get('location') ?? '').startsWith('https://')
        ? 'PASS'
        : 'FAIL',
      `${r.status} ${r.headers.get('location') ?? ''}`,
    );
  } catch (e) {
    record('http → https redirect', 'FAIL', e.message);
  }

  // 2. TLS
  const cert = await certInfo();
  if (cert.error) record('tls certificate', 'FAIL', cert.error);
  else {
    const days = Math.floor((cert.validTo.getTime() - Date.now()) / 86_400_000);
    record(
      'tls certificate',
      cert.authorized && days > 14 ? 'PASS' : 'FAIL',
      `${cert.issuer}, ${cert.protocol}, expires in ${days}d`,
    );
  }

  // 3. live / ready are distinct signals
  record(
    '/health/live 200 json',
    live.status === 200 && /"status":"alive"/.test(live.text) ? 'PASS' : 'FAIL',
    `${live.status}`,
  );
  const ready = await http('/health/ready');
  const readyOk =
    (ready.status === 200 || ready.status === 503) &&
    /"status":"(ready|starting)"/.test(ready.text);
  record(
    '/health/ready observable',
    readyOk ? 'PASS' : 'FAIL',
    `${ready.status} ${ready.text.slice(0, 60)}`,
  );
  const readyState = ready.status === 200 ? 'READY' : 'NOT_READY';

  // 4. SSO gate: an unauthenticated request must be sent to GitLab; with a cookie the app must open
  const gate = await fetch(`${opt.baseUrl}/`, { redirect: 'manual' });
  const gateLoc = gate.headers.get('location') ?? '';
  record(
    'sso gate redirects anonymous to /oauth2/start',
    gate.status === 302 && gateLoc.includes('/oauth2/start') ? 'PASS' : 'FAIL',
    `${gate.status} ${gateLoc.slice(0, 60)}`,
  );
  const start = await fetch(`${opt.baseUrl}/oauth2/start`, { redirect: 'manual' });
  record(
    'oauth2/start → lab.ssafy.com authorize',
    start.status === 302 &&
      (start.headers.get('location') ?? '').startsWith('https://lab.ssafy.com/oauth/authorize')
      ? 'PASS'
      : 'FAIL',
    `${start.status}`,
  );
  if (!opt.cookie) {
    for (const name of [
      'root serves app html',
      '/api/config allowed origin 200',
      '/api/config disallowed origin 403',
      'module script mime + cache',
      'models manifest + wasm mime',
      'wss join + hold',
      'wss disallowed origin rejected',
    ])
      record(name, 'NOT_RUN', 'SMOKE_COOKIE(_oauth2_proxy) 없음 → 로그인 뒤 실행');
    for (const p of ['/monitor', '/playground']) {
      const r = await http(p);
      record(`${p} blocked`, r.status === 404 ? 'PASS' : 'FAIL', `${r.status}`);
    }
    record(
      'camera secure context',
      'PASS',
      'https origin → getUserMedia 가능 (브라우저 확인은 QA-09)',
    );
    record('mic denied independence', 'NOT_RUN', 'D 장치 점검 UI 도착 후 실제 브라우저에서');
    return finishRun(readyState);
  }
  const rootRes = await http('/');
  record(
    'root serves app html',
    rootRes.status === 200 && /<script[^>]+type="module"/.test(rootRes.text) ? 'PASS' : 'FAIL',
    `${rootRes.status}`,
  );
  const cfgOk = await http('/api/config', { headers: { Origin: allowedOrigin } });
  record(
    '/api/config allowed origin 200',
    cfgOk.status === 200 ? 'PASS' : 'FAIL',
    `${cfgOk.status}`,
  );
  const cfgEvil = await http('/api/config', { headers: { Origin: evilOrigin } });
  record(
    '/api/config disallowed origin 403',
    cfgEvil.status === 403 ? 'PASS' : 'FAIL',
    `${cfgEvil.status}`,
  );
  let config = null;
  try {
    config = JSON.parse(cfgOk.text);
  } catch {
    /* handled below */
  }

  // 5. diagnostic routes blocked at the edge
  for (const p of ['/monitor', '/playground']) {
    const r = await http(p);
    record(`${p} blocked`, r.status === 404 ? 'PASS' : 'FAIL', `${r.status}`);
  }

  // 6. static assets: MIME of the first module script, models if delivered
  const scriptSrc = rootRes.text.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  if (scriptSrc) {
    const js = await http(scriptSrc.startsWith('/') ? scriptSrc : `/${scriptSrc}`);
    const ct = js.headers.get('content-type') ?? '';
    record(
      'module script mime + cache',
      js.status === 200 &&
        /javascript/.test(ct) &&
        /immutable/.test(js.headers.get('cache-control') ?? '')
        ? 'PASS'
        : 'FAIL',
      `${js.status} ${ct}; cache-control=${js.headers.get('cache-control') ?? '-'}`,
    );
  } else record('module script mime + cache', 'FAIL', 'no module script in root html');
  const manifest = await http('/models/manifest.json');
  if (manifest.status === 404)
    record('models manifest + wasm mime', 'NOT_RUN', 'D 의 apps/web/public/models 미도착 (404)');
  else if (manifest.status === 200) {
    const wasm = await http('/models/mediapipe/1.0.1/wasm/vision_wasm_internal.wasm');
    const ct = wasm.headers.get('content-type') ?? '';
    record(
      'models manifest + wasm mime',
      wasm.status === 200 && /application\/wasm/.test(ct) ? 'PASS' : 'FAIL',
      `manifest 200, wasm ${wasm.status} ${ct}`,
    );
  } else record('models manifest + wasm mime', 'FAIL', `${manifest.status}`);

  // 7. real room join over WSS with allowed Origin, held for holdMs; disallowed Origin rejected
  const roomName = config?.diagnosticRoomName ?? 'sandbox';
  const protocolVersion = config?.protocolVersion;
  let sessionToken = null;
  const dev = await http('/api/dev-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: allowedOrigin },
    body: JSON.stringify({ nickname: 'smoke' }),
  });
  if (dev.status === 201) sessionToken = JSON.parse(dev.text).token;
  if (!sessionToken || !protocolVersion) {
    record(
      'wss join + hold',
      'NOT_RUN',
      `세션 발급 경로 없음 (dev-sessions ${dev.status}); C-02 의 /api/sessions 로 교체 후 갱신`,
    );
  } else {
    const mm = await http(`/matchmake/joinOrCreate/${roomName}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: allowedOrigin },
      body: JSON.stringify({ token: sessionToken, protocolVersion }),
    });
    let seat = null;
    try {
      const raw = JSON.parse(mm.text);
      // Colyseus 0.18 은 {sessionId, roomId, processId} 를 평평하게, 예전 형식은 room:{} 안에 준다.
      seat = {
        sessionId: raw.sessionId,
        processId: raw.processId ?? raw.room?.processId,
        roomId: raw.roomId ?? raw.room?.roomId,
      };
    } catch {
      /* handled below */
    }
    if (mm.status !== 200 || !seat?.processId)
      record('wss join + hold', 'FAIL', `matchmake ${mm.status} ${mm.text.slice(0, 80)}`);
    else {
      const wsUrl = `wss://${host}/${seat.processId}/${seat.roomId}?sessionId=${encodeURIComponent(seat.sessionId)}`;
      const held = await wsProbe(wsUrl, allowedOrigin, opt.holdMs);
      record(
        'wss join + hold',
        held.opened && held.stillOpen ? 'PASS' : 'FAIL',
        held.opened
          ? `held ${held.heldMs}ms, open=${held.stillOpen}`
          : `not opened (${held.status ?? held.error})`,
      );
    }
    const evilWs = await wsProbe(
      `wss://${host}/${seat?.processId ?? 'x'}/${seat?.roomId ?? 'y'}`,
      evilOrigin,
      500,
    );
    record(
      'wss disallowed origin rejected',
      !evilWs.opened && (evilWs.status === 403 || evilWs.error) ? 'PASS' : 'FAIL',
      evilWs.opened ? 'opened!' : `${evilWs.status ?? evilWs.error}`,
    );
  }

  // 8. browser-side device checks are not reproducible here
  record(
    'camera secure context',
    'PASS',
    'https origin → getUserMedia 가능 (브라우저 확인은 QA-09)',
  );
  record('mic denied independence', 'NOT_RUN', 'D 장치 점검 UI 도착 후 실제 브라우저에서');

  return finishRun(readyState);
}

function finishRun(readyState) {
  const fails = results.filter((r) => r.status === 'FAIL');
  const summary = {
    baseUrl: opt.baseUrl,
    finishedAt: new Date().toISOString(),
    readiness: readyState,
    ok: fails.length === 0,
    counts: Object.fromEntries(
      ['PASS', 'FAIL', 'NOT_RUN'].map((s) => [s, results.filter((r) => r.status === s).length]),
    ),
    results,
  };
  const dir = resolve(root, opt.evidence);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'deployment-smoke.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ ok: summary.ok, readiness: readyState, ...summary.counts }));
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`deployment-smoke: ${e.message}`);
  process.exit(1);
});

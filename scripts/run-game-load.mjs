#!/usr/bin/env node
// Owned by F (F-14 / QA-10). The only entry point that starts real load. Spawns the diagnostic
// game server (A engine + B room, no Cloud), then escalates 1→3→5→10 rooms of six synthetic
// clients that play real rounds (READY → practice → LOAD_READY → PLAYING moves/turns → RESULT →
// REMATCH). Each stage is evaluated with tests/load/GameLoadScenario.ts; a failing stage stops
// the escalation. Evidence (per-stage JSON, client stats, server ndjson) goes to --evidence.
//
//   node scripts/run-game-load.mjs --stages 1,3,5,10 --final-duration-seconds 1800 \
//     --stage-duration-seconds 60 --network "campus Wi-Fi 5GHz, same PC" --evidence .local/qa/QA-10
//
// Exit codes: 0 all stages PASS, 1 a stage FAIL or INCOMPLETE, 2 usage, 3 BLOCKED (server did not
// start / clients could not join). Never contacts LiveKit or any external service.

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { clearInterval, setInterval, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

register();
const root = fileURLToPath(new URL('../', import.meta.url));
const { buildPlan, evaluateStage, stageDuration } =
  await import('../tests/load/GameLoadScenario.ts');
const { GameLoadClient } = await import('../tests/load/GameLoadClient.ts');
// Reuse the server workspace's declared SDK instead of relying on root hoisting.
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const { Client } = serverRequire('@colyseus/sdk');
const { PRODUCT_CLIENT_MESSAGES, PRODUCT_SERVER_MESSAGES } =
  await import('@kkakkung/protocol/game-messages');
const { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } = await import('@kkakkung/protocol/version');

function parseArgs(argv) {
  const opt = {
    stages: '1,3,5,10',
    stageDurationSeconds: '60',
    finalDurationSeconds: null,
    evidence: '.local/qa/QA-10',
    network: null,
    cpuProf: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stages') opt.stages = argv[++i];
    else if (a === '--stage-duration-seconds') opt.stageDurationSeconds = argv[++i];
    else if (a === '--final-duration-seconds') opt.finalDurationSeconds = argv[++i];
    else if (a === '--evidence') opt.evidence = argv[++i];
    else if (a === '--network') opt.network = argv[++i];
    else if (a === '--cpu-prof') opt.cpuProf = true;
    else {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
  }
  if (!opt.finalDurationSeconds) {
    console.error('--final-duration-seconds is required (1800 for the 30-minute diagnosis)');
    process.exit(2);
  }
  if (!opt.network) {
    console.error('--network "<description>" is required: the network condition must be recorded');
    process.exit(2);
  }
  return opt;
}

const opt = parseArgs(process.argv.slice(2));
const plan = buildPlan({
  stages: opt.stages.split(',').map((s) => Number(s.trim())),
  stageDurationSeconds: Number(opt.stageDurationSeconds),
  finalDurationSeconds: Number(opt.finalDurationSeconds),
});
const evidenceDir = resolve(root, opt.evidence);
mkdirSync(evidenceDir, { recursive: true });
const metricsPath = resolve(evidenceDir, 'metrics.ndjson');
if (existsSync(metricsPath)) writeFileSync(metricsPath, '');
const sourceCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();
const sourceWorkingTreeDirty =
  execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim().length > 0;
const lockfileHash = createHash('sha256')
  .update(readFileSync(resolve(root, 'pnpm-lock.yaml')))
  .digest('hex');
const evidenceScope =
  plan.finalDurationSeconds < 1800 || !plan.stages.includes(10)
    ? 'SHORT_GAME_DIAGNOSTIC'
    : 'GAME_LOAD_DIAGNOSTIC';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (message) => console.log(`[run-game-load ${new Date().toISOString()}] ${message}`);

// ---------------------------------------------------------------------------------------
// 1. Diagnostic server (child process owned here). Token is ephemeral and never written.
// ---------------------------------------------------------------------------------------
const opsToken = randomBytes(24).toString('hex');
const server = spawn(
  process.execPath,
  [
    ...(opt.cpuProf ? ['--cpu-prof', '--cpu-prof-dir', resolve(evidenceDir, 'cpu-prof')] : []),
    '--import',
    'tsx',
    resolve(root, 'tests/load/diagnostic-server.ts'),
    '--max-rooms',
    String(Math.max(...plan.stages)),
    '--metrics',
    metricsPath,
  ],
  {
    cwd: root,
    // Only local process support variables are inherited, never LiveKit or operator credentials.
    env: Object.assign(
      Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          [
            'path',
            'systemroot',
            'windir',
            'temp',
            'tmp',
            'home',
            'userprofile',
            'appdata',
            'localappdata',
          ].includes(key.toLowerCase()),
        ),
      ),
      { LOAD_OPS_TOKEN: opsToken },
    ),
    stdio: ['pipe', 'pipe', 'inherit'],
  },
);
const serverPort = await new Promise((resolvePort, reject) => {
  const timer = setTimeout(() => reject(new Error('server start timeout')), 60_000);
  let buffer = '';
  server.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    for (const line of buffer.split('\n')) {
      if (!line.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === 'listening') {
          clearTimeout(timer);
          resolvePort(parsed.port);
        }
      } catch {
        /* partial line */
      }
    }
  });
  server.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
}).catch((error) => {
  console.error(`BLOCKED: ${error.message}`);
  server.kill('SIGKILL');
  process.exit(3);
});
const endpoint = `http://127.0.0.1:${serverPort}`;
log(`diagnostic server pid=${server.pid} port=${serverPort}`);
/** Set the moment the server process exits; a stage in progress then ends at once as FAIL. */
let serverExit = null;
server.on('exit', (code, signal) => {
  serverExit = { code, signal: signal ?? null, atMs: Date.now() };
  log(`server process exited code=${code} signal=${signal ?? '-'}`);
});

async function stopServer() {
  if (server.exitCode !== null) return server.exitCode;
  server.stdin.end();
  const exited = new Promise((r) => server.once('exit', r));
  const result = await Promise.race([exited, sleep(10_000).then(() => 'timeout')]);
  if (result === 'timeout') {
    server.kill('SIGKILL');
    await exited;
  }
  return server.exitCode;
}

// ---------------------------------------------------------------------------------------
// 2. Invitation and sessions through the real HTTP routes.
// ---------------------------------------------------------------------------------------
const issued = await fetch(`${endpoint}/api/operations/invitations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${opsToken}` },
  body: JSON.stringify({
    scope: { allowCreate: true, roomCodes: [] },
    expiresAt: Date.now() + 6 * 3_600_000,
  }),
});
if (issued.status !== 201) {
  console.error(`BLOCKED: invitation issue failed ${issued.status}`);
  await stopServer();
  process.exit(3);
}
const { inviteToken } = await issued.json();

async function createSession(nickname, roomCode) {
  const response = await fetch(`${endpoint}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(
      roomCode
        ? { nickname, inviteToken, createRoom: false, roomCode }
        : { nickname, inviteToken, createRoom: true },
    ),
  });
  if (response.status !== 201) throw new Error(`session ${response.status}`);
  return response.json();
}

const sdk = new Client(endpoint);
/** @type {{ client: import('../tests/load/GameLoadClient.ts').GameLoadClient, room: any }[]} */
const players = [];
let roomsOpen = 0;

async function openRoom(roomIndex) {
  const host = await createSession(`L${roomIndex}-1`);
  const sessions = [host];
  for (let i = 2; i <= 6; i++)
    sessions.push(await createSession(`L${roomIndex}-${i}`, host.roomCode));
  for (const session of sessions) {
    const room = await sdk.joinOrCreate(PRODUCT_ROOM_NAME, {
      token: session.sessionToken,
      roomCode: session.roomCode,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    });
    const client = new GameLoadClient({
      playerId: session.playerId,
      roomIndex,
      transport: { send: (envelope) => room.send(PRODUCT_CLIENT_MESSAGES.command, envelope) },
      createRequestId: randomUUID,
    });
    // Liveness is transport-level: answer every game-heartbeat or the room aborts the match.
    room.onMessage(PRODUCT_SERVER_MESSAGES.heartbeat, (beat) =>
      room.send(PRODUCT_CLIENT_MESSAGES.heartbeatAck, {
        serverEpoch: beat.serverEpoch,
        matchId: beat.matchId,
        heartbeatSeq: beat.heartbeatSeq,
      }),
    );
    room.onMessage(PRODUCT_SERVER_MESSAGES.roomRoster, (roster) => client.onRoster(roster));
    room.onMessage(PRODUCT_SERVER_MESSAGES.privateView, (view) => client.onView(view));
    room.onMessage(PRODUCT_SERVER_MESSAGES.commandResult, (receipt) =>
      client.onReceipt(receipt, Date.now()),
    );
    room.onMessage(PRODUCT_SERVER_MESSAGES.commandOutcome, (outcome) => client.onOutcome(outcome));
    room.onMessage('*', () => undefined);
    players.push({ client, room });
  }
  roomsOpen += 1;
}

// One timer drives every client: observe public state, then let the machine emit.
const driver = setInterval(() => {
  const now = Date.now();
  for (const { client, room } of players) {
    const state = room.state;
    client.observe(
      {
        phase: state?.phase ?? 'LOBBY',
        matchId: state?.matchId ?? null,
        abortReason: state?.abortReason ?? null,
      },
      now,
    );
    client.advance(now);
  }
}, 50);

function readServerWindow(fromWallMs, toWallMs) {
  const lagMs = [];
  const eventLoopDelayP99Ms = [];
  const cpuRatio = [];
  const tickDuration = [];
  const rss = [];
  let overloads = 0;
  let catchups = 0;
  if (!existsSync(metricsPath)) return null;
  for (const line of readFileSync(metricsPath, 'utf8').split('\n')) {
    if (!line) continue;
    let s;
    try {
      s = JSON.parse(line);
    } catch {
      continue;
    }
    if (s.wallMs < fromWallMs || s.wallMs > toWallMs) continue;
    if (s.name === 'eventLoop.lag') lagMs.push(s.value);
    else if (s.name === 'diag.eventLoopDelayP99') eventLoopDelayP99Ms.push(s.value);
    else if (s.name === 'diag.cpuRatio') cpuRatio.push(s.value);
    else if (s.name === 'tick.duration') tickDuration.push({ atMs: s.atMs, value: s.value });
    // The coordinator emits value 1 per overload; the room repeats the event with the lag as value.
    else if (s.name === 'tick.overload' && s.value === 1) overloads += 1;
    else if (s.name === 'tick.catchup') catchups += s.value;
    else if (s.name === 'process.memory') rss.push({ atMs: s.wallMs, value: s.value });
  }
  return { lagMs, eventLoopDelayP99Ms, cpuRatio, tickDuration, overloads, catchups, rss };
}

// ---------------------------------------------------------------------------------------
// 3. Stages.
// ---------------------------------------------------------------------------------------
const stageResults = [];
let exitCode = 0;
try {
  for (const [index, rooms] of plan.stages.entries()) {
    while (roomsOpen < rooms) await openRoom(roomsOpen + 1);
    for (const { client } of players) client.resetStage();
    const seconds = stageDuration(plan, index);
    log(
      `stage ${index + 1}/${plan.stages.length}: ${rooms} rooms, ${players.length} clients, ${seconds}s`,
    );
    const startedAt = Date.now();
    const deadline = startedAt + seconds * 1000;
    while (Date.now() < deadline && !serverExit) {
      await sleep(Math.min(5000, deadline - Date.now()));
      const pending = players.reduce((sum, p) => sum + p.client.pendingCount(), 0);
      const phases = new Set(players.map((p) => p.room.state?.phase));
      log(
        `  t+${Math.round((Date.now() - startedAt) / 1000)}s phases=${[...phases].join('/')} pendingAcks=${pending}`,
      );
    }
    const endedAt = Date.now();
    const elapsedSeconds = (endedAt - startedAt) / 1000;
    if (serverExit)
      log(
        `  server exited at t+${Math.round((serverExit.atMs - startedAt) / 1000)}s; stage ends early (${Math.round(elapsedSeconds)}s of ${seconds}s)`,
      );
    const result = evaluateStage(
      {
        rooms,
        durationSeconds: serverExit ? elapsedSeconds : seconds,
        serverExit: serverExit
          ? { code: serverExit.code, afterSeconds: (serverExit.atMs - startedAt) / 1000 }
          : null,
        clients: players.map((p) => p.client.stats()),
        server: readServerWindow(startedAt, endedAt),
      },
      endedAt,
    );
    const record = {
      ...result,
      startedAt,
      endedAt,
      network: opt.network,
      sourceCommit,
      sourceWorkingTreeDirty,
      lockfileHash,
      evidenceScope,
    };
    writeFileSync(
      resolve(evidenceDir, `clients-${rooms}-rooms.json`),
      JSON.stringify(
        players.map((p) => {
          const stats = p.client.stats();
          return { ...stats, ackLatenciesMs: undefined, ackCount: stats.ackLatenciesMs.length };
        }),
        null,
        2,
      ) + '\n',
    );
    stageResults.push(record);
    writeFileSync(
      resolve(evidenceDir, `stage-${rooms}-rooms.json`),
      JSON.stringify(record, null, 2) + '\n',
    );
    log(`  result ${result.status}${result.stopEscalation ? ' (stop escalation)' : ''}`);
    for (const c of result.checks)
      log(
        `    ${c.status.padEnd(12)} ${c.name} value=${c.value === null ? '-' : Number(c.value).toFixed(2)} limit=${c.limit ?? '-'}`,
      );
    if (result.status !== 'PASS') exitCode = 1;
    if (result.stopEscalation) {
      log('escalation stopped by failing stage');
      break;
    }
  }
} catch (error) {
  console.error(`BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 3;
} finally {
  clearInterval(driver);
  const serverExitCode = await stopServer();
  // Leaving rooms once the server is gone would wait on SDK reconnection forever, and a hung
  // leave used to keep run.json from ever being written; cap it and skip it after a server exit.
  if (!serverExit)
    await Promise.race([Promise.allSettled(players.map((p) => p.room.leave())), sleep(5000)]);
  writeFileSync(
    resolve(evidenceDir, 'run.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceCommit,
        sourceWorkingTreeDirty,
        lockfileHash,
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
        evidenceScope,
        network: opt.network,
        plan,
        stages: stageResults.map((s) => ({
          rooms: s.rooms,
          status: s.status,
          durationSeconds: s.durationSeconds,
        })),
        cloudRequests: 0,
        serverExitCode,
        serverExit,
        clientsLeftOpen: players.filter((p) => p.room.connection?.isOpen).length,
        note: 'game-only diagnosis; not G6 media integration evidence',
      },
      null,
      2,
    ) + '\n',
  );
  log(`done: exit=${exitCode} serverExit=${serverExitCode} evidence=${evidenceDir}`);
}
process.exit(exitCode);

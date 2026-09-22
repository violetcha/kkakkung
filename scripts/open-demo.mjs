#!/usr/bin/env node
// Opens one operator demo room (S15P21C204-258) and prints or stores the address to open.
// OPS_TOKEN / SMOKE_COOKIE come from the operator environment, never CLI arguments: command
// line arguments are visible in the process list to every user on the machine.
//
// The address carries a live session token, so it is printed only when the operator is running
// the service themselves (loopback). Any other target must name a private --output file, the
// same rule scripts/issue-team-invitation.mjs follows.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isLoopback, openDemoRoom } from './lib/demo-room.mjs';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';

try {
  const args = process.argv.slice(2);
  const opt = {};
  const allowed = new Set(['--base-url', '--public-url', '--role', '--nickname', '--output']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i]) || !args[i + 1]) throw new Error('ARGUMENTS_INVALID');
    opt[args[i]] = args[++i];
  }
  // S15P21C204-312. A missing role used to reach the server and come back as a generic failure.
  if (!['runner', 'tagger'].includes(opt['--role'] ?? '')) throw new Error('ROLE_REQUIRED');
  // Both decided before the request: a room that is opened and then not handed over wastes a seat
  // from the room budget and leaves a live session nobody can use.
  if (opt['--output']) {
    // The write itself refuses to overwrite; finding that out afterwards costs a room.
    if (existsSync(resolve(opt['--output']))) throw new Error('OUTPUT_EXISTS');
  } else {
    let printable = false;
    try {
      printable = isLoopback(new URL(opt['--public-url'] ?? ''));
    } catch {
      printable = false;
    }
    if (!printable) throw new Error('OUTPUT_REQUIRED');
  }
  const result = await openDemoRoom({
    baseUrl: opt['--base-url'],
    publicUrl: opt['--public-url'],
    role: opt['--role'],
    nickname: opt['--nickname'],
    opsToken: process.env.OPS_TOKEN,
    cookie: process.env.SMOKE_COOKIE,
    protocolVersion: PRODUCT_PROTOCOL_VERSION,
  });
  if (opt['--output']) {
    const output = resolve(opt['--output']);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(
      `DEMO_ROOM_WRITTEN ${result.roomCode} ${result.role}: open the private output file.`,
    );
  } else {
    console.log(`room ${result.roomCode} · ${result.role} · operator ${result.playerId}`);
    // The operator reads this on the spot, in Korea: KST, and how long is left to open the link.
    const kst = new Date(result.expiresAt + 9 * 3_600_000).toISOString().slice(0, 19);
    const minutes = Math.max(0, Math.round((result.expiresAt - Date.now()) / 60_000));
    console.log(`open by ${kst.replace('T', ' ')} KST (in ${minutes} min)`);
    console.log(result.url);
  }
} catch (error) {
  // The message names the step, never the token, the address or the response body.
  const reason = error instanceof Error ? error.message : 'UNKNOWN';
  const hint =
    reason === 'ROLE_REQUIRED'
      ? 'give --role runner or --role tagger'
      : reason === 'OUTPUT_REQUIRED'
        ? 'a non-loopback target must write the address to a private --output file'
        : reason === 'OUTPUT_EXISTS'
          ? 'the --output file already exists; name a new one so an earlier address is not lost'
          : reason.includes('DEMO_UNAVAILABLE')
            ? 'the deployment runs with DEMO_ROOMS=0'
            : reason.includes('CAPACITY')
              ? 'the room budget is full; close the open demo room or raise MAX_ROOMS'
              : reason.startsWith('DEMO_ROOM_REJECTED:401')
                ? 'OPS_TOKEN is missing or wrong'
                : 'check OPS_TOKEN, the target URLs and the role (runner or tagger)';
  console.error(`DEMO_ROOM_FAILED (${reason}): ${hint}.`);
  process.exitCode = 1;
}

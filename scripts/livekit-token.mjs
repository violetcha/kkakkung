#!/usr/bin/env node
// Owned by F (F-01). Mint a short-lived LiveKit access token for the synthetic probe
// (tests/cloud/probe.html) or for a QA runner. Reads LIVEKIT_API_KEY / LIVEKIT_API_SECRET from
// the process environment, falling back to server/.env (never committed). Prints the token only;
// never prints the key or secret.
//
//   pnpm livekit:token --room kkakkung-qa-mc01 --identity synthetic-1 [--ttl 600] [--publish] [--subscribe]

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessToken } from 'livekit-server-sdk';

const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = resolve(root, 'server/.env');
if (!process.env.LIVEKIT_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const opt = { room: null, identity: null, ttl: 600, publish: false, subscribe: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--room') opt.room = args[++i];
  else if (a === '--identity') opt.identity = args[++i];
  else if (a === '--ttl') opt.ttl = Number(args[++i]);
  else if (a === '--publish') opt.publish = true;
  else if (a === '--subscribe') opt.subscribe = true;
  else {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
if (!opt.room || !opt.identity || !Number.isInteger(opt.ttl) || opt.ttl <= 0 || opt.ttl > 3600) {
  console.error(
    'usage: pnpm livekit:token --room <name> --identity <id> [--ttl <1..3600>] [--publish] [--subscribe]',
  );
  process.exit(2);
}
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
if (!key || !secret) {
  console.error(
    'BLOCKED: LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set (environment or server/.env)',
  );
  process.exit(3);
}
const token = new AccessToken(key, secret, { identity: opt.identity, ttl: opt.ttl });
token.addGrant({
  room: opt.room,
  roomJoin: true,
  canPublish: opt.publish,
  canSubscribe: opt.subscribe,
  canPublishData: false,
});
process.stdout.write((await token.toJwt()) + '\n');

#!/usr/bin/env node
// OPS_TOKEN / SMOKE_COOKIE come from the operator environment, never CLI arguments.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { issueTeamInvitation } from './lib/team-invitation.mjs';
try {
  const args = process.argv.slice(2);
  const opt = {};
  const allowed = new Set([
    '--base-url',
    '--public-url',
    '--expires-at',
    '--room-code',
    '--output',
  ]);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i]) || !args[i + 1]) throw new Error('ARGUMENTS_INVALID');
    opt[args[i]] = args[++i];
  }
  if (!opt['--output']) throw new Error('OUTPUT_REQUIRED');
  const result = await issueTeamInvitation({
    baseUrl: opt['--base-url'],
    publicUrl: opt['--public-url'],
    expiresAt: Number(opt['--expires-at']),
    roomCode: opt['--room-code'],
    opsToken: process.env.OPS_TOKEN,
    cookie: process.env.SMOKE_COOKIE,
  });
  const output = resolve(opt['--output']);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('INVITATION_WRITTEN: open the private output file; do not attach it to logs or MR.');
} catch {
  console.error('INVITATION_FAILED: check authorization, readiness, expiry and output path.');
  process.exitCode = 1;
}

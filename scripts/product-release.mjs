#!/usr/bin/env node
// node --import tsx scripts/product-release.mjs --env-file <private file> --evidence-dir <approved dir>
// --preflight <approved DP-06 file> --sha <verified SHA> [--check-only]
import { parseEnv } from 'node:util';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkProductDeployment } from '../server/src/config/ProductDeployment.ts';
import { deriveDeploymentPreflight } from './lib/deployment-smoke-preflight.mjs';

const args = process.argv.slice(2);
const opt = { baseUrl: 'https://j15c204.p.ssafy.io', stateDir: '/opt/kkakkung' };
const keys = {
  '--env-file': 'envFile',
  '--evidence-dir': 'evidenceDir',
  '--preflight': 'preflight',
  '--sha': 'sha',
  '--base-url': 'baseUrl',
  '--state-dir': 'stateDir',
};
let stage = 'ARGUMENTS_OR_ENV';
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check-only') {
      opt.checkOnly = true;
      continue;
    }
    if (!keys[args[i]] || !args[i + 1]) throw new Error('ARGUMENTS_INVALID');
    opt[keys[args[i]]] = args[++i];
  }
  if (!opt.envFile || !opt.evidenceDir || !opt.preflight || !/^[a-f0-9]{40}$/.test(opt.sha ?? ''))
    throw new Error('ARGUMENTS_MISSING');
  // Parse data, never source shell code; do not print the private environment or child errors.
  if (statSync(opt.envFile).size > 64 * 1024) throw new Error('ENV_FILE_TOO_LARGE');
  const privateEnv = parseEnv(readFileSync(opt.envFile, 'utf8'));
  const allowed =
    /^(LIVEKIT_|OPS_|MEDIA_|INVITE_|SESSION_|ROOM_IDLE_|SERVICE_NAMESPACE$|SMOKE_INTERNAL_TOKEN$|SMOKE_INTERNAL_BASE_URL$)/;
  const env = { ...process.env };
  for (const [key, value] of Object.entries(privateEnv)) if (allowed.test(key)) env[key] = value;
  env.OPS_EVIDENCE_DIR = resolve(opt.evidenceDir);
  env.SMOKE_PUBLIC_BASE_URL = opt.baseUrl;
  stage = 'PRODUCT_EVIDENCE';
  const prepared = await checkProductDeployment({
    env,
    baseUrl: opt.baseUrl,
    evidenceDir: opt.evidenceDir,
    nowEpochMs: Date.now(),
  });
  if (prepared.status !== 'PREPARED') {
    console.error(JSON.stringify(prepared));
    process.exit(3);
  }
  const preflight = JSON.parse(readFileSync(opt.preflight, 'utf8'));
  if (
    preflight.namespace !== (env.SERVICE_NAMESPACE || 'kkakkung-ec2') ||
    preflight.projectAlias !== env.LIVEKIT_PROJECT_ALIAS
  )
    throw new Error('SCOPE_MISMATCH');
  stage = 'PREFLIGHT';
  const runPreflight = deriveDeploymentPreflight({
    root: process.cwd(),
    preflightPath: opt.preflight,
    sourceCommit: opt.sha,
    env,
    nowEpochMs: Date.now(),
  });
  if (opt.checkOnly) {
    console.log(JSON.stringify({ status: 'PREPARED', cloudExecuted: false, deployed: false }));
  } else {
    const state = resolve(opt.stateDir);
    const manifest = resolve(state, 'releases', opt.sha.slice(0, 8) + '.json');
    const runPreflightPath = resolve(state, 'releases', opt.sha.slice(0, 8) + '-preflight.json');
    mkdirSync(resolve(state, 'releases'), { recursive: true });
    writeFileSync(runPreflightPath, JSON.stringify(runPreflight, null, 2) + '\n', { mode: 0o600 });
    const run = (command) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', ...command], {
        env,
        stdio: 'inherit',
      });
      if (result.status !== 0) process.exit(result.status ?? 1);
    };
    run([
      'scripts/verify-release.mjs',
      '--sha',
      opt.sha,
      '--tag',
      opt.sha.slice(0, 8),
      '--verified-sha',
      opt.sha,
      '--profile',
      'product',
      '--state-dir',
      state,
      '--output',
      manifest,
      '--official-budget-max-age-ms',
      env.OPS_OFFICIAL_BUDGET_MAX_AGE_MS,
    ]);
    run([
      'scripts/deploy-release.mjs',
      '--manifest',
      manifest,
      '--evidence',
      resolve(state, 'releases', opt.sha.slice(0, 8)),
      '--base-url',
      opt.baseUrl,
      '--state-dir',
      state,
      '--preflight',
      runPreflightPath,
    ]);
  }
} catch {
  console.error(`BLOCKED: PRODUCT_DEPLOYMENT_INPUT_INVALID stage=${stage}`);
  process.exitCode = 3;
}

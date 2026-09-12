#!/usr/bin/env node
// Owned by F (F-16 / DP-06). Builds the release manifest that deploy-release.mjs consumes, from
// the commit Jenkins just verified and the two images it built for that commit. It only reads:
// it never builds an image, never guesses a commit from a tag, and refuses when either image is
// missing or carries a different revision label. The previous release comes from the host's
// last-good records so a rollback can check digests instead of trusting a tag.
//
//   node scripts/verify-release.mjs --sha <40hex> --tag <8hex> --verified-sha <40hex> \
//     --profile skeleton|product --state-dir /opt/kkakkung --output /opt/kkakkung/releases/<tag>.json
//
// Exit 0 with the manifest written, 2 on usage, 3 when the images for that commit do not exist
// (build and verify that commit through Jenkins; do not repackage the current checkout).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { validateManifest } from './lib/release-sequence.mjs';

const IMAGES = Object.freeze({ game: 'kkakkung-game', web: 'kkakkung-web' });

export function inspectImageWithDocker(ref) {
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
}

/** Parses the host's last-good records into the manifest's `previous` block, or null. */
export function readPrevious(readState) {
  const tag = (readState('last-good-tag') ?? '').trim();
  const digestText = readState('last-good-digest') ?? '';
  if (!/^[0-9a-f]{8}$/.test(tag)) return null;
  const digests = {};
  for (const line of digestText.split('\n')) {
    const [name, digest] = line.trim().split(/\s+/);
    if ((name === 'game' || name === 'web') && /^sha256:[0-9a-f]{64}$/.test(digest ?? ''))
      digests[name] = { digest };
  }
  if (!digests.game || !digests.web) return null;
  const recordedProfile = (readState('last-good-profile') ?? '').trim();
  let profile = ['product', 'skeleton'].includes(recordedProfile) ? recordedProfile : undefined;
  // Compatibility with last-good records written before profile was recorded separately.
  if (!profile) {
    try {
      const old = JSON.parse(readState(`releases/${tag}.json`) ?? 'null');
      if (
        old?.tag === tag &&
        ['product', 'skeleton'].includes(old.profile) &&
        old.images?.game?.digest === digests.game.digest &&
        old.images?.web?.digest === digests.web.digest
      )
        profile = old.profile;
    } catch {
      /* Missing/invalid history never grants migration permission. */
    }
  }
  let policy = {};
  try {
    const old = JSON.parse(readState(`releases/${tag}.json`) ?? 'null');
    if (
      old?.tag === tag &&
      old.images?.game?.digest === digests.game.digest &&
      old.images?.web?.digest === digests.web.digest
    ) {
      if (['attested', 'continuous'].includes(old.operatingMode))
        policy.operatingMode = old.operatingMode;
      if (Number.isSafeInteger(old.officialBudgetMaxAgeMs) && old.officialBudgetMaxAgeMs > 0)
        policy.officialBudgetMaxAgeMs = old.officialBudgetMaxAgeMs;
    }
  } catch {
    /* Only matched release history can select rollback policy. */
  }
  return { tag, images: digests, ...(profile ? { profile } : {}), ...policy };
}

/**
 * Pure manifest assembly. `inspect(ref)` returns `{ id, revision }` or null; `readState(name)`
 * returns the file text or null. Returns `{ manifest }` or `{ error, detail }`.
 */
export function buildManifest(inputs, inspect, readState) {
  const images = {};
  for (const [key, name] of Object.entries(IMAGES)) {
    const ref = `${name}:${inputs.tag}`;
    const image = inspect(ref);
    if (!image) return { error: 'IMAGE_MISSING', detail: ref };
    images[key] = { ref, digest: image.id, revision: image.revision };
  }
  const manifest = {
    releaseSha: inputs.sha,
    tag: inputs.tag,
    verifiedSha: inputs.verifiedSha,
    profile: inputs.profile,
    ...(inputs.operatingMode ? { operatingMode: inputs.operatingMode } : {}),
    images,
    previous: readPrevious(readState),
    officialBudgetMaxAgeMs: inputs.officialBudgetMaxAgeMs ?? null,
    createdAt: new Date(inputs.nowEpochMs ?? Date.now()).toISOString(),
  };
  const issues = validateManifest(manifest);
  if (issues.length) return { error: 'MANIFEST_INVALID', detail: issues.join('; ') };
  return { manifest };
}

function parseArgs(argv) {
  const out = { profile: 'skeleton', stateDir: '/opt/kkakkung', officialBudgetMaxAgeMs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--sha') out.sha = argv[++i];
    else if (a === '--tag') out.tag = argv[++i];
    else if (a === '--verified-sha') out.verifiedSha = argv[++i];
    else if (a === '--profile') out.profile = argv[++i];
    else if (a === '--state-dir') out.stateDir = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--official-budget-max-age-ms') out.officialBudgetMaxAgeMs = Number(argv[++i]);
    else if (a === '--operating-mode') out.operatingMode = argv[++i];
    else {
      console.error(`unknown argument ${a}${v ? '' : ''}`);
      process.exit(2);
    }
  }
  if (!out.sha || !out.tag || !out.verifiedSha || !out.output) {
    console.error(
      'usage: node scripts/verify-release.mjs --sha <40hex> --tag <8hex> --verified-sha <40hex> [--profile skeleton|product] [--state-dir /opt/kkakkung] [--official-budget-max-age-ms N] --output <file>',
    );
    process.exit(2);
  }
  return out;
}

// CLI only when executed directly; tests import buildManifest/readPrevious without side effects.
if (basename(process.argv[1] ?? '') === 'verify-release.mjs') {
  const opt = parseArgs(process.argv.slice(2));
  const readState = (name) => {
    const file = resolve(opt.stateDir, name);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
  const built = buildManifest(opt, inspectImageWithDocker, readState);
  if (built.error) {
    console.error(`BLOCKED: ${built.error} ${built.detail}`);
    if (built.error === 'IMAGE_MISSING')
      console.error(
        '해당 커밋의 이미지가 없습니다. 그 커밋을 Jenkins 로 검증·빌드하세요. 현재 체크아웃을 이전 SHA 태그로 포장하지 않습니다.',
      );
    process.exit(3);
  }
  mkdirSync(dirname(resolve(opt.output)), { recursive: true });
  writeFileSync(resolve(opt.output), JSON.stringify(built.manifest, null, 2) + '\n');
  console.log(
    `verify-release: ${opt.tag} profile=${opt.profile} previous=${built.manifest.previous?.tag ?? 'none'} → ${opt.output}`,
  );
}

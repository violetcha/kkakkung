#!/usr/bin/env node
// Owned by F (F-04 / DP-04). Removes old release image tags after a successful build without
// touching a tag another build may still be using.
//
// Why the age guard: kkakkung #140 built kkakkung-web:c458e647 while kkakkung-mr #167 was finishing.
// #167's success step listed `docker images` (sorted by image *creation* time), and because the new
// tag had been attached to a cache-hit image created 25 minutes earlier it sorted as old and was
// removed one second before #140's Trivy scan looked for it. A tag is therefore only removable when
// its image was last tagged more than --min-age-minutes ago, on top of keeping the newest --keep
// tags, every --protect tag and the tags of running containers (also when they run by image ID).
//
//   node scripts/prune-release-images.mjs --keep 5 --min-age-minutes 60 \
//     --protect <tag> [--protect <tag>] [--dry-run] kkakkung-game kkakkung-web

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_KEEP = 5;
export const DEFAULT_MIN_AGE_MINUTES = 60;

/** Parses Docker's `{{json .Metadata.LastTagTime}}` (RFC 3339, up to nanoseconds). */
export function parseDockerTime(text) {
  const trimmed = String(text)
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/, '$1');
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) throw new Error(`unreadable docker time: ${text}`);
  return ms;
}

/**
 * Decides which tags to remove. `images` is [{ tag, lastTagTimeMs }] for one repository.
 * Newest `keep` tags (by last tag time) stay; the rest stay when protected or younger than minAgeMs.
 */
export function planPrune({ images, keep, minAgeMs, protect, nowMs }) {
  const protectedTags = new Set(protect.filter((tag) => typeof tag === 'string' && tag !== ''));
  const sorted = images
    .filter((image) => image.tag !== '<none>')
    .sort((a, b) => b.lastTagTimeMs - a.lastTagTimeMs);
  const remove = [];
  const kept = [];
  sorted.forEach((image, index) => {
    const reason =
      index < keep
        ? 'recent'
        : protectedTags.has(image.tag)
          ? 'protected'
          : nowMs - image.lastTagTimeMs < minAgeMs
            ? 'young'
            : null;
    if (reason) kept.push({ ...image, reason });
    else remove.push(image);
  });
  return { remove, kept };
}

export function parseArgs(argv) {
  const options = {
    keep: DEFAULT_KEEP,
    minAgeMinutes: DEFAULT_MIN_AGE_MINUTES,
    protect: [],
    dryRun: false,
    repositories: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep') options.keep = Number(argv[++i]);
    else if (arg === '--min-age-minutes') options.minAgeMinutes = Number(argv[++i]);
    else if (arg === '--protect') options.protect.push(argv[++i] ?? '');
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else options.repositories.push(arg);
  }
  if (!Number.isInteger(options.keep) || options.keep < 1) throw new Error('--keep must be >= 1');
  if (!Number.isFinite(options.minAgeMinutes) || options.minAgeMinutes < 0)
    throw new Error('--min-age-minutes must be >= 0');
  if (options.repositories.length === 0)
    throw new Error('at least one image repository is required');
  return options;
}

const docker = (args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function listImages(repository) {
  const tags = docker(['images', repository, '--format', '{{.Tag}}'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((tag) => tag !== '' && tag !== '<none>');
  return tags.map((tag) => ({
    tag,
    lastTagTimeMs: parseDockerTime(
      docker([
        'image',
        'inspect',
        `${repository}:${tag}`,
        '--format',
        '{{json .Metadata.LastTagTime}}',
      ]),
    ),
  }));
}

/**
 * Tags of `repository` that running containers use. `images` is `docker ps {{.Image}}` output.
 * S15P21C204-383: releases run by image ID (`sha256:...`, see deploy-release.mjs), which the
 * repository prefix never matched, so those containers protected nothing. An ID is resolved to
 * its tags with `tagsOf`.
 */
export function runningTagsFrom(images, repository, tagsOf) {
  const prefix = `${repository}:`;
  const tags = new Set();
  for (const line of String(images).split(/\r?\n/)) {
    const image = line.trim();
    if (image.startsWith(prefix)) tags.add(image.slice(prefix.length));
    else if (/^(sha256:)?[0-9a-f]{12,64}$/.test(image))
      for (const ref of tagsOf(image))
        if (ref.startsWith(prefix)) tags.add(ref.slice(prefix.length));
  }
  return [...tags];
}

function runningTags(repository) {
  const tagsOf = (id) => {
    try {
      const refs = JSON.parse(docker(['image', 'inspect', id, '--format', '{{json .RepoTags}}']));
      return Array.isArray(refs) ? refs : [];
    } catch {
      return [];
    }
  };
  return runningTagsFrom(docker(['ps', '--format', '{{.Image}}']), repository, tagsOf);
}

export function main(argv, { log = console.log, nowMs = Date.now() } = {}) {
  const options = parseArgs(argv);
  let removed = 0;
  for (const repository of options.repositories) {
    const plan = planPrune({
      images: listImages(repository),
      keep: options.keep,
      minAgeMs: options.minAgeMinutes * 60_000,
      protect: [...options.protect, ...runningTags(repository)],
      nowMs,
    });
    for (const image of plan.kept) log(`prune: keep ${repository}:${image.tag} (${image.reason})`);
    for (const image of plan.remove) {
      const ageMinutes = Math.round((nowMs - image.lastTagTimeMs) / 60_000);
      if (options.dryRun) {
        log(`prune: would remove ${repository}:${image.tag} (last tagged ${ageMinutes}m ago)`);
        continue;
      }
      try {
        docker(['rmi', `${repository}:${image.tag}`]);
        removed += 1;
        log(`prune: removed ${repository}:${image.tag} (last tagged ${ageMinutes}m ago)`);
      } catch (error) {
        log(
          `prune: skip ${repository}:${image.tag} (${error instanceof Error ? error.message.trim() : error})`,
        );
      }
    }
  }
  return removed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`prune: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

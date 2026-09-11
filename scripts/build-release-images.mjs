#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inspectImageWithDocker } from './verify-release.mjs';

/** An existing commit tag is immutable: reuse it or fail, never overwrite it. */
export function buildReleaseImages(sha, inspect, build) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('INVALID_RELEASE_SHA');
  for (const [name, file] of [
    ['kkakkung-game', 'infra/docker/Dockerfile.game-server'],
    ['kkakkung-web', 'infra/docker/Dockerfile.web'],
  ]) {
    const ref = `${name}:${sha.slice(0, 8)}`;
    const existing = inspect(ref);
    if (existing && existing.revision !== sha) throw new Error('EXISTING_IMAGE_REVISION_MISMATCH');
    if (!existing) {
      if (build(file, ref, sha) !== 0) throw new Error('IMAGE_BUILD_FAILED');
      if (inspect(ref)?.revision !== sha) throw new Error('BUILT_IMAGE_REVISION_MISMATCH');
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    buildReleaseImages(
      process.argv[2],
      inspectImageWithDocker,
      (file, ref, sha) =>
        spawnSync(
          'docker',
          [
            'build',
            '-f',
            file,
            '-t',
            ref,
            '--label',
            `org.opencontainers.image.revision=${sha}`,
            '.',
          ],
          { stdio: 'inherit' },
        ).status,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

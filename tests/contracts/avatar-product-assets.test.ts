import { copyFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { verifyAvatarProductAssets } from '../../scripts/lib/avatar-product-assets.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const publicRoot = resolve(root, 'apps/web/public');
const temporaryRoots: string[] = [];

function fixtureRoot() {
  const directory = mkdtempSync(join(tmpdir(), 'kkakkung-avatar-assets-'));
  temporaryRoots.push(directory);
  cpSync(resolve(publicRoot, 'models/avatars/v1'), resolve(directory, 'models/avatars/v1'), {
    recursive: true,
  });
  return directory;
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true });
});

it('accepts the complete generated avatar manifest and its exact shipped files', async () => {
  await expect(verifyAvatarProductAssets(publicRoot)).resolves.toEqual({
    manifest: 'models/avatars/v1/manifest.json',
    assets: 8,
  });
});

it('rejects a changed asset even when its signature still looks valid', async () => {
  const directory = fixtureRoot();
  const path = resolve(directory, 'models/avatars/v1/runner.glb');
  const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(path));
  const last = bytes.length - 1;
  bytes[last] = bytes[last]! ^ 1;
  writeFileSync(path, bytes);
  await expect(verifyAvatarProductAssets(directory)).rejects.toThrow('AVATAR_ASSET_INTEGRITY');
});

it('rejects unknown files beside the manifest-owned avatar assets', async () => {
  const directory = fixtureRoot();
  const source = resolve(directory, 'models/avatars/v1/runner.glb');
  copyFileSync(source, join(dirname(source), 'untracked.glb'));
  await expect(verifyAvatarProductAssets(directory)).rejects.toThrow('AVATAR_ASSET_FILE_SET');
});

it('rejects a manifest URL that escapes the versioned avatar directory', async () => {
  const directory = fixtureRoot();
  const path = resolve(directory, 'models/avatars/v1/manifest.json');
  const manifest = JSON.parse(
    await import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8')),
  ) as { roles: { runner: { model: { url: string } } } };
  manifest.roles.runner.model.url = '/models/avatars/v1/../runner.glb';
  writeFileSync(path, JSON.stringify(manifest));
  await expect(verifyAvatarProductAssets(directory)).rejects.toThrow('AVATAR_ASSET_PATH');
});

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const avatarPrefix = '/models/avatars/v1/';
const manifestRelativePath = 'models/avatars/v1/manifest.json';
const pngSignature = '89504e470d0a1a0a';

async function filesUnder(directory, root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path, root)));
    else files.push(relative(root, path).split(sep).join('/'));
  }
  return files;
}

function assetRefs(manifest) {
  try {
    return Object.values(manifest.roles).flatMap((role) => [
      role.model,
      ...Object.values(role.textures).flatMap((textures) => Object.values(textures)),
    ]);
  } catch {
    throw new Error('AVATAR_ASSET_MANIFEST');
  }
}

function resolveAsset(root, asset) {
  if (
    typeof asset?.url !== 'string' ||
    !asset.url.startsWith(avatarPrefix) ||
    asset.url.includes('..') ||
    asset.url.includes('\\') ||
    asset.url.includes('?') ||
    asset.url.includes('#')
  )
    throw new Error('AVATAR_ASSET_PATH');
  const relativePath = asset.url.slice(1);
  const path = resolve(root, ...relativePath.split('/'));
  const avatarRoot = resolve(root, 'models/avatars/v1');
  if (!path.startsWith(`${avatarRoot}${sep}`)) throw new Error('AVATAR_ASSET_PATH');
  return { path, relativePath };
}

function verifySignature(path, bytes) {
  const extension = extname(path);
  if (extension === '.glb' && bytes.subarray(0, 4).toString('ascii') !== 'glTF')
    throw new Error('AVATAR_ASSET_SIGNATURE');
  if (extension === '.png' && bytes.subarray(0, 8).toString('hex') !== pngSignature)
    throw new Error('AVATAR_ASSET_SIGNATURE');
  if (extension !== '.glb' && extension !== '.png') throw new Error('AVATAR_ASSET_SIGNATURE');
}

export async function verifyAvatarProductAssets(root) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(root, manifestRelativePath), 'utf8'));
  } catch {
    throw new Error('AVATAR_ASSET_MANIFEST');
  }
  const assets = assetRefs(manifest);
  const expected = new Set([manifestRelativePath]);
  for (const asset of assets) {
    const { path, relativePath } = resolveAsset(root, asset);
    if (expected.has(relativePath)) throw new Error('AVATAR_ASSET_FILE_SET');
    expected.add(relativePath);
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      throw new Error('AVATAR_ASSET_MISSING');
    }
    if (
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      bytes.byteLength !== asset.bytes ||
      typeof asset.sha256 !== 'string' ||
      createHash('sha256').update(bytes).digest('hex') !== asset.sha256
    )
      throw new Error('AVATAR_ASSET_INTEGRITY');
    verifySignature(path, bytes);
  }
  const actual = new Set(await filesUnder(resolve(root, 'models/avatars/v1'), root));
  if (actual.size !== expected.size || [...actual].some((path) => !expected.has(path)))
    throw new Error('AVATAR_ASSET_FILE_SET');
  return { manifest: manifestRelativePath, assets: assets.length };
}

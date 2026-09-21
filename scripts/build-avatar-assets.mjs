#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { avatarAtlas } from './lib/avatar-png.mjs';
import { buildAvatarGlb } from './lib/avatar-geometry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const committedRoot = resolve(root, 'apps/web/public/models/avatars/v1');

function parseArguments(args) {
  let output = committedRoot;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') check = true;
    else if (argument === '--output') {
      const value = args[index + 1];
      if (!value) throw new Error('AVATAR_OUTPUT_REQUIRED');
      output = resolve(value);
      index += 1;
    } else throw new Error(`AVATAR_ARGUMENT_INVALID:${argument}`);
  }
  if (check && output !== committedRoot) throw new Error('AVATAR_CHECK_OUTPUT_CONFLICT');
  return { output, check };
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ref = (url, bytes) => ({ url, sha256: digest(bytes), bytes: bytes.length });

async function writeAsset(output, relativePath, bytes) {
  const path = resolve(output, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return ref(`/models/avatars/v1/${relativePath.replaceAll('\\', '/')}`, bytes);
}

const semantics = {
  runner: ['Hood', 'ShoulderCape', 'RobeHem', 'DollFace'],
  tagger: [
    'Mouth',
    'Teeth.Upper',
    'Teeth.Lower',
    'Finger.L.1',
    'Finger.L.2',
    'Finger.L.3',
    'Finger.R.1',
    'Finger.R.2',
    'Finger.R.3',
  ],
};

async function build(output) {
  await mkdir(output, { recursive: true });
  const roles = {};
  for (const role of ['runner', 'tagger']) {
    const glb = await buildAvatarGlb(role);
    const model = await writeAsset(output, `${role}.glb`, glb.bytes);
    const lowColorBytes = avatarAtlas(role, 512, 'color');
    const mediumColorBytes = avatarAtlas(role, 1024, 'color');
    const mediumRoughnessBytes = avatarAtlas(role, 1024, 'roughness');
    roles[role] = {
      model,
      textures: {
        low: {
          color: await writeAsset(output, `textures/${role}-low-color.png`, lowColorBytes),
        },
        medium: {
          color: await writeAsset(output, `textures/${role}-medium-color.png`, mediumColorBytes),
          roughness: await writeAsset(
            output,
            `textures/${role}-medium-roughness.png`,
            mediumRoughnessBytes,
          ),
        },
      },
      metrics: glb.metrics,
      contract: {
        nodes: role === 'runner' ? ['AvatarRoot', 'Rig', 'FaceSocket'] : ['AvatarRoot', 'Rig'],
        clips: ['idle', 'walk'],
        faceSocket: role === 'runner',
        semanticNodes: semantics[role],
      },
    };
  }
  const manifest = Buffer.from(`${JSON.stringify({ version: 'v1', roles }, null, 2)}\n`);
  await writeFile(resolve(output, 'manifest.json'), manifest);
}

async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const next = join(directory, entry.name);
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(next, name)));
    else files.push(name);
  }
  return files;
}

async function check() {
  const temporary = await mkdtemp(join(tmpdir(), 'kkakkung-avatar-assets-'));
  try {
    await build(temporary);
    const expected = await filesUnder(committedRoot);
    const actual = await filesUnder(temporary);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error('AVATAR_ASSET_FILE_LIST_CHANGED');
    for (const file of expected) {
      const [committed, regenerated] = await Promise.all([
        readFile(resolve(committedRoot, file)),
        readFile(resolve(temporary, file)),
      ]);
      if (!committed.equals(regenerated))
        throw new Error(`AVATAR_ASSET_BYTES_CHANGED:${relative(committedRoot, file)}`);
    }
  } finally {
    if (temporary.startsWith(tmpdir())) await rm(temporary, { recursive: true, force: true });
  }
}

const options = parseArguments(process.argv.slice(2));
if (options.check) await check();
else await build(options.output);

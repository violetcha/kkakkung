import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import {
  clearAvatarAssetCache,
  loadRoleAvatar,
  type AvatarLoaderDeps,
  type AvatarLoaderEvent,
} from './avatar-loader';

const root = fileURLToPath(new URL('../../../../../..', import.meta.url));
const publicRoot = resolve(root, 'apps/web/public');
const manifestUrl = '/models/avatars/v1/manifest.json';

async function bytesFor(url: string) {
  const bytes = await readFile(resolve(publicRoot, `.${url}`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function sceneFor(role: 'runner' | 'tagger') {
  const scene = new Group();
  const avatarRoot = new Group();
  avatarRoot.name = 'AvatarRoot';
  scene.add(avatarRoot);
  const rig = new Group();
  rig.name = 'Rig';
  avatarRoot.add(rig);
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  mesh.material.name = 'BodyMaterial';
  rig.add(mesh);
  const names =
    role === 'runner'
      ? ['FaceSocket', 'Hood', 'ShoulderCape', 'RobeHem', 'DollFace']
      : [
          'Mouth',
          'Teeth.Upper',
          'Teeth.Lower',
          'Finger.L.1',
          'Finger.L.2',
          'Finger.L.3',
          'Finger.R.1',
          'Finger.R.2',
          'Finger.R.3',
        ];
  for (const name of names) {
    const node = new Group();
    node.name = name;
    rig.add(node);
  }
  return {
    scene,
    animations: [new AnimationClip('idle', 1), new AnimationClip('walk', 1)],
  };
}

function deps(options?: {
  failModelOnce?: boolean;
  badHash?: boolean;
  missingSocket?: boolean;
  events?: AvatarLoaderEvent[];
  counters?: { modelFetches: number; parses: number };
}): AvatarLoaderDeps {
  let failed = false;
  return {
    async fetchBytes(url) {
      if (url.endsWith('.glb')) {
        if (options?.counters) options.counters.modelFetches += 1;
        if (options?.failModelOnce && !failed) {
          failed = true;
          throw new Error('404');
        }
      }
      if (url === manifestUrl && options?.badHash) {
        const value = JSON.parse(Buffer.from(await bytesFor(url)).toString('utf8'));
        value.roles.runner.model.sha256 = '0'.repeat(64);
        return new TextEncoder().encode(JSON.stringify(value)).buffer;
      }
      return bytesFor(url);
    },
    async digest(bytes) {
      return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    },
    async parseGlb(_bytes, selection) {
      if (options?.counters) options.counters.parses += 1;
      const parsed = sceneFor(selection.role);
      if (options?.missingSocket) parsed.scene.getObjectByName('FaceSocket')?.removeFromParent();
      return parsed;
    },
    async loadTexture() {
      return new Texture();
    },
    log(event) {
      options?.events?.push(event);
    },
  };
}

beforeEach(() => clearAvatarAssetCache());

describe('avatar loader', () => {
  it('shares one in-flight model and template for concurrent requests', async () => {
    const counters = { modelFetches: 0, parses: 0 };
    const selectedDeps = deps({ counters });
    const [first, second] = await Promise.all([
      loadRoleAvatar('runner', 'medium', selectedDeps),
      loadRoleAvatar('runner', 'medium', selectedDeps),
    ]);

    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    if (first.status === 'ready' && second.status === 'ready')
      expect(first.template).toBe(second.template);
    expect(counters).toEqual({ modelFetches: 1, parses: 1 });
  });

  it('reuses the role GLB while selecting a different quality atlas', async () => {
    const counters = { modelFetches: 0, parses: 0 };
    const selectedDeps = deps({ counters });
    const low = await loadRoleAvatar('tagger', 'low', selectedDeps);
    const medium = await loadRoleAvatar('tagger', 'medium', selectedDeps);

    expect(low.status).toBe('ready');
    expect(medium.status).toBe('ready');
    if (low.status === 'ready' && medium.status === 'ready') {
      expect(low.template.scene).toBe(medium.template.scene);
      expect(low.template.atlas.color).not.toBe(medium.template.atlas.color);
    }
    expect(counters).toEqual({ modelFetches: 1, parses: 1 });
  });

  it('turns a network error into a retryable privacy-safe fallback', async () => {
    const events: AvatarLoaderEvent[] = [];
    const counters = { modelFetches: 0, parses: 0 };
    const selectedDeps = deps({ failModelOnce: true, events, counters });

    expect(await loadRoleAvatar('runner', 'low', selectedDeps)).toEqual({
      status: 'fallback',
      role: 'runner',
      version: 'v1',
      reason: 'network',
    });
    expect((await loadRoleAvatar('runner', 'low', selectedDeps)).status).toBe('ready');
    expect(counters.modelFetches).toBe(2);
    expect(events).toEqual([{ role: 'runner', version: 'v1', reason: 'network' }]);
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(['reason', 'role', 'version']);
  });

  it('falls back when fetched bytes do not match the manifest hash', async () => {
    expect(await loadRoleAvatar('runner', 'low', deps({ badHash: true }))).toEqual({
      status: 'fallback',
      role: 'runner',
      version: 'v1',
      reason: 'integrity',
    });
  });

  it('falls back when a runner GLB omits FaceSocket', async () => {
    expect(await loadRoleAvatar('runner', 'medium', deps({ missingSocket: true }))).toEqual({
      status: 'fallback',
      role: 'runner',
      version: 'v1',
      reason: 'contract',
    });
  });
});

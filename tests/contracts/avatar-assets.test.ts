import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const publicRoot = resolve(root, 'apps/web/public');
const avatarRoot = resolve(publicRoot, 'models/avatars/v1');

type AssetRef = { url: string; sha256: string; bytes: number };
type RoleAsset = {
  model: AssetRef;
  textures: Record<'low' | 'medium', { color: AssetRef; roughness?: AssetRef }>;
  metrics: {
    triangles: number;
    materials: number;
    drawCalls: number;
    height: number;
    armLength: number;
  };
  contract: {
    nodes: string[];
    clips: string[];
    faceSocket: boolean;
    semanticNodes: string[];
  };
};
type Manifest = { version: 'v1'; roles: Record<'runner' | 'tagger', RoleAsset> };

function manifest(): Manifest {
  return JSON.parse(readFileSync(resolve(avatarRoot, 'manifest.json'), 'utf8')) as Manifest;
}

function shippedPath(url: string) {
  return resolve(publicRoot, `.${url}`);
}

function assetRefs(role: RoleAsset) {
  return [
    role.model,
    role.textures.low.color,
    role.textures.medium.color,
    role.textures.medium.roughness,
  ].filter((asset): asset is AssetRef => asset !== undefined);
}

function glbJson(asset: AssetRef) {
  const bytes = readFileSync(shippedPath(asset.url));
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
  return JSON.parse(
    bytes
      .subarray(20, 20 + jsonLength)
      .toString('utf8')
      .trim(),
  ) as {
    nodes: Array<{ name?: string; mesh?: number }>;
    materials?: Array<{ name?: string }>;
    meshes?: Array<{
      primitives: Array<{
        indices?: number;
        material?: number;
        attributes: { POSITION: number; TEXCOORD_0?: number };
      }>;
    }>;
    accessors?: Array<{ count: number; min?: number[]; max?: number[] }>;
    animations?: Array<{
      name?: string;
      channels: Array<{ target: { node: number; path: string } }>;
    }>;
  };
}

function trianglesForNode(json: ReturnType<typeof glbJson>, name: string) {
  const meshIndex = json.nodes.find((node) => node.name === name)?.mesh;
  if (meshIndex === undefined) return 0;
  return (json.meshes?.[meshIndex]?.primitives ?? []).reduce((total, primitive) => {
    const accessorIndex = primitive.indices ?? primitive.attributes.POSITION;
    return total + (json.accessors?.[accessorIndex]?.count ?? 0) / 3;
  }, 0);
}

describe('generated avatar assets', () => {
  it('regenerates every committed byte deterministically', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [resolve(root, 'scripts/build-avatar-assets.mjs'), '--check'],
        {
          cwd: root,
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
  });

  it('records the exact bytes and sha256 of every model and atlas', () => {
    const value = manifest();
    expect(value.version).toBe('v1');
    for (const role of Object.values(value.roles))
      for (const asset of assetRefs(role)) {
        const bytes = readFileSync(shippedPath(asset.url));
        expect(bytes.length, asset.url).toBe(asset.bytes);
        expect(createHash('sha256').update(bytes).digest('hex'), asset.url).toBe(asset.sha256);
      }
  });

  it('ships low 512px and medium 1024px PNG atlases', () => {
    for (const role of Object.values(manifest().roles))
      for (const [quality, textures] of Object.entries(role.textures))
        for (const asset of Object.values(textures)) {
          const png = readFileSync(shippedPath(asset.url));
          expect(png.subarray(0, 8).toString('hex'), asset.url).toBe('89504e470d0a1a0a');
          const expected = quality === 'low' ? 512 : 1024;
          expect(png.readUInt32BE(16), asset.url).toBe(expected);
          expect(png.readUInt32BE(20), asset.url).toBe(expected);
        }
  });

  it.each(['runner', 'tagger'] as const)(
    '%s GLB carries the required nodes, material, clips and no root motion',
    (role) => {
      const selected = manifest().roles[role];
      const json = glbJson(selected.model);
      const nodeNames = json.nodes.map((node) => node.name).filter(Boolean);
      const materialNames = json.materials?.map((material) => material.name) ?? [];
      const clipNames = json.animations?.map((animation) => animation.name).sort() ?? [];

      expect(nodeNames).toEqual(expect.arrayContaining(['AvatarRoot', 'Rig']));
      expect(nodeNames).toEqual(expect.arrayContaining(selected.contract.semanticNodes));
      expect(materialNames).toContain('BodyMaterial');
      expect(clipNames).toEqual(['idle', 'walk']);
      expect(nodeNames.includes('FaceSocket')).toBe(role === 'runner');
      const rootIndex = json.nodes.findIndex((node) => node.name === 'AvatarRoot');
      const rootTracks =
        json.animations?.flatMap((animation) =>
          animation.channels.filter((channel) => channel.target.node === rootIndex),
        ) ?? [];
      expect(rootTracks).toEqual([]);
    },
  );

  it('keeps the silhouettes distinct and six-player rendering inside budget', () => {
    const { runner, tagger } = manifest().roles;
    expect(tagger.metrics.height).toBeGreaterThanOrEqual(runner.metrics.height * 1.25);
    expect(tagger.metrics.armLength).toBeGreaterThan(runner.metrics.armLength * 1.5);
    expect(Math.max(runner.metrics.triangles, tagger.metrics.triangles) * 6).toBeLessThanOrEqual(
      60_000,
    );
    for (const role of [runner, tagger]) {
      expect(role.metrics.materials).toBeLessThanOrEqual(4);
      expect(role.metrics.drawCalls).toBeLessThanOrEqual(8);
    }
    expect(runner.contract.semanticNodes).toEqual(
      expect.arrayContaining(['Hood', 'ShoulderCape', 'RobeHem', 'DollFace']),
    );
    expect(tagger.contract.semanticNodes).toEqual(
      expect.arrayContaining([
        'Mouth',
        'TeethUpper',
        'TeethLower',
        'FingerL1',
        'FingerL2',
        'FingerL3',
        'FingerR1',
        'FingerR2',
        'FingerR3',
      ]),
    );
  });

  it('bakes three visible fingers into each tagger arm without extra draw calls', () => {
    const selected = manifest().roles.tagger;
    const json = glbJson(selected.model);
    expect(trianglesForNode(json, 'LongArm.L')).toBeGreaterThan(30);
    expect(trianglesForNode(json, 'LongArm.R')).toBeGreaterThan(30);
    expect(selected.metrics.drawCalls).toBe(8);
  });

  it.each(['runner', 'tagger'] as const)(
    '%s BodyMaterial UVs stay inside the first atlas column',
    (role) => {
      const selected = manifest().roles[role];
      const json = glbJson(selected.model);
      const bodyMaterial = json.materials?.findIndex(
        (material) => material.name === 'BodyMaterial',
      );
      expect(bodyMaterial).toBeGreaterThanOrEqual(0);
      const bodyUvs =
        json.meshes?.flatMap((mesh) =>
          mesh.primitives
            .filter((primitive) => primitive.material === bodyMaterial)
            .map((primitive) => json.accessors?.[primitive.attributes.TEXCOORD_0 ?? -1]),
        ) ?? [];
      expect(bodyUvs.length).toBeGreaterThan(0);
      for (const uv of bodyUvs) {
        expect(uv?.min?.[0]).toBeGreaterThan(0);
        expect(uv?.max?.[0]).toBeLessThan(0.25);
      }
    },
  );
});

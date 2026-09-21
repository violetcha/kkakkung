import { describe, expect, it } from 'vitest';
import { manifestAsset, parseAvatarManifest } from './avatar-manifest';

const sha = 'a'.repeat(64);
const asset = (url: string) => ({ url, sha256: sha, bytes: 128 });

const validManifest = {
  version: 'v1',
  roles: {
    runner: {
      model: asset('/models/avatars/v1/runner.glb'),
      textures: {
        low: { color: asset('/models/avatars/v1/textures/runner-low-color.png') },
        medium: {
          color: asset('/models/avatars/v1/textures/runner-medium-color.png'),
          roughness: asset('/models/avatars/v1/textures/runner-medium-roughness.png'),
        },
      },
      metrics: { triangles: 1200, materials: 3, drawCalls: 6, height: 0.96, armLength: 0.29 },
      contract: {
        nodes: ['AvatarRoot', 'Rig', 'FaceSocket'],
        clips: ['idle', 'walk'],
        faceSocket: true,
        semanticNodes: ['Hood', 'ShoulderCape', 'RobeHem'],
      },
    },
    tagger: {
      model: asset('/models/avatars/v1/tagger.glb'),
      textures: {
        low: { color: asset('/models/avatars/v1/textures/tagger-low-color.png') },
        medium: {
          color: asset('/models/avatars/v1/textures/tagger-medium-color.png'),
          roughness: asset('/models/avatars/v1/textures/tagger-medium-roughness.png'),
        },
      },
      metrics: { triangles: 2800, materials: 4, drawCalls: 8, height: 1.32, armLength: 0.67 },
      contract: {
        nodes: ['AvatarRoot', 'Rig'],
        clips: ['idle', 'walk'],
        faceSocket: false,
        semanticNodes: ['Mouth', 'Teeth.Upper', 'Teeth.Lower', 'Finger.L.1'],
      },
    },
  },
};

function copy() {
  return structuredClone(validManifest);
}

describe('avatar manifest', () => {
  it('selects the role model and the requested quality textures', () => {
    const manifest = parseAvatarManifest(copy());
    const selected = manifestAsset(manifest, 'runner', 'medium');

    expect(selected.version).toBe('v1');
    expect(selected.role).toBe('runner');
    expect(selected.model.url).toBe('/models/avatars/v1/runner.glb');
    expect(selected.textures.color.url).toBe('/models/avatars/v1/textures/runner-medium-color.png');
    expect(selected.textures.roughness?.url).toBe(
      '/models/avatars/v1/textures/runner-medium-roughness.png',
    );
  });

  it.each([
    ['external URL', 'https://example.com/runner.glb'],
    ['path traversal', '/models/avatars/v1/../runner.glb'],
    ['backslash', '/models/avatars/v1\\runner.glb'],
    ['query', '/models/avatars/v1/runner.glb?v=2'],
    ['fragment', '/models/avatars/v1/runner.glb#mesh'],
  ])('rejects a model %s', (_name, url) => {
    const input = copy();
    input.roles.runner.model.url = url;
    expect(() => parseAvatarManifest(input)).toThrow('avatar manifest');
  });

  it.each([
    ['short SHA', { sha256: 'abc' }],
    ['uppercase SHA', { sha256: 'A'.repeat(64) }],
    ['zero bytes', { bytes: 0 }],
    ['fractional bytes', { bytes: 1.5 }],
  ])('rejects an asset with %s', (_name, patch) => {
    const input = copy();
    Object.assign(input.roles.runner.model, patch);
    expect(() => parseAvatarManifest(input)).toThrow('avatar manifest');
  });

  it('rejects qualities the product does not expose', () => {
    const input = copy() as typeof validManifest & {
      roles: { runner: { textures: Record<string, unknown> } };
    };
    input.roles.runner.textures.high = input.roles.runner.textures.medium;
    expect(() => parseAvatarManifest(input)).toThrow('avatar manifest');
  });

  it.each([
    ['missing Rig', (input: ReturnType<typeof copy>) => input.roles.runner.contract.nodes.pop()],
    ['missing walk', (input: ReturnType<typeof copy>) => input.roles.tagger.contract.clips.pop()],
    [
      'runner without face socket',
      (input: ReturnType<typeof copy>) => {
        input.roles.runner.contract.faceSocket = false;
      },
    ],
    [
      'tagger with face socket',
      (input: ReturnType<typeof copy>) => {
        input.roles.tagger.contract.faceSocket = true;
        input.roles.tagger.contract.nodes.push('FaceSocket');
      },
    ],
  ])('rejects a broken contract: %s', (_name, breakContract) => {
    const input = copy();
    breakContract(input);
    expect(() => parseAvatarManifest(input)).toThrow('avatar manifest');
  });

  it.each([
    ['zero triangles', 'triangles', 0],
    ['too many materials', 'materials', 5],
    ['too many draw calls', 'drawCalls', 9],
    ['non-finite height', 'height', Number.POSITIVE_INFINITY],
  ] as const)('rejects invalid metrics: %s', (_name, key, value) => {
    const input = copy();
    input.roles.tagger.metrics[key] = value;
    expect(() => parseAvatarManifest(input)).toThrow('avatar manifest');
  });
});

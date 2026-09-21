import type { Role } from '@kkakkung/protocol/game-schema';
import { QUALITY_PRESET_IDS, type QualityPreset } from './quality-presets';

export type AvatarAssetRef = Readonly<{
  url: string;
  sha256: string;
  bytes: number;
}>;

export type AvatarTextureSet = Readonly<{
  color: AvatarAssetRef;
  roughness?: AvatarAssetRef;
}>;

export type AvatarMetrics = Readonly<{
  triangles: number;
  materials: number;
  drawCalls: number;
  height: number;
  armLength: number;
}>;

export type AvatarContract = Readonly<{
  nodes: readonly string[];
  clips: readonly ['idle', 'walk'];
  faceSocket: boolean;
  semanticNodes: readonly string[];
}>;

export type AvatarRoleAsset = Readonly<{
  model: AvatarAssetRef;
  textures: Readonly<Record<QualityPreset, AvatarTextureSet>>;
  metrics: AvatarMetrics;
  contract: AvatarContract;
}>;

export type AvatarManifest = Readonly<{
  version: 'v1';
  roles: Readonly<Record<Role, AvatarRoleAsset>>;
}>;

export type AvatarRoleSelection = Readonly<{
  version: 'v1';
  role: Role;
  model: AvatarAssetRef;
  textures: AvatarTextureSet;
  metrics: AvatarMetrics;
  contract: AvatarContract;
}>;

function invalid(detail: string): never {
  throw new Error(`avatar manifest: ${detail}`);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], name: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]))
    invalid(`${name} keys`);
}

function positiveNumber(value: unknown, name: string, integer = false) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (integer && !Number.isInteger(value))
  )
    invalid(name);
  return value;
}

function assetRef(input: unknown, name: string): AvatarAssetRef {
  const value = record(input, name);
  exactKeys(value, ['url', 'sha256', 'bytes'], name);
  const url = value.url;
  if (
    typeof url !== 'string' ||
    !url.startsWith('/models/avatars/v1/') ||
    url.length === '/models/avatars/v1/'.length ||
    url.includes('..') ||
    url.includes('\\') ||
    url.includes('?') ||
    url.includes('#') ||
    url.includes('//')
  )
    invalid(`${name} url`);
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256))
    invalid(`${name} sha256`);
  return { url, sha256: value.sha256, bytes: positiveNumber(value.bytes, `${name} bytes`, true) };
}

function stringList(input: unknown, name: string) {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.some((item) => typeof item !== 'string' || item.length === 0) ||
    new Set(input).size !== input.length
  )
    invalid(name);
  return [...input] as string[];
}

function textureSet(input: unknown, name: string, roughnessRequired: boolean): AvatarTextureSet {
  const value = record(input, name);
  exactKeys(value, roughnessRequired ? ['color', 'roughness'] : ['color'], name);
  return {
    color: assetRef(value.color, `${name} color`),
    ...(roughnessRequired ? { roughness: assetRef(value.roughness, `${name} roughness`) } : {}),
  };
}

function roleAsset(input: unknown, role: Role): AvatarRoleAsset {
  const value = record(input, role);
  exactKeys(value, ['model', 'textures', 'metrics', 'contract'], role);

  const textures = record(value.textures, `${role} textures`);
  exactKeys(textures, QUALITY_PRESET_IDS, `${role} textures`);

  const metrics = record(value.metrics, `${role} metrics`);
  exactKeys(
    metrics,
    ['triangles', 'materials', 'drawCalls', 'height', 'armLength'],
    `${role} metrics`,
  );
  const parsedMetrics: AvatarMetrics = {
    triangles: positiveNumber(metrics.triangles, `${role} triangles`, true),
    materials: positiveNumber(metrics.materials, `${role} materials`, true),
    drawCalls: positiveNumber(metrics.drawCalls, `${role} drawCalls`, true),
    height: positiveNumber(metrics.height, `${role} height`),
    armLength: positiveNumber(metrics.armLength, `${role} armLength`),
  };
  if (parsedMetrics.materials > 4) invalid(`${role} material budget`);
  if (parsedMetrics.drawCalls > 8) invalid(`${role} draw-call budget`);

  const contract = record(value.contract, `${role} contract`);
  exactKeys(contract, ['nodes', 'clips', 'faceSocket', 'semanticNodes'], `${role} contract`);
  const nodes = stringList(contract.nodes, `${role} nodes`);
  const clips = stringList(contract.clips, `${role} clips`);
  if (!nodes.includes('AvatarRoot') || !nodes.includes('Rig')) invalid(`${role} required nodes`);
  if (clips.length !== 2 || clips[0] !== 'idle' || clips[1] !== 'walk') invalid(`${role} clips`);
  if (typeof contract.faceSocket !== 'boolean') invalid(`${role} face socket flag`);
  const expectedFaceSocket = role === 'runner';
  if (
    contract.faceSocket !== expectedFaceSocket ||
    nodes.includes('FaceSocket') !== expectedFaceSocket
  )
    invalid(`${role} face socket contract`);

  return {
    model: assetRef(value.model, `${role} model`),
    textures: {
      low: textureSet(textures.low, `${role} low textures`, false),
      medium: textureSet(textures.medium, `${role} medium textures`, true),
    },
    metrics: parsedMetrics,
    contract: {
      nodes,
      clips: ['idle', 'walk'],
      faceSocket: expectedFaceSocket,
      semanticNodes: stringList(contract.semanticNodes, `${role} semantic nodes`),
    },
  };
}

export function parseAvatarManifest(input: unknown): AvatarManifest {
  const value = record(input, 'root');
  exactKeys(value, ['version', 'roles'], 'root');
  if (value.version !== 'v1') invalid('version');
  const roles = record(value.roles, 'roles');
  exactKeys(roles, ['runner', 'tagger'], 'roles');
  return {
    version: 'v1',
    roles: {
      runner: roleAsset(roles.runner, 'runner'),
      tagger: roleAsset(roles.tagger, 'tagger'),
    },
  };
}

export function manifestAsset(
  manifest: AvatarManifest,
  role: Role,
  quality: QualityPreset,
): AvatarRoleSelection {
  const selected = manifest.roles[role];
  return {
    version: manifest.version,
    role,
    model: selected.model,
    textures: selected.textures[quality],
    metrics: selected.metrics,
    contract: selected.contract,
  };
}

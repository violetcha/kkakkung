import type { Role } from '@kkakkung/protocol/game-schema';
import {
  AnimationClip,
  Mesh,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  manifestAsset,
  parseAvatarManifest,
  type AvatarAssetRef,
  type AvatarManifest,
  type AvatarRoleSelection,
} from './avatar-manifest';
import type { QualityPreset } from './quality-presets';

const MANIFEST_URL = '/models/avatars/v1/manifest.json';

export type AvatarLoadFailure = 'network' | 'integrity' | 'decode' | 'contract';
export type AvatarLoaderEvent = Readonly<{
  role: Role;
  version: 'v1';
  reason: AvatarLoadFailure;
}>;

export type ParsedAvatarGlb = Readonly<{
  scene: Object3D;
  animations: readonly AnimationClip[];
}>;

export type AvatarTemplate = Readonly<{
  role: Role;
  quality: QualityPreset;
  version: 'v1';
  scene: Object3D;
  animations: readonly AnimationClip[];
  atlas: Readonly<{ color: Texture; roughness?: Texture }>;
}>;

export type AvatarLoadResult =
  | Readonly<{ status: 'ready'; template: AvatarTemplate }>
  | Readonly<{
      status: 'fallback';
      role: Role;
      version: 'v1';
      reason: AvatarLoadFailure;
    }>;

export type AvatarLoaderDeps = Readonly<{
  fetchBytes(url: string): Promise<ArrayBuffer>;
  digest(bytes: ArrayBuffer): Promise<string>;
  parseGlb(bytes: ArrayBuffer, selection: AvatarRoleSelection): Promise<ParsedAvatarGlb>;
  loadTexture(bytes: ArrayBuffer, asset: AvatarAssetRef, color: boolean): Promise<Texture>;
  log(event: AvatarLoaderEvent): void;
}>;

class AvatarLoadError extends Error {
  constructor(readonly reason: AvatarLoadFailure) {
    super(`avatar load ${reason}`);
  }
}

function materialsOf(scene: Object3D) {
  const materials: Material[] = [];
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const selected = Array.isArray(object.material) ? object.material : [object.material];
    materials.push(...selected);
  });
  return materials;
}

function disposeScene(scene: Object3D) {
  const geometries = new Set<Extract<Mesh['geometry'], object>>();
  const materials = new Set<Material>();
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    const selected = Array.isArray(object.material) ? object.material : [object.material];
    selected.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

async function defaultDigest(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function defaultFetchBytes(url: string) {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw new AvatarLoadError('network');
  }
  if (!response.ok) throw new AvatarLoadError('network');
  return response.arrayBuffer();
}

async function defaultLoadTexture(bytes: ArrayBuffer, asset: AvatarAssetRef, color: boolean) {
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const texture = await new TextureLoader().loadAsync(objectUrl);
    if (color) texture.colorSpace = SRGBColorSpace;
    texture.name = asset.url;
    return texture;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const DEFAULT_DEPS: AvatarLoaderDeps = Object.freeze({
  fetchBytes: defaultFetchBytes,
  digest: defaultDigest,
  async parseGlb(bytes, selection) {
    try {
      const path = selection.model.url.slice(0, selection.model.url.lastIndexOf('/') + 1);
      const gltf = await new GLTFLoader().parseAsync(bytes, path);
      return { scene: gltf.scene, animations: gltf.animations };
    } catch {
      throw new AvatarLoadError('decode');
    }
  },
  loadTexture: defaultLoadTexture,
  log(event) {
    console.warn('avatar asset fallback', event);
  },
});

type RuntimeCache = {
  manifest: Promise<AvatarManifest> | null;
  models: Map<string, Promise<ParsedAvatarGlb>>;
  textures: Map<string, Promise<Texture>>;
  templates: Map<string, Promise<AvatarTemplate>>;
  resolvedModels: Set<ParsedAvatarGlb>;
  resolvedTextures: Set<Texture>;
};

const runtimes = new Map<AvatarLoaderDeps, RuntimeCache>();

function runtimeFor(deps: AvatarLoaderDeps) {
  let runtime = runtimes.get(deps);
  if (!runtime) {
    runtime = {
      manifest: null,
      models: new Map(),
      textures: new Map(),
      templates: new Map(),
      resolvedModels: new Set(),
      resolvedTextures: new Set(),
    };
    runtimes.set(deps, runtime);
  }
  return runtime;
}

async function verifiedBytes(deps: AvatarLoaderDeps, asset: AvatarAssetRef) {
  let bytes: ArrayBuffer;
  try {
    bytes = await deps.fetchBytes(asset.url);
  } catch (error) {
    if (error instanceof AvatarLoadError) throw error;
    throw new AvatarLoadError('network');
  }
  let digest: string;
  try {
    digest = await deps.digest(bytes);
  } catch {
    throw new AvatarLoadError('integrity');
  }
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256)
    throw new AvatarLoadError('integrity');
  return bytes;
}

function cached<K, V>(cache: Map<K, Promise<V>>, key: K, create: () => Promise<V>) {
  const existing = cache.get(key);
  if (existing) return existing;
  const created = create().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, created);
  return created;
}

function loadManifest(deps: AvatarLoaderDeps, runtime: RuntimeCache) {
  if (runtime.manifest) return runtime.manifest;
  runtime.manifest = (async () => {
    let bytes: ArrayBuffer;
    try {
      bytes = await deps.fetchBytes(MANIFEST_URL);
    } catch {
      throw new AvatarLoadError('network');
    }
    try {
      return parseAvatarManifest(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      throw new AvatarLoadError('contract');
    }
  })().catch((error) => {
    runtime.manifest = null;
    throw error;
  });
  return runtime.manifest;
}

function validateModel(parsed: ParsedAvatarGlb, selection: AvatarRoleSelection) {
  for (const name of [...selection.contract.nodes, ...selection.contract.semanticNodes])
    if (!parsed.scene.getObjectByName(name)) throw new AvatarLoadError('contract');
  if (Boolean(parsed.scene.getObjectByName('FaceSocket')) !== selection.contract.faceSocket)
    throw new AvatarLoadError('contract');
  if (!materialsOf(parsed.scene).some((material) => material.name === 'BodyMaterial'))
    throw new AvatarLoadError('contract');
  const clips = parsed.animations.map((clip) => clip.name).sort();
  if (clips.join(',') !== 'idle,walk') throw new AvatarLoadError('contract');
  const root = parsed.scene.getObjectByName('AvatarRoot');
  if (!root) throw new AvatarLoadError('contract');
  if (
    parsed.animations.some((clip) =>
      clip.tracks.some(
        (track) => track.name.startsWith(`${root.name}.`) || track.name.startsWith(`${root.uuid}.`),
      ),
    )
  )
    throw new AvatarLoadError('contract');
}

function loadModel(deps: AvatarLoaderDeps, runtime: RuntimeCache, selection: AvatarRoleSelection) {
  const key = `${selection.role}:${selection.model.url}`;
  return cached(runtime.models, key, async () => {
    const bytes = await verifiedBytes(deps, selection.model);
    let parsed: ParsedAvatarGlb;
    try {
      parsed = await deps.parseGlb(bytes, selection);
    } catch (error) {
      if (error instanceof AvatarLoadError) throw error;
      throw new AvatarLoadError('decode');
    }
    validateModel(parsed, selection);
    runtime.resolvedModels.add(parsed);
    return parsed;
  });
}

function loadAtlasTexture(
  deps: AvatarLoaderDeps,
  runtime: RuntimeCache,
  asset: AvatarAssetRef,
  color: boolean,
) {
  return cached(runtime.textures, asset.url, async () => {
    const bytes = await verifiedBytes(deps, asset);
    try {
      const texture = await deps.loadTexture(bytes, asset, color);
      runtime.resolvedTextures.add(texture);
      return texture;
    } catch {
      throw new AvatarLoadError('decode');
    }
  });
}

async function loadTemplate(
  role: Role,
  quality: QualityPreset,
  deps: AvatarLoaderDeps,
  runtime: RuntimeCache,
) {
  const manifest = await loadManifest(deps, runtime);
  const selection = manifestAsset(manifest, role, quality);
  const [model, color, roughness] = await Promise.all([
    loadModel(deps, runtime, selection),
    loadAtlasTexture(deps, runtime, selection.textures.color, true),
    selection.textures.roughness
      ? loadAtlasTexture(deps, runtime, selection.textures.roughness, false)
      : Promise.resolve(undefined),
  ]);
  return {
    role,
    quality,
    version: manifest.version,
    scene: model.scene,
    animations: model.animations,
    atlas: { color, ...(roughness ? { roughness } : {}) },
  } satisfies AvatarTemplate;
}

export async function loadRoleAvatar(
  role: Role,
  quality: QualityPreset,
  deps: AvatarLoaderDeps = DEFAULT_DEPS,
): Promise<AvatarLoadResult> {
  const runtime = runtimeFor(deps);
  const key = `${role}:${quality}`;
  try {
    const template = await cached(runtime.templates, key, () =>
      loadTemplate(role, quality, deps, runtime),
    );
    return { status: 'ready', template };
  } catch (error) {
    runtime.templates.delete(key);
    const reason = error instanceof AvatarLoadError ? error.reason : 'decode';
    const event = { role, version: 'v1' as const, reason };
    deps.log(event);
    return { status: 'fallback', ...event };
  }
}

export async function prefetchAvatarAssets(quality: QualityPreset) {
  await Promise.allSettled([loadRoleAvatar('runner', quality), loadRoleAvatar('tagger', quality)]);
}

export function clearAvatarAssetCache() {
  for (const runtime of runtimes.values()) {
    runtime.resolvedModels.forEach((model) => disposeScene(model.scene));
    runtime.resolvedTextures.forEach((texture) => texture.dispose());
  }
  runtimes.clear();
}

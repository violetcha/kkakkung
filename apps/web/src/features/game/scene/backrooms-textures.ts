import {
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  MirroredRepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { QualityPreset } from './quality-presets';

export const BACKROOMS_TEXTURE_PATHS = Object.freeze({
  albedo: '/textures/backrooms/albedo.png',
  roughness: '/textures/backrooms/roughness.png',
  normal: '/textures/backrooms/normal.png',
  seamless: '/textures/backrooms/seamless.png',
});

export type BackroomsTexturePaths = Readonly<{
  color: string;
  roughness: string | null;
  normal: string | null;
}>;

export function backroomsTexturePaths(_quality: QualityPreset): BackroomsTexturePaths {
  // Both qualities use the tileable source. The supplied PBR maps align with the untiled
  // original, so mixing them would reintroduce a visible cut at every cell boundary.
  return { color: BACKROOMS_TEXTURE_PATHS.seamless, roughness: null, normal: null };
}

export function configureBackroomsTexture(texture: Texture, kind: 'color' | 'data'): Texture {
  texture.wrapS = RepeatWrapping;
  // The supplied "seamless" asset is not vertically periodic. Reflect alternate rows so
  // the exact same edge texels meet, rather than cutting back to a different top edge.
  texture.wrapT = MirroredRepeatWrapping;
  texture.repeat.set(1, 2);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.colorSpace = kind === 'color' ? SRGBColorSpace : '';
  texture.needsUpdate = true;
  return texture;
}

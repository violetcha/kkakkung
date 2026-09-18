import {
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
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

export function backroomsTexturePaths(quality: QualityPreset): BackroomsTexturePaths {
  return quality === 'low'
    ? { color: BACKROOMS_TEXTURE_PATHS.seamless, roughness: null, normal: null }
    : {
        color: BACKROOMS_TEXTURE_PATHS.albedo,
        roughness: BACKROOMS_TEXTURE_PATHS.roughness,
        normal: BACKROOMS_TEXTURE_PATHS.normal,
      };
}

export function configureBackroomsTexture(texture: Texture, kind: 'color' | 'data'): Texture {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1, 1.7);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.colorSpace = kind === 'color' ? SRGBColorSpace : '';
  texture.needsUpdate = true;
  return texture;
}

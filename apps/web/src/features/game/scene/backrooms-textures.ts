import {
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  MirroredRepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { QualityPreset } from './quality-presets';

// S15P21C204-397. 받은 PBR 원본(albedo·roughness·normal)은 타일이 이어지지 않아 쓰지 않았고 삭제했다.
export const BACKROOMS_TEXTURE_PATHS = Object.freeze({
  seamless: '/textures/backrooms/seamless.png',
});

export type BackroomsTexturePaths = Readonly<{
  color: string;
  roughness: string | null;
  normal: string | null;
}>;

export function backroomsTexturePaths(_quality: QualityPreset): BackroomsTexturePaths {
  // Both qualities use the tileable source. There are no relief maps that tile with it.
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

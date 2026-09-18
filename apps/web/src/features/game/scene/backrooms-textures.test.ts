import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BACKROOMS_TEXTURE_PATHS,
  backroomsTexturePaths,
  configureBackroomsTexture,
} from './backrooms-textures';

describe('backroomsTexturePaths', () => {
  it('keeps full wall relief on medium and avoids extra texture maps on low quality', () => {
    expect(backroomsTexturePaths('medium')).toEqual({
      color: '/textures/backrooms/albedo.png',
      roughness: '/textures/backrooms/roughness.png',
      normal: '/textures/backrooms/normal.png',
    });
    expect(backroomsTexturePaths('low')).toEqual({
      color: '/textures/backrooms/seamless.png',
      roughness: null,
      normal: null,
    });
  });

  it('keeps every user-provided source address explicit', () => {
    expect(BACKROOMS_TEXTURE_PATHS).toEqual({
      albedo: '/textures/backrooms/albedo.png',
      roughness: '/textures/backrooms/roughness.png',
      normal: '/textures/backrooms/normal.png',
      seamless: '/textures/backrooms/seamless.png',
    });
  });
});

it('tiles wall maps vertically with colour conversion only on colour textures', () => {
  const color = configureBackroomsTexture(new Texture(), 'color');
  const data = configureBackroomsTexture(new Texture(), 'data');

  expect([color.repeat.x, color.repeat.y]).toEqual([1, 1.7]);
  expect([data.repeat.x, data.repeat.y]).toEqual([1, 1.7]);
  expect(color.colorSpace).toBe('srgb');
  expect(data.colorSpace).toBe('');
  expect(color.wrapS).toBe(1000);
  expect(color.wrapT).toBe(1000);
});

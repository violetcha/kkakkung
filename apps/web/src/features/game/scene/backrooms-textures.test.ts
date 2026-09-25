import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BACKROOMS_TEXTURE_PATHS,
  backroomsTexturePaths,
  configureBackroomsTexture,
} from './backrooms-textures';

describe('backroomsTexturePaths', () => {
  it('uses the seamless tile at both qualities without mismatched relief maps', () => {
    expect(backroomsTexturePaths('medium')).toEqual({
      color: '/textures/backrooms/seamless.png',
      roughness: null,
      normal: null,
    });
    expect(backroomsTexturePaths('low')).toEqual({
      color: '/textures/backrooms/seamless.png',
      roughness: null,
      normal: null,
    });
  });

  it('ships only the tileable wall texture', () => {
    expect(BACKROOMS_TEXTURE_PATHS).toEqual({ seamless: '/textures/backrooms/seamless.png' });
  });
});

it('tiles wall maps vertically with colour conversion only on colour textures', () => {
  const color = configureBackroomsTexture(new Texture(), 'color');
  const data = configureBackroomsTexture(new Texture(), 'data');

  expect([color.repeat.x, color.repeat.y]).toEqual([1, 2]);
  expect([data.repeat.x, data.repeat.y]).toEqual([1, 2]);
  expect(color.colorSpace).toBe('srgb');
  expect(data.colorSpace).toBe('');
  expect(color.wrapS).toBe(1000);
  expect(color.wrapT).toBe(1002);
});

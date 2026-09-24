import { describe, expect, it } from 'vitest';
import { NearestFilter } from 'three';
import {
  BLOCK,
  BLOCK_LIGHTING,
  BLOCK_PALETTE,
  SERVER_VIEW_RANGE,
  blockTexture,
  blockTilePixels,
  createBlockResources,
  isMossyFace,
} from './block-theme';
import { FACILITY } from './facility-theme';
import { relativeLuminance } from './role-colors';
import { CAMERA_FAR, sceneWorld } from './WorldCanvas';

/** Relative light a point light leaves on a surface `distance` away (three's physical falloff). */
const lanternTerm = (distance: number) =>
  BLOCK_LIGHTING.lantern.intensity / distance ** BLOCK_LIGHTING.lantern.decay;

describe('block tiles', () => {
  it('are 16×16 pixel art: same bytes every time, nearest filtering, no mipmaps', () => {
    for (const kind of ['stone', 'moss', 'floor', 'ceiling'] as const) {
      const pixels = blockTilePixels(kind);
      expect(pixels.length).toBe(BLOCK.tile * BLOCK.tile * 4);
      expect(Array.from(blockTilePixels(kind))).toEqual(Array.from(pixels));
      const texture = blockTexture(kind);
      expect(texture.magFilter).toBe(NearestFilter);
      expect(texture.minFilter).toBe(NearestFilter);
      expect(texture.generateMipmaps).toBe(false);
      expect(texture.image.width).toBe(BLOCK.tile);
      texture.dispose();
    }
  });

  it('stay dark: no texel brighter than the bone highlight and the average well below mid grey', () => {
    const boneLuminance = relativeLuminance(BLOCK_PALETTE.bone);
    for (const kind of ['stone', 'moss', 'floor', 'ceiling'] as const) {
      const pixels = blockTilePixels(kind);
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const hex = `#${[pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')}`;
        const luminance = relativeLuminance(hex);
        expect(luminance).toBeLessThanOrEqual(boneLuminance + 1e-9);
        sum += luminance;
      }
      expect(sum / (pixels.length / 4)).toBeLessThan(0.08);
    }
  });

  it('differ from each other so wall, moss, floor and ceiling are told apart by texture alone', () => {
    const kinds = ['stone', 'moss', 'floor', 'ceiling'] as const;
    const bytes = kinds.map((kind) => Array.from(blockTilePixels(kind)).join(','));
    expect(new Set(bytes).size).toBe(kinds.length);
  });

  it('spreads mossy faces as a fixed minority over the grid', () => {
    let mossy = 0;
    let total = 0;
    for (let x = 0; x < 31; x += 1)
      for (let y = 0; y < 31; y += 1)
        for (const side of [0, 1, 2, 3] as const) {
          total += 1;
          if (isMossyFace({ x, y, side })) mossy += 1;
        }
    expect(mossy / total).toBeGreaterThan(0.1);
    expect(mossy / total).toBeLessThan(0.3);
    expect(isMossyFace({ x: 3, y: 4, side: 1 })).toBe(isMossyFace({ x: 3, y: 4, side: 1 }));
  });
});

describe('block lighting and fog', () => {
  it('never shows farther than the server sight, in either theme', () => {
    for (const theme of ['block', 'facility'] as const) {
      const world = sceneWorld(theme);
      expect(world.fogNear).toBeLessThan(world.fogFar);
      expect(world.fogFar).toBeLessThanOrEqual(SERVER_VIEW_RANGE);
    }
    expect(BLOCK.fogFar).toBeLessThanOrEqual(SERVER_VIEW_RANGE);
    expect(FACILITY.fogFar).toBeLessThanOrEqual(SERVER_VIEW_RANGE);
  });

  it('closes the fog before the camera stops drawing, so the far wall fades instead of being cut', () => {
    // S15P21C204-377. 그리기 끝이 안개 끝보다 앞이면 먼 벽이 반쯤 안개 낀 채 잘려 보인다.
    expect(CAMERA_FAR).toBeGreaterThanOrEqual(SERVER_VIEW_RANGE);
    for (const theme of ['block', 'facility'] as const)
      expect(sceneWorld(theme).fogFar).toBeLessThan(CAMERA_FAR);
  });

  it('lights with one carried lantern that reaches the fog end but does not wash a near wall', () => {
    expect(BLOCK_LIGHTING.lantern.distance).toBeGreaterThanOrEqual(BLOCK.fogFar);
    // Half a cell away, while turning: texture must survive (facility keeps the same 24 ceiling).
    expect(lanternTerm(0.5)).toBeLessThanOrEqual(24);
    // 2.5 cells ahead an opponent is still a shape, with only the lantern and a faint ambient.
    expect(lanternTerm(2.5) + BLOCK.ambient).toBeGreaterThan(0.5);
    // The lantern dominates: the ambient is a floor for the darkness, not a second light.
    expect(BLOCK.ambient).toBeLessThan(FACILITY.ambient);
    expect(lanternTerm(1)).toBeGreaterThan(6 * BLOCK.ambient);
  });

  it('hangs the lantern in the right hand, below eye height and ahead of the body', () => {
    const [x, y, z] = BLOCK_LIGHTING.lanternOffset;
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0.4);
    expect(y).toBeLessThan(0.8);
    expect(z).toBeLessThan(0);
  });
});

it('releases every block resource exactly once on repeated cleanup', () => {
  const resources = createBlockResources();
  const owned = [
    ...Object.values(resources.geometry),
    ...Object.values(resources.material),
    ...resources.textures,
  ];
  const counts = owned.map(() => 0);
  owned.forEach((resource, index) => resource.addEventListener('dispose', () => counts[index]++));
  resources.dispose();
  resources.dispose();
  expect(counts.every((count) => count === 1)).toBe(true);
  expect(resources.textures).toHaveLength(4);
});

import {
  BoxGeometry,
  DataTexture,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';

/**
 * S15P21C204-268. The dark block theme: block forms and 16×16 pixel tiles borrowed from the
 * Minecraft reference, everything else ours. No sky, no directional light; the only light is
 * the lantern the player carries plus a faint ambient, and the fog ends inside the server's
 * sight so the picture never shows more than the rules do. The palette is the logo's:
 * black, cracked bone-grey stone, dark brown seams.
 *
 * S15P21C204-377. The server sight is 3.5 cells. The fog closes completely at 3.4, just inside it,
 * and the camera draws to 3.6, so the corridor fades into the background instead of being cut off
 * half-fogged at the far plane.
 */
export const BLOCK = Object.freeze({
  wallHeight: 1.2,
  ceilingHeight: 1.2,
  background: '#030303',
  fogNear: 1.6,
  fogFar: 3.4,
  ambient: 0.16,
  /** Pixel tile edge; every texture in this theme is this many texels square. */
  tile: 16,
});

/**
 * The server never shows farther than this (spec 7.2). Kept here because apps/web must not import
 * game-core; `tests/contracts/view-geometry.test.ts` fixes it against the core's `VIEW_RANGE`.
 */
export const SERVER_VIEW_RANGE = 3.5;

/**
 * The carried lantern lights the scene. Its reach ends with the fog so nothing lit is hidden
 * and nothing hidden is lit. Values are tuned with block-lighting.test: a wall half a cell away
 * keeps its texture, an opponent 2.5 cells away is still a readable shape.
 */
export const BLOCK_LIGHTING = Object.freeze({
  ambientColor: '#6d7a8c',
  lantern: { color: '#ffd9a1', intensity: 3.2, distance: 4.8, decay: 1.8 },
  /** Where the lantern hangs in the player's own frame: right hand, slightly forward. */
  lanternOffset: [0.28, 0.62, -0.12] as const,
});

/** Palette of the pixel tiles, all low-luminance stone with bone-grey highlights. */
export const BLOCK_PALETTE = Object.freeze({
  stone: ['#2a2926', '#33322e', '#3c3a35', '#46433d'] as const,
  crack: '#14120f',
  bone: '#8f877a',
  moss: ['#2d3a2a', '#374733'] as const,
  wet: ['#1f2224', '#262a2d', '#2c3134'] as const,
  ceiling: ['#1b1a18', '#22211e', '#292826'] as const,
});

type Rgb = readonly [number, number, number];
function rgb(hex: string): Rgb {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as unknown as Rgb;
}

/** Deterministic LCG so a tile is the same bytes on every machine and every run. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 8;
  };
}

export type BlockTile = 'stone' | 'moss' | 'floor' | 'ceiling';

/**
 * One 16×16 tile as raw pixels. Stone shows the logo's cracked grain: a few dark fissures with
 * a bone-grey lip along one edge. Moss is stone with a green band low down. Floor is wet dark
 * stone with sparse highlights; ceiling is the darkest, almost featureless.
 */
export function blockTilePixels(kind: BlockTile, seed = 268): Uint8Array {
  const size = BLOCK.tile;
  const pixels = new Uint8Array(size * size * 4);
  const random = lcg(seed + kind.length * 97);
  const stone = BLOCK_PALETTE.stone.map(rgb);
  const wet = BLOCK_PALETTE.wet.map(rgb);
  const ceiling = BLOCK_PALETTE.ceiling.map(rgb);
  const moss = BLOCK_PALETTE.moss.map(rgb);
  const crack = rgb(BLOCK_PALETTE.crack);
  const bone = rgb(BLOCK_PALETTE.bone);
  const put = (x: number, y: number, color: Rgb) => {
    const offset = (y * size + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = 255;
  };
  // Base fill: coarse 2×2 blotches so the tile reads as pixel art, not noise.
  for (let y = 0; y < size; y += 2)
    for (let x = 0; x < size; x += 2) {
      const base = kind === 'floor' ? wet : kind === 'ceiling' ? ceiling : stone;
      const color = base[random() % base.length]!;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        put(x + dx, y + dy, color);
    }
  if (kind === 'stone' || kind === 'moss') {
    // Two fissures walking down the tile, one bone-grey lip beside the first.
    for (const [start, lip] of [
      [3 + (random() % 4), true],
      [9 + (random() % 4), false],
    ] as const) {
      let x = start;
      for (let y = 0; y < size; y += 1) {
        put(x, y, crack);
        if (lip && x + 1 < size && y % 3 !== 0) put(x + 1, y, bone);
        const step = random() % 3;
        x = Math.min(size - 1, Math.max(0, x + (step === 0 ? -1 : step === 1 ? 0 : 1)));
      }
    }
    // Mortar seam at the tile edge so stacked tiles read as blocks.
    for (let i = 0; i < size; i += 1) {
      put(i, size - 1, crack);
      put(0, i, crack);
    }
  }
  if (kind === 'moss') {
    for (let y = 10; y < size - 1; y += 1)
      for (let x = 1; x < size; x += 1) if (random() % 3 !== 0) put(x, y, moss[random() % 2]!);
  }
  if (kind === 'floor') {
    // Sparse wet highlights and a grout grid every 8 texels.
    for (let i = 0; i < 5; i += 1) put(random() % size, random() % size, bone);
    for (let i = 0; i < size; i += 1) {
      put(i, 7, crack);
      put(i, 15, crack);
      put(7, i, crack);
      put(15, i, crack);
    }
  }
  return pixels;
}

export function blockTexture(kind: BlockTile): DataTexture {
  const texture = new DataTexture(blockTilePixels(kind), BLOCK.tile, BLOCK.tile, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  // Pixel art: no smoothing between texels and no mipmaps that would blur the far wall to grey.
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createBlockResources() {
  const stone = blockTexture('stone');
  const moss = blockTexture('moss');
  const floor = blockTexture('floor');
  const ceiling = blockTexture('ceiling');
  const geometry = {
    floor: new PlaneGeometry(1, 1),
    wall: new PlaneGeometry(1, BLOCK.wallHeight),
    /** Lantern body and tools are boxes too; shared so the held tool and the sconce match. */
    cube: new BoxGeometry(1, 1, 1),
  };
  const material = {
    wall: new MeshStandardMaterial({ map: stone, roughness: 1, metalness: 0 }),
    /** Every third wall face is mossy; the choice is by cell parity, not random, so it is stable. */
    mossWall: new MeshStandardMaterial({ map: moss, roughness: 1, metalness: 0 }),
    floor: new MeshStandardMaterial({ map: floor, roughness: 0.55, metalness: 0.08 }),
    ceiling: new MeshStandardMaterial({ map: ceiling, roughness: 1, metalness: 0 }),
  };
  let disposed = false;
  return {
    geometry,
    material,
    textures: [stone, moss, floor, ceiling],
    dispose() {
      if (disposed) return;
      disposed = true;
      Object.values(geometry).forEach((resource) => resource.dispose());
      Object.values(material).forEach((resource) => resource.dispose());
      [stone, moss, floor, ceiling].forEach((texture) => texture.dispose());
    },
  };
}

/** Which wall faces get the mossy tile: a fixed pattern over the grid, the same for everyone. */
export const isMossyFace = (wall: { x: number; y: number; side: number }) =>
  (wall.x * 7 + wall.y * 3 + wall.side) % 5 === 0;

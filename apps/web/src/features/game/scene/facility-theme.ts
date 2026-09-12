import {
  BoxGeometry,
  DataTexture,
  LinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';

export const FACILITY = Object.freeze({
  wallHeight: 1.2,
  ceilingHeight: 1.2,
  background: '#080d10',
  fogNear: 1.85,
  fogFar: 3,
  ambient: 0.23,
});

/** Small deterministic textures authored here; no remote asset or server map seed. */
function surfaceTexture(floor: boolean) {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let random = floor ? 307 : 113;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const noise = (random >>> 24) / 255;
      const seam = floor && (x < 2 || y < 2 || x > 125 || y > 125);
      const streak = !floor && x % 31 < 2 ? -10 : 0;
      const shade = seam ? 20 : (floor ? 74 : 137) + noise * 19 + streak;
      const offset = (y * size + x) * 4;
      pixels[offset] = shade * 0.9;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade * 0.98;
      pixels[offset + 3] = 255;
    }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createFacilityResources() {
  const wallTexture = surfaceTexture(false);
  const floorTexture = surfaceTexture(true);
  const geometry = {
    floor: new PlaneGeometry(1, 1),
    wall: new PlaneGeometry(1, FACILITY.wallHeight),
    panel: new PlaneGeometry(1, 0.37),
    rail: new BoxGeometry(1, 0.025, 0.016),
    joint: new BoxGeometry(0.012, FACILITY.wallHeight, 0.012),
    lamp: new BoxGeometry(0.5, 0.035, 0.16),
    tube: new BoxGeometry(0.39, 0.009, 0.06),
  };
  const material = {
    wall: new MeshStandardMaterial({ map: wallTexture, roughness: 0.94 }),
    floor: new MeshStandardMaterial({ map: floorTexture, roughness: 0.7, metalness: 0.1 }),
    panel: new MeshStandardMaterial({ color: '#35514e', roughness: 0.82, metalness: 0.16 }),
    trim: new MeshStandardMaterial({ color: '#566363', roughness: 0.62, metalness: 0.42 }),
    ceiling: new MeshStandardMaterial({ color: '#263235', roughness: 0.95 }),
    housing: new MeshStandardMaterial({ color: '#142325', roughness: 0.7 }),
    tube: new MeshBasicMaterial({ color: '#e8d39a', toneMapped: false }),
  };
  let disposed = false;
  return {
    geometry,
    material,
    textures: [wallTexture, floorTexture],
    dispose() {
      if (disposed) return;
      disposed = true;
      Object.values(geometry).forEach((resource) => resource.dispose());
      Object.values(material).forEach((resource) => resource.dispose());
      wallTexture.dispose();
      floorTexture.dispose();
    },
  };
}

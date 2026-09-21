import {
  BoxGeometry,
  DataTexture,
  LinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { QualityPreset } from './quality-presets';

export const FACILITY = Object.freeze({
  wallHeight: 1.9,
  ceilingHeight: 1.9,
  wallLift: 0.35,
  background: '#211b0e',
  // S15P21C204-302. 서버 시야가 3.5→5.0셀이 되면서 두 안개 거리를 같은 비율로 올렸다. 페이드
  // 모양은 그대로 두고 늘어난 거리만 실제로 보이게 한다.
  fogNear: 2.4,
  fogFar: 4.6,
  ambient: 0.34,
});

/**
 * 시선 방향 국소 조명과 바닥광. 근접 벽 과다 노출과 원거리 가독성의 균형은 facility-lighting.test가
 * 고정한다. `distance`는 감쇠 창의 끝이라 세기·감쇠 지수를 건드리지 않고 도달만 늘리므로, 안개 끝을
 * 넘기는 값으로 두면 근접 노출은 그대로이고 먼 쪽만 읽힌다(302).
 */
export const LIGHTING = Object.freeze({
  ambientColor: '#d2bd72',
  hemisphere: { sky: '#d8c77d', ground: '#4b3b1f', intensity: 0.64 },
  spot: { color: '#ffe29a', intensity: 5.2, distance: 4.8, angle: 0.88, penumbra: 0.82, decay: 2 },
  fill: { color: '#d8b96a', intensity: 0.46, distance: 1.8, decay: 2 },
});

/** 장비·출구 표식 색. 상태는 형상으로도 구분하며 색은 HUD와 같은 규칙을 쓴다. */
export const EQUIPMENT_COLORS = Object.freeze({
  armed: '#8bdbbc',
  idle: '#d4a95d',
  sensorHousing: '#73817a',
  sensorLens: '#132325',
  trapPlate: '#57625d',
  trapInner: '#182726',
  trapJawArmed: '#d4a95d',
  trapJawIdle: '#859289',
  trapPost: '#6c7873',
  ownExit: '#b8ebca',
  otherExit: '#dfbb79',
  ownExitGlow: '#39765d',
  otherExitGlow: '#705c30',
});

/** Small deterministic carpet/fallback textures; wall PBR maps are user-provided public assets. */
function surfaceTexture(surface: 'wall' | 'floor') {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  const floor = surface === 'floor';
  let random = floor ? 307 : 113;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const noise = (random >>> 24) / 255;
      const seam = floor && (x < 2 || y < 2 || x > 125 || y > 125);
      const streak = !floor && x % 31 < 2 ? -12 : !floor && y % 43 < 1 ? -7 : 0;
      const shade = seam ? 38 : (floor ? 69 : 155) + noise * (floor ? 23 : 28) + streak;
      const offset = (y * size + x) * 4;
      pixels[offset] = floor ? shade * 0.92 : shade;
      pixels[offset + 1] = floor ? shade * 0.82 : shade * 0.78;
      pixels[offset + 2] = floor ? shade * 0.58 : shade * 0.34;
      pixels[offset + 3] = 255;
    }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export type BackroomsTextureSet = Readonly<{
  color: Texture;
  roughness?: Texture;
  normal?: Texture;
}>;

export function createFacilityResources(
  textures?: BackroomsTextureSet,
  quality: QualityPreset = 'medium',
) {
  const wallFallback = surfaceTexture('wall');
  const floorTexture = surfaceTexture('floor');
  const detailed = quality === 'medium';
  const geometry = {
    floor: new PlaneGeometry(1, 1),
    wall: new PlaneGeometry(1, FACILITY.wallHeight),
    panel: detailed ? new PlaneGeometry(1, 0.14) : null,
    rail: detailed ? new BoxGeometry(1, 0.035, 0.022) : null,
    joint: detailed ? new BoxGeometry(0.012, FACILITY.wallHeight, 0.012) : null,
    lamp: new BoxGeometry(0.5, 0.035, 0.16),
    tube: new BoxGeometry(0.39, 0.009, 0.06),
  };
  const material = {
    wall: new MeshStandardMaterial({
      color: textures ? '#ffffff' : '#b18b36',
      map: textures?.color ?? wallFallback,
      roughnessMap: detailed ? (textures?.roughness ?? null) : null,
      normalMap: detailed ? (textures?.normal ?? null) : null,
      roughness: 0.96,
      metalness: 0,
    }),
    floor: new MeshStandardMaterial({ map: floorTexture, roughness: 1, metalness: 0 }),
    panel: new MeshStandardMaterial({ color: '#6d5530', roughness: 0.9, metalness: 0.02 }),
    trim: new MeshStandardMaterial({ color: '#776342', roughness: 0.78, metalness: 0.08 }),
    ceiling: new MeshStandardMaterial({ color: '#8e825e', roughness: 1 }),
    housing: new MeshStandardMaterial({ color: '#6f694f', roughness: 0.72, metalness: 0.16 }),
    tube: new MeshBasicMaterial({ color: '#fff2bd', toneMapped: false }),
  };
  let disposed = false;
  return {
    geometry,
    material,
    textures: [wallFallback, floorTexture],
    dispose() {
      if (disposed) return;
      disposed = true;
      Object.values(geometry).forEach((resource) => resource?.dispose());
      Object.values(material).forEach((resource) => resource.dispose());
      wallFallback.dispose();
      floorTexture.dispose();
    },
  };
}

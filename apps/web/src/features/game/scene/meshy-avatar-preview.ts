type Point3 = Readonly<{ x: number; y: number; z: number }>;

export type AvatarBounds = Readonly<{
  min: Point3;
  max: Point3;
}>;

export type AvatarFit = Readonly<{
  scale: number;
  offset: readonly [number, number, number];
}>;

export type PreviewSpeed = 'native' | 'game';

const GAME_MOVE_SECONDS = 0.6;

/** Mixer multiplier used by the local comparison demo. */
export function previewPlaybackRate(speed: PreviewSpeed, sourceDuration: number, playing = true) {
  if (!playing) return 0;
  if (speed === 'native') return 1;
  return Number.isFinite(sourceDuration) && sourceDuration > 0
    ? sourceDuration / GAME_MOVE_SECONDS
    : 1;
}

/** Fits an arbitrary Meshy export to a predictable preview height and rests it on y=0. */
export function fitAvatarBounds(bounds: AvatarBounds, targetHeight: number): AvatarFit {
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0)
    throw new Error('Avatar bounds must have a positive height');
  if (!Number.isFinite(targetHeight) || targetHeight <= 0)
    throw new Error('Target height must be positive');

  const scale = targetHeight / sourceHeight;
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerZ = (bounds.min.z + bounds.max.z) / 2;
  return {
    scale,
    offset: [-centerX * scale, -bounds.min.y * scale, -centerZ * scale],
  };
}

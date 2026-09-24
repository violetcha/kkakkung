export type QualityPreset = 'medium' | 'low';
/**
 * Initial settings, not measured performance claims. D owns inference and publication.
 *
 * S15P21C204-374. dpr is a [min, max] range, so R3F follows the device ratio and only clamps it.
 * A bare number is used as-is: medium used to draw at 1.5x even on a 1x monitor, 2.25x the pixels
 * of the screen it was shown on.
 */
export const QUALITY_PRESETS = {
  medium: { dpr: [1, 1.25] as [number, number], antialias: false, postprocessing: false },
  low: { dpr: [1, 1] as [number, number], antialias: false, postprocessing: false },
} as const;
export function createQualityControl(apply: (value: QualityPreset) => void) {
  let current: QualityPreset = 'medium';
  return {
    select(value: QualityPreset) {
      if (value === current) return false;
      apply(value);
      current = value;
      return true;
    },
    get current() {
      return current;
    },
  };
}

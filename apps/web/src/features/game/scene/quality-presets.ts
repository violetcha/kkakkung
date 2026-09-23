/** Initial settings, not measured performance claims. D owns inference and publication. */
export const QUALITY_PRESETS = {
  low: { dpr: 1, antialias: false, postprocessing: false },
  medium: { dpr: 1.5, antialias: false, postprocessing: false },
} as const;
export type QualityPreset = keyof typeof QUALITY_PRESETS;
export const QUALITY_PRESET_IDS = Object.freeze(Object.keys(QUALITY_PRESETS) as QualityPreset[]);
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

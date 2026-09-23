import { expect, it, vi } from 'vitest';
import { createQualityControl, QUALITY_PRESET_IDS, QUALITY_PRESETS } from './quality-presets';

it('exposes only the product quality presets accepted by asset manifests', () => {
  expect(QUALITY_PRESET_IDS).toEqual(['low', 'medium']);
});
it('forwards each actual quality transition once and lowers render resolution', () => {
  const apply = vi.fn();
  const control = createQualityControl(apply);
  control.select('low');
  control.select('low');
  control.select('medium');
  expect(apply.mock.calls).toEqual([['low'], ['medium']]);
  expect(QUALITY_PRESETS.low.dpr).toBeLessThan(QUALITY_PRESETS.medium.dpr);
});

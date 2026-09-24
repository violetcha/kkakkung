import { expect, it, vi } from 'vitest';
import { createQualityControl, QUALITY_PRESETS } from './quality-presets';
it('forwards each actual quality transition once and lowers render resolution', () => {
  const apply = vi.fn();
  const control = createQualityControl(apply);
  control.select('low');
  control.select('low');
  control.select('medium');
  expect(apply.mock.calls).toEqual([['low'], ['medium']]);
  expect(QUALITY_PRESETS.low.dpr[1]).toBeLessThan(QUALITY_PRESETS.medium.dpr[1]);
});

// S15P21C204-374. 숫자 하나면 R3F 가 그대로 써서 배율 1 모니터도 1.5배로 그렸다. 범위의 아래는 1이라
// 1배 화면은 1배로 그리고, 고배율 화면에서만 위 한도까지 올라간다.
it('never renders a 1x screen above 1x', () => {
  for (const preset of Object.values(QUALITY_PRESETS)) {
    expect(preset.dpr[0]).toBe(1);
    expect(preset.dpr[1]).toBeLessThanOrEqual(1.25);
  }
});

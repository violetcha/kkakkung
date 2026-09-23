import { expect, it } from 'vitest';
import { shouldReportFrameMetrics } from './FrameMetrics';

it('reports inspection metrics after one second even on a low-frame-rate renderer', () => {
  expect(shouldReportFrameMetrics(1_001, 2)).toBe(true);
});

it('waits for both the reporting interval and enough samples', () => {
  expect(shouldReportFrameMetrics(999, 2)).toBe(false);
  expect(shouldReportFrameMetrics(1_001, 1)).toBe(false);
});

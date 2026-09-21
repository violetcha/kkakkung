import { expect, it } from 'vitest';

import { LAYOUT_BASE_SIZE, scaleLayoutConstraints, validateTuning } from '../../src/match/tuning.js';
import { loadTuning } from './helpers.js';

/**
 * S15P21C204-321. 배치 바닥값은 31 격자를 기준으로 쓴 절대 칸 수라, 작은 맵은 그 크기에 맞게
 * 줄여야 아무것도 놓을 수 없게 되지 않는다. 한 변에 비례하며 면적이 아니다. 기준 이상 크기는
 * 쓴 값을 그대로 쓴다 — master-v1(32)이 조용히 더 빡빡해지면 안 된다.
 */
const tuning = validateTuning(loadTuning());
if (!tuning.ok) throw new Error('tuning invalid');
const base = tuning.template.layout;

it('leaves the written floors alone at or above the base grid', () => {
  expect(scaleLayoutConstraints(base, LAYOUT_BASE_SIZE)).toBe(base);
  // master-v1 은 32 다. 32/31 로 올려 잡으면 이미 인증된 배치가 떨어진다.
  expect(scaleLayoutConstraints(base, 32)).toBe(base);
  expect(scaleLayoutConstraints(base, 64)).toBe(base);
});

it('scales every length floor by one side and leaves the unitless ones', () => {
  const small = scaleLayoutConstraints(base, 15);
  const medium = scaleLayoutConstraints(base, 23);
  const at = (value: number, size: number) => Math.max(1, Math.round((value * size) / 31));
  for (const [size, scaled] of [
    [15, small],
    [23, medium],
  ] as const) {
    expect(scaled.minRunnerDistance).toBe(at(base.minRunnerDistance, size));
    expect(scaled.minRunnerTaggerDistance).toBe(at(base.minRunnerTaggerDistance, size));
    expect(scaled.minExitDistance).toBe(at(base.minExitDistance, size));
    expect(scaled.minExitPathLength).toBe(at(base.minExitPathLength, size));
    expect(scaled.maxExitPathLength).toBe(at(base.maxExitPathLength, size));
    // 비율과 이웃 수는 단위가 없다.
    expect(scaled.maxExitRatio).toBe(base.maxExitRatio);
    expect(scaled.minSpawnNeighbors).toBe(base.minSpawnNeighbors);
  }
  // 작은 맵일수록 더 낮다. 한 변 비례라 반드시 단조롭다.
  expect(small.minRunnerTaggerDistance).toBeLessThan(medium.minRunnerTaggerDistance);
  expect(medium.minRunnerTaggerDistance).toBeLessThan(base.minRunnerTaggerDistance);
});

it('never lets a floor fall to zero on a tiny grid', () => {
  const tiny = scaleLayoutConstraints(base, 1);
  expect(tiny.minRunnerDistance).toBeGreaterThanOrEqual(1);
  expect(tiny.minExitDistance).toBeGreaterThanOrEqual(1);
  expect(tiny.maxExitPathLength).toBeGreaterThanOrEqual(1);
});

it('ignores a size that is not a usable number', () => {
  for (const size of [0, -5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(scaleLayoutConstraints(base, size)).toBe(base);
});

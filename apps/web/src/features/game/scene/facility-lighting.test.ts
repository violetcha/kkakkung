import { expect, it } from 'vitest';
import { FACILITY, LIGHTING } from './facility-theme';

/** 머리 조명이 distance 앞 표면에 주는 상대 조도(three의 물리 감쇠 근사). */
const spotTerm = (distance: number) => LIGHTING.spot.intensity / distance ** LIGHTING.spot.decay;

it('does not wash out a wall half a cell away while keeping the far end readable', () => {
  // 회전 중 0.5셀 거리 벽: 기준값 8/0.25 = 32에서 질감이 사라졌다.
  expect(spotTerm(0.5)).toBeLessThanOrEqual(24);
  // 2.5셀 앞(안개 시작 뒤)에도 조명과 바닥광이 남아 상대·출구를 읽을 수 있어야 한다.
  expect(spotTerm(2.5) + LIGHTING.hemisphere.intensity + FACILITY.ambient).toBeGreaterThan(1.6);
  expect(LIGHTING.spot.distance).toBeGreaterThan(FACILITY.fogFar);
});

it('lifts the floor level without flattening contrast', () => {
  // 천장·바닥이 완전한 검정에서 벗어나되 국소 조명이 여전히 지배한다.
  expect(LIGHTING.hemisphere.intensity).toBeGreaterThanOrEqual(0.6);
  expect(FACILITY.ambient).toBeGreaterThanOrEqual(0.28);
  expect(spotTerm(1)).toBeGreaterThan(3 * (LIGHTING.hemisphere.intensity + FACILITY.ambient));
  expect(FACILITY.fogNear).toBeLessThan(FACILITY.fogFar);
  expect(FACILITY.fogFar).toBe(3);
});

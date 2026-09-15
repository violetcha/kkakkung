import { expect, it } from 'vitest';
import { verticalFov } from './FirstPersonCamera';
import { CHARACTER } from './scene-model';
import { TRAP_MODEL, trapJawHeight, trapTopHeight } from './equipment-model';

/** 카메라(pitch 0)가 distance 앞 바닥에서 볼 수 있는 가장 낮은 높이. */
const floorSightLimit = (aspect: number, distance: number) =>
  CHARACTER.eyeHeight - distance * Math.tan((verticalFov(aspect) * Math.PI) / 360);

it('the trap rises into view from the adjacent cell on wide product canvases', () => {
  for (const aspect of [16 / 9, 2, 21 / 9]) {
    const limit = floorSightLimit(aspect, 1);
    expect(limit).toBeGreaterThan(TRAP_MODEL.jaw.armedHeight);
    expect(trapTopHeight()).toBeGreaterThanOrEqual(limit + 0.04);
  }
  expect(trapTopHeight()).toBeLessThan(CHARACTER.eyeHeight);
});

it('keeps the armed trap distinguishable by jaw shape, not colour alone', () => {
  expect(trapJawHeight('ARMED')).toBeGreaterThan(trapJawHeight('UNARMED') * 3);
  expect(TRAP_MODEL.post.height).toBeGreaterThan(TRAP_MODEL.plate.height * 10);
});

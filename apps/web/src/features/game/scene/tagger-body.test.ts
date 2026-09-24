// S15P21C204-378. 술래는 부피로 커지고, 얼굴 판·천장·복도 폭은 넘지 않는다. 합친 도형은 상자를 빠짐없이 담는다.
import { expect, it } from 'vitest';
import { AVATAR } from './FaceAvatar';
import { BLOCK } from './block-theme';
import { CELL, CHARACTER } from './scene-model';
import { ROLE_SILHOUETTE } from './role-colors';
import { WALK } from './walk-pose';
import { TAGGER_BODY, createTaggerGeometry, type BodyBox, type Vec3 } from './tagger-body';

const T = TAGGER_BODY;
const moved = (boxes: readonly BodyBox[], [x, y, z]: Vec3): BodyBox[] =>
  boxes.map(({ size, at }) => ({ size, at: [at[0] + x, at[1] + y, at[2] + z] }));
const mirrored = (pivot: Vec3): Vec3[] => [[-pivot[0], pivot[1], pivot[2]], pivot];
/** 서 있는 자세의 술래 상자 전부(몸 + 양팔 + 양다리). */
const all: BodyBox[] = [
  ...T.body.hide,
  ...T.body.dark,
  ...T.body.eye,
  ...mirrored(T.arm.pivot).flatMap((p) => moved([...T.arm.hide, ...T.arm.dark], p)),
  ...mirrored(T.leg.pivot).flatMap((p) => moved([...T.leg.hide, ...T.leg.dark], p)),
];
const low = (b: BodyBox, i: number) => b.at[i]! - b.size[i]! / 2;
const high = (b: BodyBox, i: number) => b.at[i]! + b.size[i]! / 2;
const FACE = { half: 0.418 / 2, z: -0.241 };

it('keeps the face plane uncovered, with the first-person eye inside it', () => {
  expect(Math.abs(CHARACTER.eyeHeight - AVATAR.headY)).toBeLessThan(FACE.half);
  // 얼굴 판 앞쪽에 놓인 상자는 판의 사각형과 겹치지 않는다.
  for (const b of all.filter((b) => low(b, 2) < FACE.z)) {
    const overlapsX = low(b, 0) < FACE.half && high(b, 0) > -FACE.half;
    const overlapsY = low(b, 1) < AVATAR.headY + FACE.half && high(b, 1) > AVATAR.headY - FACE.half;
    expect(overlapsX && overlapsY, JSON.stringify(b)).toBe(false);
  }
});

it('stays under the lowest ceiling at the top of a stride, badge included', () => {
  const top = Math.max(...all.map((b) => high(b, 1)));
  expect(top + WALK.bobHeight).toBeLessThan(BLOCK.ceilingHeight - 0.1);
  expect(T.badgeY - 0.032).toBeGreaterThan(top);
  expect(T.badgeY + 0.032 + WALK.bobHeight).toBeLessThan(BLOCK.ceilingHeight);
});

it('fits a one-cell corridor with its arms at its sides', () => {
  const halfWidth = Math.max(...all.map((b) => Math.max(high(b, 0), -low(b, 0))));
  expect(halfWidth).toBeLessThanOrEqual(CELL / 2 - 0.05);
  // 도망자보다 확실히 넓다.
  expect(halfWidth).toBeGreaterThan(ROLE_SILHOUETTE.runner.shoulder);
});

it('hangs its claws below the knee and stands its feet on the floor', () => {
  const armBottom =
    T.arm.pivot[1] + Math.min(...[...T.arm.hide, ...T.arm.dark].map((b) => low(b, 1)));
  expect(armBottom).toBeLessThan(T.leg.pivot[1]);
  expect(armBottom).toBeGreaterThan(0.05);
  const foot = T.leg.pivot[1] + Math.min(...[...T.leg.hide, ...T.leg.dark].map((b) => low(b, 1)));
  expect(foot).toBeCloseTo(0);
});

it('merges every box into one geometry per material and limb', () => {
  const geometry = createTaggerGeometry();
  try {
    // 단위 큐브 하나는 꼭짓점 24개다. 합친 도형은 상자 수만큼을 빠짐없이 담는다.
    const count = (g: { getAttribute(name: string): { count: number } }) =>
      g.getAttribute('position').count / 24;
    expect(count(geometry.bodyHide)).toBe(T.body.hide.length);
    expect(count(geometry.bodyDark)).toBe(T.body.dark.length);
    expect(count(geometry.bodyEye)).toBe(T.body.eye.length);
    expect(count(geometry.armHide) + count(geometry.armDark)).toBe(
      T.arm.hide.length + T.arm.dark.length,
    );
    expect(count(geometry.legHide) + count(geometry.legDark)).toBe(
      T.leg.hide.length + T.leg.dark.length,
    );
  } finally {
    Object.values(geometry).forEach((g) => g.dispose());
  }
});

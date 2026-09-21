// Local unit coverage only: pure constants and trigonometry, no browser, renderer or server.
//
// `apps/web` may not import `game-core` (dependency boundary), so the server's vision geometry is
// copied into the web sources by hand. Both copies are checked only against other web values —
// `block-theme.test` compares fog to the web's own `SERVER_VIEW_RANGE`, `visibility-mask.test`
// compares the camera to a hardcoded 80 degrees. Neither would notice the core changing. A
// contract test is the one place that can import both sides, so the two copies are pinned here.
import { expect, it } from 'vitest';

import { SERVER_VIEW_RANGE } from '../../apps/web/src/features/game/scene/block-theme';
import { verticalFov } from '../../apps/web/src/features/game/scene/FirstPersonCamera';
import { visibilityMask } from '../../apps/web/src/features/game/scene/visibility-mask';
import { viewFixture } from '../../apps/web/src/features/room/product-fixture';
import { FOV_HALF_DEGREES, VIEW_RANGE } from '../../packages/game-core/src/match/vision/visibility';

/** Screen shapes the game actually meets: portrait phone, laptop, ultrawide, and a near-square. */
const ASPECTS = [9 / 16, 3 / 4, 1, 16 / 9, 32 / 9] as const;

/** three.js takes a vertical FOV in degrees; the cone the core uses is horizontal. */
function horizontalFovDegrees(aspect: number): number {
  const halfVerticalRad = (verticalFov(aspect) * Math.PI) / 360;
  return (2 * Math.atan(Math.tan(halfVerticalRad) * aspect) * 180) / Math.PI;
}

it('draws exactly as far as the core is willing to call visible', () => {
  // If the core widens its range and this copy stays behind, players are told about cells the
  // renderer fogs away; if it narrows, the renderer draws cells the server has already hidden.
  expect(SERVER_VIEW_RANGE).toBe(VIEW_RANGE);
});

it('서버가 보낸 셀을 렌더러로 가는 길에 하나도 버리지 않는다', () => {
  // 289 는 마스크가 들고 있던 반지름을 코어 상수에 맞췄지만, 거리를 재는 방법이 달라
  // 누락이 남았다(301). 코어는 카메라에서 셀의 샘플점까지, 마스크는 정수 좌표끼리 쟀다.
  // 이제 마스크는 아예 자르지 않는다. 실제 코어 출력과의 대조는
  // `server-sight-fidelity.test.ts` 가 여섯 사례로 본다.
  const origin = { x: 1, y: 1 };
  const diagonal = { x: 2, y: 4 };
  const farther = { x: 1, y: 6 };
  const distance = (cell: { x: number; y: number }) =>
    Math.hypot(cell.x - origin.x, cell.y - origin.y);
  // 예전 하드코딩 3 과 코어 범위 사이에 있던 셀, 그리고 정수 거리로는 범위 밖인 셀.
  expect(distance(diagonal)).toBeLessThanOrEqual(VIEW_RANGE);
  expect(distance(diagonal)).toBeGreaterThan(3);
  expect(distance(farther)).toBeGreaterThan(VIEW_RANGE);

  const cells = [origin, diagonal, farther];
  expect(visibilityMask(viewFixture({ visibleCells: cells })).cells).toEqual(cells);
});

it.each(ASPECTS)('keeps the core cone horizontally at aspect %f', (aspect) => {
  expect(horizontalFovDegrees(aspect)).toBeCloseTo(2 * FOV_HALF_DEGREES, 6);
});

it('derives the camera from the core angle rather than a fixed 80 degrees', () => {
  // The equality above holds for any single aspect even if the camera ignored the core entirely,
  // so pin the shape too: the horizontal angle must stay put while the vertical one moves with
  // the screen. A camera that hardcoded a vertical angle would fail this.
  const horizontal = ASPECTS.map(horizontalFovDegrees);
  const vertical = ASPECTS.map(verticalFov);
  expect(Math.max(...horizontal) - Math.min(...horizontal)).toBeLessThan(1e-6);
  expect(Math.max(...vertical) - Math.min(...vertical)).toBeGreaterThan(1);
});

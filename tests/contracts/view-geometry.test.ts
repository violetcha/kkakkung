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

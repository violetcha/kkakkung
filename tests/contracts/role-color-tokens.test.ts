// Local unit coverage only: reads a stylesheet from disk and compares strings. No browser.
//
// S15P21C204-268 decided the 3D avatar cloth and the HUD/minimap tokens carry the same hex, and
// `role-colors.ts` is the source. `roleColorsCss()` calls itself "the one line the web tokens copy
// from", but nothing actually copies it: `styles.css` was written by hand and is a third copy.
// The existing tests each compare a pair that can agree while the roles diverge — `role-colors`
// compares the source to its own derived string, `design-foundation` compares the stylesheet to
// its own literals. Only a contract test can read the source and the stylesheet together.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { ROLE_COLORS, roleColorsCss } from '../../apps/web/src/features/game/scene/role-colors';

const STYLESHEET = readFileSync(
  fileURLToPath(new URL('../../apps/web/src/styles.css', import.meta.url)),
  'utf8',
);

/** `roleColorsCss()` returns the declarations on one line; the stylesheet writes one per line. */
function declarations(): string[] {
  return roleColorsCss()
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => `${part};`);
}

it('carries every declaration the avatar source hands out', () => {
  const emitted = declarations();
  expect(emitted).toHaveLength(2);
  for (const declaration of emitted) expect(STYLESHEET).toContain(declaration);
});

it('never writes a role hex the avatar does not use', () => {
  // The direction above only catches a stylesheet left behind. This catches a second, stale
  // definition added alongside the right one, which would win or lose by cascade order.
  const written = [...STYLESHEET.matchAll(/--role-(tagger|runner):\s*([^;]+);/g)];
  expect(written).toHaveLength(2);
  for (const [, role, value] of written) {
    expect(value!.trim()).toBe(ROLE_COLORS[role as 'tagger' | 'runner'].cloth);
  }
});

it('keeps the older token names as aliases rather than separate colours', () => {
  // `--color-tagger`/`--color-runner` predate 268. They must point at the role tokens, not hold
  // their own hex, or the HUD drifts from the avatar again through the older name.
  expect(STYLESHEET).toContain('--color-tagger: var(--role-tagger);');
  expect(STYLESHEET).toContain('--color-runner: var(--role-runner);');
});

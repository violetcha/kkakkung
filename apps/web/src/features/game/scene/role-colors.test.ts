import { expect, it } from 'vitest';
import { ROLE_COLORS, ROLE_SILHOUETTE, relativeLuminance, roleColorsCss } from './role-colors';

it('gives both roles cloth bright enough to read at the edge of the lantern', () => {
  for (const role of ['tagger', 'runner'] as const) {
    expect(relativeLuminance(ROLE_COLORS[role].cloth)).toBeGreaterThan(0.1);
    expect(relativeLuminance(ROLE_COLORS[role].accent)).toBeGreaterThan(
      relativeLuminance(ROLE_COLORS[role].cloth),
    );
  }
});

it('separates the roles by hue, not only by brightness', () => {
  const [tr, tg, tb] = [1, 3, 5].map((i) => parseInt(ROLE_COLORS.tagger.cloth.slice(i, i + 2), 16));
  const [rr, rg, rb] = [1, 3, 5].map((i) => parseInt(ROLE_COLORS.runner.cloth.slice(i, i + 2), 16));
  // Tagger is red-led, runner is green/blue-led: the dominant channels differ.
  expect(tr!).toBeGreaterThan(tg! + tb!);
  expect(rg! + rb!).toBeGreaterThan(rr! * 2);
});

it('changes shape as well as colour, so a colour-blind player still tells them apart', () => {
  expect(ROLE_SILHOUETTE.tagger.shoulder).toBeGreaterThan(ROLE_SILHOUETTE.runner.shoulder);
  expect(ROLE_SILHOUETTE.tagger.brim).not.toBe(ROLE_SILHOUETTE.runner.brim);
  expect(ROLE_SILHOUETTE.tagger.satchel).not.toBe(ROLE_SILHOUETTE.runner.satchel);
});

it('hands the same hex values to the CSS tokens', () => {
  expect(roleColorsCss()).toContain(`--role-tagger: ${ROLE_COLORS.tagger.cloth};`);
  expect(roleColorsCss()).toContain(`--role-runner: ${ROLE_COLORS.runner.cloth};`);
});

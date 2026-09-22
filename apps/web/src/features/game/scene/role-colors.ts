import type { Role } from '@kkakkung/protocol/game-schema';

/**
 * S15P21C204-268 (W1). Role colours for the avatar and, through the same hex values, the HUD
 * and minimap tokens. Both are bright against the dark block palette so a figure at the edge
 * of sight (three cells, backlit) still reads as tagger or runner; the silhouette differs too,
 * so colour is never the only cue. `roleColorsCss` is the one line the web tokens copy from.
 */
export const ROLE_COLORS = Object.freeze({
  tagger: Object.freeze({ cloth: '#b8402f', accent: '#f0a070', boot: '#3a1a14' }),
  runner: Object.freeze({ cloth: '#2f9f96', accent: '#8fe6d8', boot: '#12302e' }),
}) satisfies Readonly<Record<Role, Readonly<{ cloth: string; accent: string; boot: string }>>>;

/**
 * Body shape per role, in scene units. A tagger is broader with a visor brim; a runner is
 * narrower and carries a satchel. Neither changes where the real face plane sits.
 */
export const ROLE_SILHOUETTE = Object.freeze({
  tagger: Object.freeze({ shoulder: 0.42, brim: true, satchel: false }),
  runner: Object.freeze({ shoulder: 0.32, brim: false, satchel: true }),
}) satisfies Readonly<
  Record<Role, Readonly<{ shoulder: number; brim: boolean; satchel: boolean }>>
>;

/** CSS custom properties the HUD/minimap tokens should carry, with the same hex as the 3D cloth. */
export const roleColorsCss = () =>
  `--role-tagger: ${ROLE_COLORS.tagger.cloth}; --role-runner: ${ROLE_COLORS.runner.cloth};`;

/**
 * Relative luminance (sRGB, WCAG) of a #rrggbb colour.
 *
 * S15P21C204-329. Nothing at runtime calls this, and that is on purpose: it exists so
 * `role-colors.test` and `block-theme.test` can hold the shipped palettes to a brightness and a
 * cloth/accent separation that a hex value alone does not show. Deleting it as an unused export
 * would delete those checks, so it stays here beside the colours it is about.
 */
export function relativeLuminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

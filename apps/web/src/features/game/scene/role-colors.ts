import type { Role } from '@kkakkung/protocol/game-schema';

/**
 * S15P21C204-268 (W1). Bright HUD and minimap role tokens. The GLB avatar materials are authored
 * in the versioned asset atlas instead of borrowing these interface colours.
 */
export const ROLE_COLORS = Object.freeze({
  tagger: Object.freeze({ cloth: '#b8402f', accent: '#f0a070', boot: '#3a1a14' }),
  runner: Object.freeze({ cloth: '#2f9f96', accent: '#8fe6d8', boot: '#12302e' }),
}) satisfies Readonly<Record<Role, Readonly<{ cloth: string; accent: string; boot: string }>>>;

/** CSS custom properties used by the HUD and minimap. */
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

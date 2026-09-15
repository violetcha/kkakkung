import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { EQUIPMENT_COLORS } from '../scene/facility-theme';

it('HUD state colours match the 3D equipment lamps', () => {
  const css = readFileSync(new URL('../../../styles.css', import.meta.url), 'utf8');
  expect(css).toContain(`--hud-armed: ${EQUIPMENT_COLORS.armed};`);
  expect(css).toContain(`--hud-idle: ${EQUIPMENT_COLORS.idle};`);
  expect(css).toContain("[data-state='restrained']");
  expect(css).toContain("[data-state='immune']");
});

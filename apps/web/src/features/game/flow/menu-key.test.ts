import { describe, expect, it } from 'vitest';
import { togglesMenu } from './menu-key';

describe('togglesMenu', () => {
  it('toggles the menu on a fresh Esc outside an exit challenge', () => {
    expect(togglesMenu({ key: 'Escape', repeat: false }, false)).toBe(true);
  });

  it('leaves the menu alone while an exit challenge owns Esc', () => {
    expect(togglesMenu({ key: 'Escape', repeat: false }, true)).toBe(false);
  });

  it('ignores held Esc and other keys', () => {
    expect(togglesMenu({ key: 'Escape', repeat: true }, false)).toBe(false);
    expect(togglesMenu({ key: 'e', repeat: false }, false)).toBe(false);
  });
});

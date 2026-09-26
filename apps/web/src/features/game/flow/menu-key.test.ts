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

// S15P21C204-402. 글자 입력 칸·드롭다운의 Esc 는 그 요소가 쓴다. 음량 막대 같은 입력은 창을 여닫는다.
describe('togglesMenu with a focused element', () => {
  const esc = (target: object) =>
    togglesMenu({ key: 'Escape', repeat: false, target: target as EventTarget }, false);
  it('leaves Escape to text fields and dropdowns', () => {
    expect(esc({ tagName: 'SELECT' })).toBe(false);
    expect(esc({ tagName: 'TEXTAREA' })).toBe(false);
    expect(esc({ tagName: 'INPUT', type: 'text' })).toBe(false);
    expect(esc({ tagName: 'DIV', isContentEditable: true })).toBe(false);
  });
  it('still opens the menu from sliders, checkboxes and buttons', () => {
    expect(esc({ tagName: 'INPUT', type: 'range' })).toBe(true);
    expect(esc({ tagName: 'INPUT', type: 'checkbox' })).toBe(true);
    expect(esc({ tagName: 'BUTTON' })).toBe(true);
  });
});

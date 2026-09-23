import { expect, it } from 'vitest';
import {
  MINIMAP_ZOOM_MS,
  easeMinimapZoom,
  minimapZoomAt,
  togglesMinimapZoom,
} from './minimap-zoom';

// S15P21C204-352. M 은 화면 축척만 바꾼다. 게임 입력과 같은 자리에서 경쟁하지 않는다.
it('toggles on M alone and never while typing, repeating or with a modifier', () => {
  expect(togglesMinimapZoom({ code: 'KeyM' })).toBe(true);
  expect(togglesMinimapZoom({ code: 'KeyW' })).toBe(false);
  expect(togglesMinimapZoom({ code: 'KeyM', repeat: true })).toBe(false);
  expect(togglesMinimapZoom({ code: 'KeyM', isComposing: true })).toBe(false);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey'])
    expect(togglesMinimapZoom({ code: 'KeyM', [modifier]: true })).toBe(false);
  const input = { tagName: 'INPUT' } as unknown as EventTarget;
  expect(togglesMinimapZoom({ code: 'KeyM', target: input })).toBe(false);
});

it('eases the transition and lands exactly on both ends', () => {
  expect(easeMinimapZoom(0)).toBe(0);
  expect(easeMinimapZoom(1)).toBe(1);
  expect(easeMinimapZoom(0.5)).toBeCloseTo(0.5, 6);
  // 가운데가 양 끝보다 빠르다.
  expect(easeMinimapZoom(0.25)).toBeLessThan(0.25);
  expect(easeMinimapZoom(0.75)).toBeGreaterThan(0.75);

  expect(minimapZoomAt(0, 1, 0)).toBe(0);
  expect(minimapZoomAt(0, 1, MINIMAP_ZOOM_MS)).toBe(1);
  expect(minimapZoomAt(0, 1, MINIMAP_ZOOM_MS * 3)).toBe(1);
  expect(minimapZoomAt(0, 1, MINIMAP_ZOOM_MS / 2)).toBeCloseTo(0.5, 6);
});

it('returns from where it is when the toggle flips mid transition', () => {
  const half = minimapZoomAt(0, 1, MINIMAP_ZOOM_MS / 2);
  // 절반에서 되돌리면 남은 거리(0.5)만큼의 시간만 쓴다.
  expect(minimapZoomAt(half, 0, 0)).toBe(half);
  expect(minimapZoomAt(half, 0, MINIMAP_ZOOM_MS * 0.5)).toBe(0);
  expect(minimapZoomAt(half, 0, MINIMAP_ZOOM_MS * 0.25)).toBeLessThan(half);
});

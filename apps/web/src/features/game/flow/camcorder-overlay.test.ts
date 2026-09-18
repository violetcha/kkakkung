import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CamcorderOverlay, formatRecordingTime, GameStatusChrome } from './CamcorderOverlay';

describe('formatRecordingTime', () => {
  it('keeps a fixed hours, minutes and seconds camcorder readout', () => {
    expect(formatRecordingTime(4)).toBe('00:00:04');
    expect(formatRecordingTime(3_661)).toBe('01:01:01');
    expect(formatRecordingTime(-1)).toBe('00:00:00');
  });
});

it('keeps authoritative status in an accessibility-only layer behind the camera chrome', () => {
  const html = renderToStaticMarkup(
    createElement(GameStatusChrome, {
      startedAtMs: 1_000,
      nowMs: 5_000,
      status: createElement('p', null, '남은 시간 02:55'),
    }),
  );

  expect(html).toContain('class="camcorder-overlay"');
  expect(html).toContain('class="game-status-a11y"');
  expect(html).toContain('남은 시간 02:55');
  expect(html).not.toContain('event-log');
});

it('exposes the recording state while keeping four frame corners decorative', () => {
  const html = renderToStaticMarkup(
    createElement(CamcorderOverlay, { startedAtMs: 1_000, nowMs: 5_000 }),
  );

  expect(html).toContain('class="camcorder-overlay"');
  expect(html).toContain('aria-label="녹화 중 00:00:04"');
  expect(html).toContain('class="camcorder-rec-dot"');
  expect(html.match(/camcorder-corner/g)).toHaveLength(4);
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CueFlash, CUE_FLASH_LABEL } from './CueFlash';
import { CAPTURE_PROGRESS_FLASHES, EFFECT_FLASHES, FLASH_CUES } from './match-cues';

it('renders a labeled full-screen flash per kind and nothing without a flash', () => {
  expect(renderToStaticMarkup(createElement(CueFlash, { flash: null }))).toBe('');
  // S15P21C204-307. 서버 효과음 플래시도 같은 자리를 쓴다.
  for (const kind of [...FLASH_CUES, ...EFFECT_FLASHES, ...CAPTURE_PROGRESS_FLASHES]) {
    const html = renderToStaticMarkup(createElement(CueFlash, { flash: { kind, id: 1 } }));
    expect(html).toContain(`data-cue="${kind}"`);
    expect(html).toContain('class="cue-flash"');
    expect(html).toContain('role="status"');
    expect(html).toContain(CUE_FLASH_LABEL[kind]);
  }
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CueFlash, CUE_FLASH_LABEL } from './CueFlash';
import { FLASH_CUES } from './match-cues';

it('renders a labeled full-screen flash per kind and nothing without a flash', () => {
  expect(renderToStaticMarkup(createElement(CueFlash, { flash: null }))).toBe('');
  for (const kind of FLASH_CUES) {
    const html = renderToStaticMarkup(createElement(CueFlash, { flash: { kind, id: 1 } }));
    expect(html).toContain(`data-cue="${kind}"`);
    expect(html).toContain('class="cue-flash"');
    expect(html).toContain('role="status"');
    expect(html).toContain(CUE_FLASH_LABEL[kind]);
  }
});

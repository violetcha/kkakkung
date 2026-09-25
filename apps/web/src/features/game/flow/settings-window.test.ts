/**
 * S15P21C204-398. 목록 맨 위 단추(돌아가기·계속하기)도 잠글 수 있어야 한다. 입장 중에는 입장 창의
 * `돌아가기`가 눌리지 않는다.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SettingsWindow } from './SettingsWindow';

const render = (disabled: boolean) =>
  renderToStaticMarkup(
    createElement(SettingsWindow, {
      variant: 'inline',
      eyebrow: 'ENTRY',
      title: '입장',
      tabs: [{ id: 'room', label: '방', content: null }],
      lead: { label: '돌아가기', disabled, run: () => {} },
    }),
  );
const lead = (html: string) => /<button[^>]*class="pause-resume"[^>]*>/.exec(html)?.[0] ?? '';

it('locks the lead action while it is disabled', () => {
  expect(lead(render(true))).toContain('disabled');
  expect(lead(render(false))).not.toContain('disabled');
});

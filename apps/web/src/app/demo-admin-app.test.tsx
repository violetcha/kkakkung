import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DemoAdminApp } from './DemoAdminApp';

it('renders a dedicated operator page with a role choice and no administrator credential field', () => {
  const html = renderToStaticMarkup(createElement(DemoAdminApp));
  expect(html).toContain('데모 방 열기');
  expect(html).toContain('도망자');
  expect(html).toContain('술래');
  expect(html).toContain('데모 시작');
  expect(html).not.toContain('OPS_TOKEN');
  expect(html).not.toContain('비밀번호');
});

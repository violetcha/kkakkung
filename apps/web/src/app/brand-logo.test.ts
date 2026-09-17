import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { BrandLogo } from './BrandLogo';

test('공통 흐름 헤더에 접근 가능한 까꿍 로고를 표시한다', () => {
  const html = renderToStaticMarkup(createElement(BrandLogo));

  expect(html).toContain('class="brand-logo"');
  expect(html).toContain('src="/brand/kkakkung-logo.svg"');
  expect(html).toContain('alt="까꿍"');
  expect(html).toContain('width="184"');
  expect(html).toContain('height="64"');
});

test('로고 워드마크는 설치 글꼴에 의존하지 않는 벡터 경로다', () => {
  const svg = readFileSync(
    new URL('../../public/brand/kkakkung-logo.svg', import.meta.url),
    'utf8',
  );

  expect(svg).not.toContain('<text');
  expect(svg).toContain('<g fill="#f4ead7"');
});

import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { BrandLogo } from './BrandLogo';

test('공통 흐름 헤더에 접근 가능한 까꿍 로고를 표시한다', () => {
  const html = renderToStaticMarkup(createElement(BrandLogo));

  expect(html).toContain('class="brand-logo"');
  expect(html).toContain('src="/brand/kkakkung-logo.png"');
  expect(html).toContain('alt="까꿍"');
  expect(html).toContain('width="184"');
  expect(html).toContain('height="195"');
});

test('제공된 로고 PNG의 크기와 형식을 그대로 유지한다', () => {
  const png = readFileSync(new URL('../../public/brand/kkakkung-logo.png', import.meta.url));

  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.readUInt32BE(16)).toBe(366);
  expect(png.readUInt32BE(20)).toBe(388);
});

test('브라우저 탭도 신규 까꿍 로고를 사용한다', () => {
  const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  expect(indexHtml).toContain(
    '<link rel="icon" type="image/png" href="/brand/kkakkung-logo.png" />',
  );
});

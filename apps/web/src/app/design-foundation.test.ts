import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('갈무리 네 글꼴을 로컬 WOFF2로 제공한다', () => {
  const fonts = {
    'Galmuri9.woff2': '275d995906625eaaa5d2d9baa0a80f90a5c033c381c0dc2108a8729d371041a6',
    'Galmuri11.woff2': 'f467d1b10e6b88dfa8399c9f93b38c7643e050abfe4fc15800ac0b000f5a57d6',
    'Galmuri11-Bold.woff2': '8643094f395aa2dbad6bc4385cc043314801eaec2e759d549435ec8ac4f2d078',
    'Galmuri14.woff2': '79b34b22b86536d0fe9ebe7105dd5f20f56558d691c67a0c6432807a03ec5a82',
  };

  for (const [file, hash] of Object.entries(fonts)) {
    const bytes = readFileSync(new URL(`../../public/fonts/${file}`, import.meta.url));
    expect(css).toContain(`url('/fonts/${file}') format('woff2')`);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  }
});

test('제품 글꼴은 갈무리14와 시스템 한글 글꼴로 순서대로 대체된다', () => {
  expect(css).toContain(
    "--font-body: Galmuri14, Pretendard, 'Noto Sans KR', system-ui, sans-serif;",
  );
  expect(css).toContain(
    "--font-control: Galmuri11, Galmuri14, Pretendard, 'Noto Sans KR', system-ui, sans-serif;",
  );
  expect(css).toContain(
    "--font-small: Galmuri9, Galmuri14, Pretendard, 'Noto Sans KR', system-ui, sans-serif;",
  );
  expect(css).toContain('--text-small: 9px;');
  expect(css).toContain('--text-control: 11px;');
  expect(css).toContain('--text-body: 14px;');
  expect(css).toContain('--text-heading: 28px;');
  expect(css).toContain('--text-hero: 56px;');
  expect(css).toContain('-webkit-font-smoothing: none;');
});

test('제품 공지와 사건 플래시는 정수 도트 배율만 사용한다', () => {
  expect(css).toMatch(/\.product-shell \.notice \{[^}]*font-size: var\(--text-body\);/s);
  expect(css).toMatch(/\.cue-flash \{[^}]*font-size: var\(--text-hero\);/s);
  expect(css).toMatch(
    /@media \(max-width: 600px\) \{\s*\.cue-flash \{\s*font-size: var\(--text-heading\);/s,
  );
});

test('폰트 배포물에 수정하지 않은 OFL 1.1 원문을 함께 둔다', () => {
  const license = readFileSync(new URL('../../public/fonts/OFL-1.1.txt', import.meta.url), 'utf8');

  expect(createHash('sha256').update(license).digest('hex')).toBe(
    '86a3ee9495f942f0243f18c103da9faca27adb88142613edb8bb852e56c892c1',
  );
  expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
});

test('픽셀 카드 토큰은 반투명 판과 간격·모서리·이중 선 규칙을 제공한다', () => {
  for (const declaration of [
    '--color-panel: #171310e6;',
    '--space-1: 4px;',
    '--space-2: 8px;',
    '--space-3: 16px;',
    '--space-4: 32px;',
    '--radius-pixel: 2px;',
    '--outline-pixel: 3px solid var(--color-bg);',
    '--inset-highlight: inset 0 0 0 1px #f4ead755;',
  ]) {
    expect(css).toContain(declaration);
  }
});

test('HUD 역할 토큰은 블록 아바타 원본 색을 그대로 쓴다', () => {
  expect(css).toContain('--role-tagger: #b8402f;');
  expect(css).toContain('--role-runner: #2f9f96;');
});

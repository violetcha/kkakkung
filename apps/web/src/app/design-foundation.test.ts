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

test('제품 글꼴은 픽셀 글꼴 대신 시스템 고딕을 사용한다', () => {
  expect(css).toContain(
    "--font-body: 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;",
  );
  expect(css).toContain(
    "--font-control: 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;",
  );
  expect(css).toContain(
    "--font-small: 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;",
  );
  expect(css).toContain('--text-small: 12px;');
  expect(css).toContain('--text-control: 14px;');
  expect(css).toContain('--text-body: 14px;');
  expect(css).toContain('--text-heading: 28px;');
  expect(css).toContain('--text-hero: 56px;');
  expect(css).toContain('-webkit-font-smoothing: antialiased;');
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

// S15P21C204-295. 화면의 결은 docs/design/ui-system.md 가 정한다: 잉크·뼛빛·나트륨·REC 넷,
// 각진 모서리, 채우지 않는 단추, 닳은 선. 예전 픽셀 카드 토큰(둥근 모서리·이중 선)은 그 규칙에
// 어긋나 사라졌다. 색이 조용히 늘거나 모서리가 다시 둥글어지면 여기서 잡는다.
test('화면 토큰은 잉크·뼛빛·나트륨 네 색과 각진 모서리를 유지한다', () => {
  for (const declaration of [
    '--ink-0: #050504;',
    '--ink-panel: #0b0b0ae6;',
    '--bone: #e6e1d3;',
    '--bone-dim: #9d9889;',
    '--sodium: #d9b25a;',
    '--rec: #ff3535;',
    '--space-1: 4px;',
    '--space-2: 8px;',
    '--space-3: 16px;',
    '--space-4: 32px;',
    '--radius-pixel: 0;',
  ]) {
    expect(css).toContain(declaration);
  }
});

// 선은 자로 긋지 않는다. 필터 정의가 사라지면 CSS 는 아무 말 없이 밋밋한 선을 그린다.
test('닳은 선 토큰과 그 필터가 함께 있다', () => {
  expect(css).toContain('--rough-ink:');
  expect(css).toContain('filter: url(#rough-line)');
  const defs = readFileSync(
    new URL('../features/game/flow/RoughDefs.tsx', import.meta.url),
    'utf8',
  );
  for (const id of ['rough-line', 'rough-line-v', 'rough-box'])
    expect(defs).toContain(`id="${id}"`);
});

// 제목 명조는 배포에 든 파일로만 뜬다. 토큰과 @font-face 가 어긋나면 조용히 고딕으로 돌아간다.
test('제목 글꼴은 배포하는 나눔명조를 가리킨다', () => {
  expect(css).toContain("--font-display: 'Nanum Myeongjo'");
  for (const file of ['NanumMyeongjo-korean-400.woff2', 'NanumMyeongjo-latin-400.woff2']) {
    const bytes = readFileSync(new URL(`../../public/fonts/${file}`, import.meta.url));
    expect(css).toContain(`url('/fonts/${file}') format('woff2')`);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2');
  }
});

test('HUD 역할 토큰은 블록 아바타 원본 색을 그대로 쓴다', () => {
  expect(css).toContain('--role-tagger: #b8402f;');
  expect(css).toContain('--role-runner: #2f9f96;');
});

// S15P21C204-289. 선택자와 마크업이 갈라지면 규칙은 조용히 아무것도 안 그린다. 구속 비네트가
// 그랬다: 제품은 section.game-stage 에 data-restrained 를 달고 CSS 는 .product-stage 를 봤다.
test('구속 비네트 선택자가 제품이 실제로 표시하는 요소를 가리킨다', () => {
  const app = readFileSync(new URL('./ProductApp.tsx', import.meta.url), 'utf8');
  const marked = app.match(/className="([a-z-]+)"\s+data-restrained=/);
  expect(marked?.[1]).toBeDefined();
  expect(css).toContain(`.${marked![1]}[data-restrained]::after`);
  expect(css).not.toContain('.product-stage[data-restrained]');
});

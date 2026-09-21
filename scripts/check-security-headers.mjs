// S15P21C204-303. 실제 프로덕션 빌드에 실제 보안 헤더를 씌우고 브라우저로 돌려, CSP 가 제품을
// 깨뜨리지 않는지 본다. 정책 값을 여기서 읽어오므로 설정을 고치면 이 검사도 같이 움직인다.
//
//   pnpm --filter @kkakkung/web build && node scripts/check-security-headers.mjs
//
// 확인하는 것: 비전 Worker 가 뜨는지, MediaPipe WASM 추론까지 가는지, 폰트가 실리는지,
// 캔버스가 그려지는지, 그리고 securitypolicyviolation 이 0 건인지.
// 확인하지 못하는 것: LiveKit 실제 연결(자격이 필요하다)과 Colyseus WebSocket(서버가 필요하다).
// connect-src 의 'self' 와 livekit.cloud 항목은 그래서 설정 검토로 남는다.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const dist = resolve('apps/web/dist');
const conf = readFileSync(new URL('../infra/nginx/security-headers.conf', import.meta.url), 'utf8');
const headerOf = (name) => new RegExp(`add_header ${name} "([^"]+)"`).exec(conf)?.[1] ?? '';
const CSP = process.argv[2] ?? headerOf('Content-Security-Policy');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.task': 'application/octet-stream',
  '.jpg': 'image/jpeg',
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = resolve(dist, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) file = join(dist, 'index.html');
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(dist, 'index.html');
  }
  try {
    const b = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    if (CSP) res.setHeader('Content-Security-Policy', CSP);
    for (const name of [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ])
      res.setHeader(name, headerOf(name));
    res.end(b);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((d) => server.listen(0, '127.0.0.1', d));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 180));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 180)}`));
await page.addInitScript(() => {
  globalThis.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    globalThis.__csp.push({
      d: e.effectiveDirective || e.violatedDirective,
      b: String(e.blockedURI || '').slice(0, 110),
    }),
  );
  try {
    localStorage.setItem(
      'kkakkung.media-consent',
      JSON.stringify({ version: '2026-09-20', atMs: 1, ageConfirmed: true }),
    );
  } catch {}
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    configurable: true,
    value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const paint = () => {
        const c = canvas.getContext('2d');
        c.fillStyle = '#728d80';
        c.fillRect(0, 0, 320, 240);
      };
      paint();
      setInterval(paint, 60);
      return canvas.captureStream(15);
    },
  });
});
await page.route('**/api/sessions/access', (r) => r.fulfill({ json: { method: 'gitlab-sso' } }));

const step = async (name, work) => {
  try {
    await work();
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.log(`  MISS ${name}: ${String(e).split('\n')[0].slice(0, 110)}`);
  }
};

await page.goto(`${base}/play`, { waitUntil: 'domcontentloaded' });
await step('시작하기', async () => {
  await page.getByRole('button', { name: '시작하기', exact: true }).click({ timeout: 15000 });
});
await step('혼자 체험 진입', async () => {
  await page
    .getByRole('button', { name: '혼자 장치 점검·조작 체험', exact: true })
    .click({ timeout: 15000 });
  await page.getByRole('heading', { name: '혼자 준비해 볼까요?' }).waitFor({ timeout: 15000 });
});
await step('카메라 켜고 점검 (Worker + WASM)', async () => {
  await page
    .getByRole('button', { name: '카메라 켜고 점검하기', exact: true })
    .click({ timeout: 15000 });
  await page
    .locator('[aria-label="내 웹캠 미리보기"] video')
    .waitFor({ state: 'visible', timeout: 20000 });
});
await step('추론 결과 도달(얼굴 안내 문구)', async () => {
  await page.getByText('얼굴을 찾지 못했습니다.', { exact: false }).waitFor({ timeout: 25000 });
});

const workers = page.workers().length;
const fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  return document.fonts.size;
});
const canvas = await page.locator('canvas').count();
const seen = await page.evaluate(() => globalThis.__csp ?? []);
console.log(`\n--- Worker ${workers} / fontFace ${fonts} / canvas ${canvas}`);
console.log(`--- CSP 위반 ${seen.length} 건 ---`);
const grouped = new Map();
for (const v of seen) {
  const k = `${v.d} <- ${v.b}`;
  grouped.set(k, (grouped.get(k) ?? 0) + 1);
}
for (const [k, n] of grouped) console.log(`  ${n}x  ${k}`);
const unique = [...new Set(errors)];
console.log(`--- 콘솔 오류 ${errors.length} 건 (고유 ${unique.length}) ---`);
for (const e of unique.slice(0, 10)) console.log(`  ${e}`);
await browser.close();
server.close();
const reached = workers === 1 && fonts > 0 && canvas > 0;
if (seen.length || !reached) {
  console.log('\nFAIL: 위반이 있거나 필수 기능에 닿지 못했다.');
  process.exitCode = 1;
} else console.log('\nPASS: 위반 0, Worker·WASM·폰트·캔버스 모두 도달.');

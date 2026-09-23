import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // S15P21C204-368. CI 가 렌더링과 무관한 MR 에서 SwiftShader 렌더링 spec(e2e 의 약 70%)을 뺀다.
  // 판단은 scripts/ci-plan.mjs 가 한다. 로컬 `pnpm verify` 는 이 값을 두지 않아 전부 돈다.
  testIgnore: process.env.E2E_SKIP_RENDER === '1' ? ['**/facility-rendering.spec.ts'] : [],
  fullyParallel: false,
  workers: 1,
  // CI 의 SwiftShader 소프트웨어 WebGL 은 60초 렌더 시험이 가끔 넘친다(kkakkung-mr #140, 17회 중 1회).
  // 한 번만 다시 돌려 진짜 회귀와 느린 실행을 구분한다. 로컬은 재시도 없음.
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    // CI renders with SwiftShader. The home backdrop (S15P21C204-294) animates an 80-cell corridor
    // continuously unless the OS asks for reduced motion; on software WebGL that starved every
    // spec that passes the home screen (kkakkung-mr #226: e2e 9.2 min, two 30 s timeouts). With
    // reduced motion emulated the backdrop draws one frame and stops, which is what the product
    // does for such users anyway. Locally under forced SwiftShader: 151 s → 60 s for the 12 home specs.
    reducedMotion: 'reduce',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      HOST: '127.0.0.1',
      PORT: '2567',
      ALLOWED_ORIGINS:
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:2567,http://127.0.0.1:2567',
      MEDIA_MODE: 'disabled',
      MAX_ROOMS: '1',
      MAX_SLOTS: '6',
      VITE_API_BASE_URL: '',
      VITE_COLYSEUS_URL: '',
    },
  },
});

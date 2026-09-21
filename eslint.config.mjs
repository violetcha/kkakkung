import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.local/**',
      '**/test-results/**',
      '**/playwright-report/**',
      // D-02 의 MediaPipe WASM 글루 .js 는 벤더 산출물이라 검사하지 않는다 (REQ-D-01)
      'apps/web/public/models/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
      },
    },
  },
  {
    // S15P21C204-303. 이 스크립트는 Node 에서 돌지만, 일부 함수 본문은 브라우저 안에서
    // 실행된다(`page.addInitScript`·`page.evaluate`). 그 안의 전역은 실제로 존재한다.
    files: ['scripts/check-security-headers.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        setInterval: 'readonly',
      },
    },
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@kkakkung/game-core',
            '@kkakkung/game-core/*',
            '**/game-server/**',
            '**/server/**',
            '**/packages/game-core/**',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/game-core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'Date', 'fetch', 'setTimeout', 'setInterval'],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Inject randomness at the domain boundary.',
        },
      ],
    },
  },
];

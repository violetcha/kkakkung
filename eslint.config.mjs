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

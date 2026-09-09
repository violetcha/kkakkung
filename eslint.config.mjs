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

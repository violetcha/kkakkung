import { defineConfig } from 'vitest/config';

// Default suite: unit, contract and short load fixtures. Cloud cases (*.cloud.test.ts) are
// excluded here and run only through scripts/run-cloud-check.mjs with vitest.cloud.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/*.test.{ts,tsx}',
      'apps/**/*.test.{ts,tsx}',
      'server/**/*.test.{ts,tsx}',
      'tests/contracts/**/*.test.{ts,tsx}',
      'tests/load/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.cloud.test.{ts,tsx}'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});

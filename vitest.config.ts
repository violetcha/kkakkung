import { defineConfig } from 'vitest/config';

// Default suite: unit, contract and short load fixtures. Cloud cases (*.cloud.test.ts) are
// excluded here and run only through scripts/run-cloud-check.mjs with vitest.cloud.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'server/**/*.test.ts',
      'tests/contracts/**/*.test.ts',
      'tests/load/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.cloud.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});

import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});

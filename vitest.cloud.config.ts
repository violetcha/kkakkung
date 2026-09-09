import { defineConfig } from 'vitest/config';

// Cloud cases only. Never run directly: scripts/run-cloud-check.mjs validates the preflight
// document and injects RUN_CLOUD_TESTS=1 / CLOUD_TEST_CASE / CLOUD_PREFLIGHT_PATH /
// CLOUD_EVIDENCE_DIR. Each case re-checks them in beforeAll and fails (not skips) otherwise.
// Long cases raise their own test/hook timeout from the preflight's maxDurationSeconds +
// cleanupAllowanceSeconds; an unbounded timeout is not allowed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/test/media/**/*.cloud.test.ts', 'tests/cloud/**/*.cloud.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120000,
    hookTimeout: 30000,
  },
});

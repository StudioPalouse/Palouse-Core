import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Testcontainers needs time to pull/boot Postgres on a cold run.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});

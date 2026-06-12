import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Testcontainers boots (and on first run pulls) a Postgres image in beforeAll.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});

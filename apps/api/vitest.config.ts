import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Testcontainers needs time to pull/boot Postgres on a cold run.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // Baseline env so modules that call loadEnv() at import time (e.g. logger)
    // can load. Tests that need a real DB override DATABASE_URL in beforeAll
    // with their Testcontainers URI.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost:5432/none',
      REDIS_URL: 'redis://127.0.0.1:6399',
      BETTER_AUTH_SECRET: 'vitest-secret-vitest-secret-vitest-secret',
      BETTER_AUTH_URL: 'http://localhost:4000',
      API_BASE_URL: 'http://localhost:4000',
      WEB_BASE_URL: 'http://localhost:3000',
      PALOUSE_ENCRYPTION_KEY: '0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f',
    },
  },
});

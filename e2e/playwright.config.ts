import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke suite. The full stack (postgres, redis, api, web) is brought up
 * outside Playwright: locally via `docker compose up` or `pnpm dev`, in CI via
 * the reusable `e2e` workflow. Point the run at a different origin with
 * `E2E_BASE_URL` (e.g. a deployed staging URL).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

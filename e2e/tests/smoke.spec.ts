import { test, expect } from '@playwright/test';

/**
 * Tracer-bullet smoke: exercises the full stack end to end through the UI —
 * sign up, sign in, create the first workspace, land on the dashboard. This
 * touches web + API + auth + Postgres in one flow.
 *
 * Note: sign-in works right after sign-up only because CI runs with
 * RESEND_API_KEY unset, so email verification is not enforced. Against an
 * environment with mail configured, this flow would need a verification step.
 */
test('sign up, sign in, and reach the dashboard', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${stamp}@example.com`;
  const password = 'Sup3rSecret!e2e';

  // Sign up. The UI always shows a "check your email" confirmation.
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  // Sign in with the account we just created.
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // A brand-new account has no workspace, so it is routed to create one.
  await page.waitForURL('**/workspaces/new');
  await page.getByLabel('Name').fill('E2E Workspace');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // Landing on the dashboard confirms the round trip through the API.
  await page.waitForURL('**/dashboard');
  await expect(
    page.getByRole('heading', { name: /good (morning|afternoon|evening)/i }),
  ).toBeVisible();
});

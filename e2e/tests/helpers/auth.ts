import { expect, type Page } from '@playwright/test';

/**
 * Sign-up through first-workspace setup, the preamble every flow spec needs
 * before it can test anything.
 *
 * `smoke.spec.ts` deliberately does NOT use this. It is the deploy gate, and
 * inlining its steps means a regression in the signup path fails there as a
 * plain assertion rather than as an error thrown from shared setup.
 *
 * Sign-in works straight after sign-up only because CI leaves RESEND_API_KEY
 * unset, so verification is not enforced (see e2e.yml). SMTP_URL being set for
 * Mailpit does not change that: `mailConfigured` keys off RESEND_API_KEY alone
 * (packages/auth/src/index.ts).
 */
export interface TestAccount {
  email: string;
  password: string;
  workspaceName: string;
}

const PASSWORD = 'Sup3rSecret!e2e';

/**
 * Creates a fresh account and workspace, leaving the browser on the dashboard.
 * `prefix` only makes failures easier to read back in Mailpit or Postgres.
 *
 * Every value is unique per call: specs run fullyParallel locally, and the
 * workspace slug is derived from the name, so a fixed name collides with
 * "already taken" on the second run against a persistent database.
 */
export async function signUpAndCreateWorkspace(
  page: Page,
  prefix = 'e2e',
): Promise<TestAccount> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `${prefix}-${stamp}@example.com`;
  const workspaceName = `${prefix} WS ${stamp}`;

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL('**/workspaces/new');
  await page.getByLabel('Name').fill(workspaceName);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/dashboard');

  return { email, password: PASSWORD, workspaceName };
}

/**
 * The id of the workspace the signed-in user owns. Read through the page's own
 * request context so it rides the session cookie, and through the origin the
 * browser uses, since the API is reached via the Next rewrite proxy.
 */
export async function activeWorkspaceId(page: Page): Promise<string> {
  const res = await page.request.get('/v1/workspaces');
  expect(res.ok(), `GET /v1/workspaces responded ${res.status()}`).toBeTruthy();
  const { workspaces } = (await res.json()) as { workspaces: Array<{ id: string }> };
  expect(workspaces.length, 'signed-in user should own a workspace').toBeGreaterThan(0);
  return workspaces[0]!.id;
}

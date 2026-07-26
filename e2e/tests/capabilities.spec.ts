import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { activeWorkspaceId, signUpAndCreateWorkspace } from './helpers/auth';

/**
 * Capability gating end to end: the sidebar, the route gate, and the API guard
 * are three independent enforcement points for one toggle, and until now only
 * the API one had tests (route-level, in apps/api). A capability that vanishes
 * from the nav but still serves data, or refuses in the UI while the API
 * answers, is the failure this covers.
 *
 * One account for the file. Better Auth allows 3 sign-ups per 10 seconds
 * across the whole suite on CI, where it cannot resolve a per-client IP, so a
 * signup per test would fail the suite for reasons unrelated to the test. See
 * tasks.spec.ts.
 */
test.describe.configure({ mode: 'serial' });
// Own Better Auth rate-limit bucket for this file, as in the other specs.
test.use({ extraHTTPHeaders: { 'fly-client-ip': '10.77.0.5' } });

let context: BrowserContext;
let page: Page;
let workspaceId: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signUpAndCreateWorkspace(page, 'caps');
  workspaceId = await activeWorkspaceId(page);
});

test.afterAll(async () => {
  await context.close();
});

/** The desktop sidebar. The mobile one only exists while its sheet is open. */
function sidebar() {
  return page.getByRole('navigation').first();
}

function tasksToggle() {
  return page.getByRole('switch', { name: 'Toggle Tasks' });
}

/**
 * What `GET /v1/tasks` answers for this workspace, from the page's own origin
 * so the session cookie rides along. A safe method, so the CSRF guard on
 * unsafe methods does not apply.
 */
async function listTasksStatus(): Promise<{ status: number; message: string | null }> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/v1/tasks?workspaceId=${id}`, { credentials: 'include' });
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { status: res.status, message: body?.error?.message ?? null };
  }, workspaceId);
}

test('turning Tasks off gates the nav, the route, and the API', async () => {
  // Baseline, so the assertions after the toggle cannot pass vacuously.
  await page.goto('/tasks');
  await expect(sidebar().getByRole('link', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  expect(await listTasksStatus()).toMatchObject({ status: 200 });

  await page.goto('/settings/workspace');
  await expect(tasksToggle()).toHaveAttribute('aria-checked', 'true');
  await tasksToggle().click();
  await expect(tasksToggle()).toHaveAttribute('aria-checked', 'false');

  // The nav updates from the refetch the toggle triggers, with no reload:
  // `refreshCapabilities` refetches and re-renders through context
  // (apps/web/src/lib/workspace-context.tsx), and the cache write keeps later
  // navigations consistent.
  await expect(sidebar().getByRole('link', { name: 'Tasks' })).toBeHidden();

  // Direct navigation shows the turned-off state instead of the board.
  await page.goto('/tasks');
  await expect(page.getByText('Tasks is turned off')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task' })).toBeHidden();

  // /reviews maps to the same capability (apps/web/src/lib/capabilities.ts).
  await page.goto('/reviews');
  await expect(page.getByText('Tasks is turned off')).toBeVisible();

  // The API refuses too. This is the v0.24.0 requireTasksAccess guard, and it
  // is asserted separately so reverting it fails here specifically rather than
  // somewhere ambiguous.
  expect(await listTasksStatus()).toEqual({
    status: 403,
    message: 'The Tasks capability is turned off for this workspace.',
  });
});

test('turning Tasks back on restores the nav, the route, and the API', async () => {
  await page.goto('/settings/workspace');
  await tasksToggle().click();
  await expect(tasksToggle()).toHaveAttribute('aria-checked', 'true');

  await expect(sidebar().getByRole('link', { name: 'Tasks' })).toBeVisible();

  await page.goto('/tasks');
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  await expect(page.getByText('Tasks is turned off')).toBeHidden();

  expect(await listTasksStatus()).toMatchObject({ status: 200 });
});

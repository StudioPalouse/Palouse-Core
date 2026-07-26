import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { signUpAndCreateWorkspace } from './helpers/auth';
import { firstLink, waitForMessage } from './helpers/mail';

/**
 * The two-step workspace deletion: type the name to request it, then follow an
 * emailed link to actually destroy the workspace. Both halves matter, and the
 * emailed token exists nowhere else (it is stored hashed), which is why this
 * needed the Mailpit transport.
 *
 * Note this is WORKSPACE deletion. There is no account-level deletion; the
 * surface is `workspace_deletion_tokens` plus
 * POST /v1/workspaces/:id/deletion and /v1/workspaces/deletion/confirm.
 *
 * Self-contained by construction: the account creates a second workspace and
 * destroys only that one, so nothing another spec relies on is touched. The
 * suite runs fullyParallel locally, so ordering is never assumed.
 */
test.describe.configure({ mode: 'serial' });

// Own Better Auth rate-limit bucket for this file, as in the other specs.
test.use({ extraHTTPHeaders: { 'fly-client-ip': '10.77.0.4' } });

let context: BrowserContext;
let page: Page;
let ownerEmail: string;
let keeperName: string;
let doomedName: string;
let doomedId: string;
let deletionLink: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  const account = await signUpAndCreateWorkspace(page, 'del');
  ownerEmail = account.email;
  keeperName = account.workspaceName;

  // A second workspace, which is the one this spec destroys. Having a survivor
  // makes "gone from the switcher" a real assertion rather than the trivial
  // no-workspaces-left redirect.
  doomedName = `Doomed WS ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto('/workspaces/new');
  await page.getByLabel('Name').fill(doomedName);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/dashboard');

  const res = await page.request.get('/v1/workspaces');
  const { workspaces } = (await res.json()) as { workspaces: Array<{ id: string; name: string }> };
  doomedId = workspaces.find((w) => w.name === doomedName)!.id;
});

test.afterAll(async () => {
  await context.close();
});

/**
 * Points the app at the workspace this spec destroys. The danger zone acts on
 * whatever the switcher has selected, and creating a workspace does not
 * reliably make it active, so the target is chosen explicitly rather than
 * assumed. Deleting the wrong workspace is exactly the mistake worth being
 * paranoid about here.
 */
async function selectDoomedWorkspace(): Promise<void> {
  await page.goto('/dashboard');
  await page
    .getByRole('button', { name: keeperName })
    .or(page.getByRole('button', { name: doomedName }))
    .first()
    .click();
  await page.getByRole('menuitem', { name: doomedName }).click();
  await expect(page.getByRole('button', { name: doomedName })).toBeVisible();
}

/** Whether the API still serves this workspace to the signed-in user. */
async function workspaceReachable(id: string): Promise<number> {
  return page.evaluate(async (workspaceId) => {
    const res = await fetch(`/v1/tasks?workspaceId=${workspaceId}`, { credentials: 'include' });
    return res.status;
  }, id);
}

test('a mistyped workspace name does not start deletion', async () => {
  await selectDoomedWorkspace();

  // Content in the workspace, so the later assertions cover the cascade rather
  // than the deletion of an empty shell.
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title').fill('Task that should not survive');
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('button', { name: /^Task that should not survive/ })).toBeVisible();

  await page.goto('/settings/organization');
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const submit = page.getByRole('button', { name: 'Email me a confirmation link' });

  // The guard is in the UI as well as the API: the request cannot even be sent
  // until the typed name matches exactly.
  await page.getByLabel(/Type .* to confirm/).fill(`${doomedName} but wrong`);
  await expect(submit).toBeDisabled();
  await page.getByLabel(/Type .* to confirm/).fill(doomedName.toUpperCase());
  await expect(submit).toBeDisabled();

  await page.getByLabel(/Type .* to confirm/).fill(doomedName);
  await expect(submit).toBeEnabled();

  expect(await workspaceReachable(doomedId)).toBe(200);
});

test('the owner receives a confirmation link for the exact name', async () => {
  await selectDoomedWorkspace();
  await page.goto('/settings/organization');
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  await page.getByLabel(/Type .* to confirm/).fill(doomedName);
  await page.getByRole('button', { name: 'Email me a confirmation link' }).click();
  await expect(page.getByText(/Check your email for a link/)).toBeVisible();

  // Requesting deletion must not delete anything on its own.
  expect(await workspaceReachable(doomedId)).toBe(200);

  const message = await waitForMessage(ownerEmail, { subjectIncludes: 'Confirm deleting' });
  expect(message.subject).toContain(doomedName);
  deletionLink = firstLink(message);
});

test('following the link deletes the workspace and its contents', async () => {
  await page.goto(deletionLink);
  await expect(page.getByText('Delete this workspace?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByText('Workspace deleted')).toBeVisible();

  // Gone from the API, along with everything that hung off it.
  expect(await workspaceReachable(doomedId)).not.toBe(200);

  // Gone from the switcher, while the other workspace survives.
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: new RegExp(keeperName) })).toBeVisible();
  await expect(page.getByText(doomedName)).toBeHidden();
});

test('the deletion token is single use', async () => {
  await page.goto(deletionLink);
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  // The second attempt is refused rather than reporting another success.
  await expect(page.getByText('Workspace deleted')).toBeHidden();
});

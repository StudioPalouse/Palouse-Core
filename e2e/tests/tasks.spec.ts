import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { activeWorkspaceId, signUpAndCreateWorkspace } from './helpers/auth';
import { callTool, createAgentWithKey } from './helpers/agent';

/**
 * The core product loop in a browser: a person creating and working a task,
 * and an agent-created task carrying its provenance.
 *
 * Assertions target user-visible state, never refresh mechanics. The board
 * currently polls on a 15s interval and the SSE work in this release replaces
 * that, so anything asserting on how the list refreshes would break on a change
 * that users cannot see. There are no fixed-duration waits anywhere here:
 * Playwright's auto-retrying assertions settle as soon as the state lands.
 *
 * One account and workspace is shared across the file, created once. Better
 * Auth rate-limits /sign-up and /sign-in to 3 requests per 10 seconds and, on
 * a CI runner where it cannot resolve a client IP, every spec shares a single
 * bucket. Signing up per test therefore fails the suite as it grows, for
 * reasons that have nothing to do with what is being tested. Tasks are named
 * uniquely per test, so sharing a workspace does not let them interfere.
 */
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
let workspaceId: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signUpAndCreateWorkspace(page, 'tasks');
  workspaceId = await activeWorkspaceId(page);
});

test.afterAll(async () => {
  await context.close();
});

/**
 * The clickable row for a task. Anchored to the start of the accessible name
 * so it does not also match the row's "Complete <title>" button, whose label
 * contains the same title.
 */
function taskRow(page: Page, title: string) {
  return page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('create, update, and comment on a task from the board', async () => {
  const title = `Write the release notes ${Date.now()}`;

  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();

  // Create.
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Draft the notes for the next release.');
  await page.getByRole('button', { name: 'Create task' }).click();

  const row = taskRow(page, title);
  await expect(row).toBeVisible();
  // A new task starts Open at Medium, which is what the later edits move away
  // from; asserting it here means the update assertions cannot pass vacuously.
  await expect(row).toContainText('Open');
  await expect(row).toContainText('Medium');

  // Update status and priority from the detail sheet.
  await row.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: title })).toBeVisible();

  await sheet.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'In progress' }).click();
  await sheet.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'High' }).click();

  // Comment, and confirm it renders in the sheet.
  await sheet.getByPlaceholder('Add a comment').fill('Started on the draft.');
  await sheet.getByRole('button', { name: 'Comment' }).click();
  await expect(sheet.getByText('Started on the draft.')).toBeVisible();

  // Back on the board, the row reflects both edits.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(row).toContainText('In progress');
  await expect(row).toContainText('High');
});

test('completing a task from the row moves it out of the default view', async () => {
  const title = `Ship the thing ${Date.now()}`;

  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(taskRow(page, title)).toBeVisible();

  // Completed tasks are hidden from the board unless Display opts them in, so
  // the row disappearing is the user-visible result of the inline complete.
  await page.getByRole('button', { name: `Complete ${title}` }).click();
  await expect(taskRow(page, title)).toBeHidden();
});

test('an agent-created task shows which agent created it', async () => {
  const agentName = `Scout ${Date.now()}`;
  const { apiKey } = await createAgentWithKey(page, workspaceId, agentName);

  const title = `Investigate the flaky deploy ${Date.now()}`;
  const created = await callTool<{ task: { id: string; origin: string } }>(
    apiKey,
    'create_task',
    { title, descriptionMd: 'Reproduce the cold-start race.' },
  );
  expect(created.task.origin).toBe('agent');

  await page.goto('/tasks');

  // The badge names the agent rather than showing a bare id or the generic
  // "Agent" fallback, which is what the v0.23.0 name resolution added.
  const row = taskRow(page, title);
  await expect(row).toBeVisible();
  await expect(row).toContainText(agentName);

  await row.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(`Created by ${agentName}`)).toBeVisible();
});

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { signUpAndCreateWorkspace } from './helpers/auth';
import { firstLink, waitForMessage } from './helpers/mail';

/**
 * The multi-user path: invite, accept, change role, remove, revoke. High blast
 * radius, and churned recently by transfer-ownership and leave-workspace.
 *
 * The invite token never appears in an API response (createInvite stores only
 * its hash), so the delivered message is the only place a test can get the
 * accept link. That is what the Mailpit transport was built for.
 *
 * Two identities, two browser contexts, rather than signing out and in: the
 * sessions stay independent and a stale cookie cannot leak between them.
 */
test.describe.configure({ mode: 'serial' });

// Gives this file its own Better Auth rate-limit bucket. That limiter allows 3
// sign-ups per 10 seconds keyed on client IP, and CI has no proxy to supply
// one, so every spec would otherwise share a single bucket and the suite would
// fail on its own size rather than on a defect. The API trusts this header
// (apps/api/src/middleware/rate-limit.ts) and the Next proxy forwards it.
test.use({ extraHTTPHeaders: { 'fly-client-ip': '10.77.0.3' } });

let adminContext: BrowserContext;
let admin: Page;
let inviteeContext: BrowserContext;
let invitee: Page;
let inviteeEmail: string;

test.beforeAll(async ({ browser }) => {
  adminContext = await browser.newContext();
  admin = await adminContext.newPage();
  await signUpAndCreateWorkspace(admin, 'team');

  inviteeContext = await browser.newContext();
  invitee = await inviteeContext.newPage();
  inviteeEmail = `invitee-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
});

test.afterAll(async () => {
  await adminContext.close();
  await inviteeContext.close();
});

/** Sends an invite from Settings > Team and returns the emailed accept link. */
async function invite(email: string, role: string): Promise<string> {
  await admin.goto('/settings/team');
  await admin.getByRole('button', { name: 'Invite member' }).click();
  await admin.getByLabel('Email').fill(email);
  await admin.getByLabel('Role').click();
  await admin.getByRole('option', { name: role, exact: true }).click();
  await admin.getByRole('button', { name: 'Send invite' }).click();

  const message = await waitForMessage(email);
  return firstLink(message);
}

/** The team table row for a member or pending invite, found by address. */
function teamRow(page: Page, email: string) {
  return page.getByRole('row').filter({ hasText: email });
}

test('an invited member can accept from the emailed link', async () => {
  const link = await invite(inviteeEmail, 'Member');
  await expect(teamRow(admin, inviteeEmail)).toContainText('Invited');

  // The link is workspace-scoped and requires an account, so it offers sign-up
  // rather than accepting silently.
  await invitee.goto(link);
  await expect(invitee.getByText('You have been invited')).toBeVisible();
  await invitee.getByRole('link', { name: 'Create an account' }).click();

  const password = 'Sup3rSecret!e2e';
  await invitee.getByLabel('Name').fill('Casey Teammate');
  await invitee.getByLabel('Email').fill(inviteeEmail);
  await invitee.getByLabel('Password', { exact: true }).fill(password);
  await invitee.getByLabel('Confirm password').fill(password);
  await invitee.getByRole('button', { name: 'Sign up' }).click();
  await expect(invitee.getByText('Check your email')).toBeVisible();

  // Sign-up does not carry ?next through, so the invite is redeemed by signing
  // in with it. Worth knowing: the accept only happens on that second hop.
  await invitee.goto(`/sign-in?next=${encodeURIComponent(new URL(link).pathname + new URL(link).search)}`);
  await invitee.getByLabel('Email').fill(inviteeEmail);
  await invitee.getByLabel('Password', { exact: true }).fill(password);
  await invitee.getByRole('button', { name: 'Sign in' }).click();

  await expect(invitee.getByText('You are in')).toBeVisible();
  await invitee.waitForURL('**/dashboard');

  // They joined the admin's workspace rather than being sent to create one.
  await expect(invitee).toHaveURL(/\/dashboard/);

  // And the admin now sees a member where the pending invite was.
  await admin.goto('/settings/team');
  await expect(teamRow(admin, inviteeEmail)).toContainText('Active');
  await expect(teamRow(admin, inviteeEmail)).not.toContainText('Invited');
});

test('an admin can change the new member role', async () => {
  await admin.goto('/settings/team');
  const row = teamRow(admin, inviteeEmail);
  await row.getByRole('combobox').click();
  await admin.getByRole('option', { name: 'Admin', exact: true }).click();
  await expect(row.getByRole('combobox')).toContainText('Admin');

  // The change is real for the member, not just the admin's optimistic view.
  await invitee.goto('/settings/team');
  await expect(teamRow(invitee, inviteeEmail)).toContainText('Admin');
});

test('a revoked invitation stops working', async () => {
  const throwaway = `revoked-${Date.now()}@example.com`;
  const link = await invite(throwaway, 'Member');
  await expect(teamRow(admin, throwaway)).toContainText('Invited');

  await teamRow(admin, throwaway).getByRole('button', { name: 'Invitation actions' }).click();
  await admin.getByRole('menuitem', { name: 'Revoke invitation' }).click();
  await admin.getByRole('button', { name: 'Revoke' }).click();
  await expect(teamRow(admin, throwaway)).toHaveCount(0);

  // Following it now fails rather than silently adding anyone.
  await invitee.goto(link);
  await expect(invitee.getByText('Invitation problem')).toBeVisible();
});

test('a removed member loses access to the workspace', async () => {
  await admin.goto('/settings/team');
  await teamRow(admin, inviteeEmail).getByRole('button', { name: 'Member actions' }).click();
  await admin.getByRole('menuitem', { name: 'Remove from workspace' }).click();
  await admin.getByRole('button', { name: 'Remove' }).click();
  await expect(teamRow(admin, inviteeEmail)).toHaveCount(0);

  // The member is routed to create a workspace, which is what a user with no
  // workspace sees; the dashboard is no longer reachable for them.
  await invitee.goto('/dashboard');
  await invitee.waitForURL('**/workspaces/new');
});

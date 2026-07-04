import { Hono } from 'hono';
import {
  capabilityKey,
  confirmWorkspaceDeletionInput,
  createInviteInput,
  createWorkspaceInput,
  requestWorkspaceDeletionInput,
  setCapabilityInput,
  setMemberStatusInput,
  updateMemberRoleInput,
  validation,
} from '@palouse/shared';
import { capabilityService, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { renderBasicEmail, sendEmail } from '@palouse/mail';
import { requireSession, type SessionVars } from '../middleware/session.js';

const ADMIN_ROLES = ['owner', 'admin'] as const;

export const workspaceRoutes = new Hono<SessionVars>();

workspaceRoutes.use('*', requireSession);

workspaceRoutes.get('/', async (c) => {
  const db = getDb(loadEnv().DATABASE_URL);
  const items = await workspaces.listWorkspacesForUser(db, c.get('userId'));
  return c.json({ workspaces: items });
});

workspaceRoutes.post('/', async (c) => {
  const parsed = createWorkspaceInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid workspace input', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  const ws = await workspaces.createWorkspace(db, c.get('userId'), parsed.data);
  return c.json({ workspace: ws }, 201);
});

workspaceRoutes.get('/:workspaceId/members', async (c) => {
  const db = getDb(loadEnv().DATABASE_URL);
  const workspaceId = c.req.param('workspaceId');
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const members = await workspaces.listMembers(db, workspaceId);
  return c.json({ members });
});

workspaceRoutes.patch('/:workspaceId/members/:userId', async (c) => {
  const parsed = updateMemberRoleInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid role', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  const member = await workspaces.updateMemberRole(
    db,
    c.req.param('workspaceId'),
    c.get('userId'),
    c.req.param('userId'),
    parsed.data.role,
  );
  return c.json({ member });
});

workspaceRoutes.patch('/:workspaceId/members/:userId/status', async (c) => {
  const parsed = setMemberStatusInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid status', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  const member = await workspaces.setMemberStatus(
    db,
    c.req.param('workspaceId'),
    c.get('userId'),
    c.req.param('userId'),
    parsed.data.status,
  );
  return c.json({ member });
});

workspaceRoutes.delete('/:workspaceId/members/:userId', async (c) => {
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.removeMember(
    db,
    c.req.param('workspaceId'),
    c.get('userId'),
    c.req.param('userId'),
  );
  return c.body(null, 204);
});

workspaceRoutes.get('/:workspaceId/capabilities', async (c) => {
  const db = getDb(loadEnv().DATABASE_URL);
  const capabilities = await capabilityService.getCapabilities(
    db,
    c.req.param('workspaceId'),
    c.get('userId'),
  );
  return c.json({ capabilities });
});

workspaceRoutes.patch('/:workspaceId/capabilities/:capability', async (c) => {
  const key = capabilityKey.safeParse(c.req.param('capability'));
  if (!key.success) throw validation('Unknown capability');
  const parsed = setCapabilityInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid capability input', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  const capabilities = await capabilityService.setCapability(
    db,
    c.req.param('workspaceId'),
    c.get('userId'),
    key.data,
    parsed.data.enabled,
  );
  return c.json({ capabilities });
});

workspaceRoutes.get('/:workspaceId/invitations', async (c) => {
  const db = getDb(loadEnv().DATABASE_URL);
  const workspaceId = c.req.param('workspaceId');
  await workspaces.requireRole(db, workspaceId, c.get('userId'), [...ADMIN_ROLES]);
  const invitations = await workspaces.listInvites(db, workspaceId);
  return c.json({ invitations });
});

workspaceRoutes.post('/:workspaceId/invitations', async (c) => {
  const parsed = createInviteInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid invitation', parsed.error.flatten());
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const { invitation, token } = await workspaces.createInvite(
    db,
    c.req.param('workspaceId'),
    c.get('userId'),
    parsed.data,
  );
  const acceptUrl = `${env.WEB_BASE_URL}/invite?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: invitation.email,
    subject: 'You have been invited to a Palouse workspace',
    html: renderBasicEmail({
      heading: 'Join the workspace on Palouse',
      bodyLines: [
        'You have been invited to collaborate in a Palouse workspace.',
        'This link expires in 7 days. If you were not expecting this, you can ignore it.',
      ],
      ctaLabel: 'Accept invitation',
      ctaUrl: acceptUrl,
    }),
  });
  return c.json({ invitation }, 201);
});

workspaceRoutes.delete('/:workspaceId/invitations/:inviteId', async (c) => {
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.revokeInvite(
    db,
    c.req.param('workspaceId'),
    c.get('userId'),
    c.req.param('inviteId'),
  );
  return c.body(null, 204);
});

// Level 1 of workspace deletion: owner re-types the workspace name; we email them
// a one-time confirmation link. The actual delete happens at the confirm route below.
workspaceRoutes.post('/:workspaceId/deletion', async (c) => {
  const parsed = requestWorkspaceDeletionInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid confirmation', parsed.error.flatten());
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const { token, email, workspaceName } = await workspaces.requestWorkspaceDeletion(
    db,
    c.req.param('workspaceId'),
    c.get('userId'),
    parsed.data.confirmName,
  );
  const confirmUrl = `${env.WEB_BASE_URL}/workspaces/delete?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: email,
    subject: `Confirm deleting the ${workspaceName} workspace`,
    html: renderBasicEmail({
      heading: 'Confirm workspace deletion',
      bodyLines: [
        `You asked to permanently delete the ${workspaceName} workspace and everything in it.`,
        'This cannot be undone. If you did not request this, ignore this email and nothing happens.',
        'This link expires in 1 hour.',
      ],
      ctaLabel: 'Delete this workspace permanently',
      ctaUrl: confirmUrl,
    }),
  });
  return c.json({ requested: true });
});

// Level 2 of workspace deletion: consume the emailed token. The token carries the
// workspace, so this is not nested under /:workspaceId. The signed-in user must
// still be an owner of that workspace (checked in the service).
workspaceRoutes.post('/deletion/confirm', async (c) => {
  const parsed = confirmWorkspaceDeletionInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid token', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  const result = await workspaces.confirmWorkspaceDeletion(db, c.get('userId'), parsed.data.token);
  return c.json(result);
});

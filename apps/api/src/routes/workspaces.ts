import { Hono } from 'hono';
import {
  createInviteInput,
  createWorkspaceInput,
  updateMemberRoleInput,
  validation,
} from '@palouse/shared';
import { workspaces } from '@palouse/core';
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

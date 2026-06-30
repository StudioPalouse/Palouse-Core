import { Hono } from 'hono';
import { createWorkspaceInput, updateMemberRoleInput, validation } from '@palouse/shared';
import { workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

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

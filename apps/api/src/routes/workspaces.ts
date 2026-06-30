import { Hono } from 'hono';
import { createWorkspaceInput, validation } from '@palouse/shared';
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

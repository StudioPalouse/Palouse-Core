import { Hono } from 'hono';
import { createWorkspaceInput, validation } from '@reqops/shared';
import { workspaces } from '@reqops/core';
import { loadEnv } from '@reqops/config';
import { getDb } from '@reqops/db';
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

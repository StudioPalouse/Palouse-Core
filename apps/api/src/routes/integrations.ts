import { Hono } from 'hono';
import { integrationService, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { validation } from '@palouse/shared';
import { enqueuePull, removePolling } from '@palouse/queue';
import { getSyncQueue } from '../queue.js';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const integrationRoutes = new Hono<SessionVars>();

integrationRoutes.use('*', requireSession);

integrationRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const items = await integrationService.listIntegrations(db, workspaceId);
  return c.json({ integrations: items });
});

integrationRoutes.post('/:id/sync', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);
  const row = await integrationService.getIntegrationRow(db, c.req.param('id'));
  if (row.workspaceId !== workspaceId) throw validation('Integration not in this workspace');
  await enqueuePull(getSyncQueue(), row.id);
  return c.json({ queued: true });
});

integrationRoutes.delete('/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);
  const id = c.req.param('id');
  await integrationService.deleteIntegration(db, workspaceId, id);
  await removePolling(getSyncQueue(), id).catch(() => {
    // Worker's reconciler removes orphaned schedulers within 5 minutes anyway.
  });
  return c.json({ deleted: true });
});

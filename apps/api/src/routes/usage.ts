import { Hono } from 'hono';
import {
  upsertWorkspacePriceInput,
  usageSummaryQuery,
  validation,
} from '@reqops/shared';
import { usageService, workspaces } from '@reqops/core';
import { loadEnv } from '@reqops/config';
import { getDb } from '@reqops/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

// Mounted at /v1 — covers /v1/usage/* and /v1/model-prices*.
export const usageRoutes = new Hono<SessionVars>();

usageRoutes.use('*', requireSession);

usageRoutes.get('/usage/summary', async (c) => {
  const parsed = usageSummaryQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid usage query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, parsed.data.workspaceId, c.get('userId'));
  const result = await usageService.getWorkspaceSpend(db, parsed.data);
  return c.json(result);
});

usageRoutes.get('/model-prices', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const result = await usageService.listModelPrices(db, workspaceId);
  return c.json(result);
});

usageRoutes.put('/model-prices/overrides', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = upsertWorkspacePriceInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid price override', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const row = await usageService.upsertWorkspacePrice(db, workspaceId, c.get('userId'), parsed.data);
  return c.json({ override: { id: row.id, model: row.model } }, 201);
});

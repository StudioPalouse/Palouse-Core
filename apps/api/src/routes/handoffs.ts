import { Hono } from 'hono';
import {
  createHandoffInput,
  listHandoffsQuery,
  reviewHandoffInput,
  validation,
} from '@reqops/shared';
import { handoffService, workspaces } from '@reqops/core';
import { loadEnv } from '@reqops/config';
import { getDb } from '@reqops/db';
import { enqueueNotifyAgent } from '@reqops/queue';
import { getHandoffQueue } from '../queue.js';
import { requireSession, type SessionVars } from '../middleware/session.js';

// Mounted at /v1 — covers /v1/tasks/:id/handoff and /v1/handoffs/*.
export const handoffRoutes = new Hono<SessionVars>();

handoffRoutes.use('*', requireSession);

handoffRoutes.post('/tasks/:id/handoff', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = createHandoffInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid handoff input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const handoff = await handoffService.createHandoff(
    db,
    workspaceId,
    c.get('userId'),
    c.req.param('id'),
    parsed.data,
  );
  // Notify dispatch is best-effort: MCP agents poll claim_task regardless.
  await enqueueNotifyAgent(getHandoffQueue(), handoff.id, workspaceId, handoff.actorAgentId).catch(
    () => {},
  );
  return c.json({ handoff }, 201);
});

handoffRoutes.get('/handoffs', async (c) => {
  const parsed = listHandoffsQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid handoff query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, parsed.data.workspaceId, c.get('userId'));
  const result = await handoffService.listHandoffs(db, parsed.data);
  return c.json(result);
});

handoffRoutes.get('/handoffs/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const result = await handoffService.getHandoff(db, workspaceId, c.req.param('id'));
  return c.json(result);
});

handoffRoutes.post('/handoffs/:id/review', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = reviewHandoffInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid review input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const handoff = await handoffService.review(
    db,
    workspaceId,
    c.get('userId'),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ handoff });
});

handoffRoutes.post('/handoffs/:id/cancel', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const workspaceId =
    typeof body.workspaceId === 'string' ? body.workspaceId : (c.req.query('workspaceId') ?? '');
  if (!workspaceId) throw validation('workspaceId required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const handoff = await handoffService.cancel(db, workspaceId, c.get('userId'), c.req.param('id'));
  return c.json({ handoff });
});

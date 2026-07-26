import { Hono } from 'hono';
import {
  createHandoffInput,
  listHandoffsQuery,
  reviewHandoffInput,
  validation,
} from '@palouse/shared';
import { handoffService, narrateHandoff, usageService } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { enqueueNotifyAgent } from '@palouse/queue';
import { getEventBus, getHandoffQueue } from '../queue.js';
import { requireTasksAccess } from '../capability-access.js';
import { requireSession, type SessionVars } from '../middleware/session.js';

// Mounted at /v1 — covers /v1/tasks/:id/handoff and /v1/handoffs/*.
export const handoffRoutes = new Hono<SessionVars>();

/** Fire and forget, alongside the agent notification. See routes/tasks.ts. */
function publishHandoffChanged(
  workspaceId: string,
  handoff: { id: string; taskId: string; state: string },
): void {
  getEventBus().publish(workspaceId, {
    type: 'handoff.changed',
    handoffId: handoff.id,
    taskId: handoff.taskId,
    state: handoff.state,
    at: new Date().toISOString(),
  });
}

handoffRoutes.use('*', requireSession);

handoffRoutes.post('/tasks/:id/handoff', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = createHandoffInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid handoff input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireTasksAccess(db, workspaceId, c.get('userId'));
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
  publishHandoffChanged(workspaceId, handoff);
  return c.json({ handoff }, 201);
});

handoffRoutes.get('/handoffs', async (c) => {
  const parsed = listHandoffsQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid handoff query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireTasksAccess(db, parsed.data.workspaceId, c.get('userId'));
  const result = await handoffService.listHandoffs(db, parsed.data);
  return c.json(result);
});

// Full Activity Report payload: lifecycle events, narrative steps, the
// generation ledger, its aggregate, and the plain-English narrative.
handoffRoutes.get('/handoffs/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireTasksAccess(db, workspaceId, c.get('userId'));
  const handoffId = c.req.param('id');
  const detail = await handoffService.getHandoff(db, workspaceId, handoffId);
  const usage = await usageService.getHandoffUsage(db, workspaceId, handoffId);
  const narrative = narrateHandoff({
    handoff: detail.handoff,
    agentName: detail.agentName,
    taskTitle: detail.taskTitle,
    events: detail.events,
    steps: usage.steps,
    summary: usage.summary,
  });
  return c.json({ ...detail, ...usage, narrative });
});

handoffRoutes.post('/handoffs/:id/review', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = reviewHandoffInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid review input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireTasksAccess(db, workspaceId, c.get('userId'));
  const handoff = await handoffService.review(
    db,
    workspaceId,
    c.get('userId'),
    c.req.param('id'),
    parsed.data,
  );
  publishHandoffChanged(workspaceId, handoff);
  return c.json({ handoff });
});

handoffRoutes.post('/handoffs/:id/cancel', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const workspaceId =
    typeof body.workspaceId === 'string' ? body.workspaceId : (c.req.query('workspaceId') ?? '');
  if (!workspaceId) throw validation('workspaceId required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireTasksAccess(db, workspaceId, c.get('userId'));
  const handoff = await handoffService.cancel(db, workspaceId, c.get('userId'), c.req.param('id'));
  publishHandoffChanged(workspaceId, handoff);
  return c.json({ handoff });
});

import { Hono } from 'hono';
import {
  addRelationInput,
  addResourceInput,
  createDecisionCommentInput,
  createDecisionInput,
  forbidden,
  listDecisionsQuery,
  setStakeholdersInput,
  updateDecisionInput,
  userActor,
  validation,
} from '@palouse/shared';
import { capabilityService, decisionService, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb, type Database } from '@palouse/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const decisionRoutes = new Hono<SessionVars>();

decisionRoutes.use('*', requireSession);

/**
 * Membership + the decisions capability must both be satisfied. Returns the
 * workspace capability set so callers can gate cross-capability data (e.g. only
 * count objective/project strategy signals when those capabilities are on).
 */
async function requireDecisionsAccess(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<Awaited<ReturnType<typeof capabilityService.capabilitiesForWorkspace>>> {
  await workspaces.requireMembership(db, workspaceId, userId);
  const caps = await capabilityService.capabilitiesForWorkspace(db, workspaceId);
  if (caps.decisions === false)
    throw forbidden('The Decisions capability is turned off for this workspace.');
  return caps;
}

function bodyWorkspaceId(body: unknown): string {
  if (body && typeof body === 'object' && 'workspaceId' in body) {
    const ws = (body as { workspaceId?: unknown }).workspaceId;
    if (typeof ws === 'string') return ws;
  }
  return '';
}

decisionRoutes.get('/', async (c) => {
  const parsed = listDecisionsQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid decision query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, parsed.data.workspaceId, c.get('userId'));
  const result = await decisionService.listDecisions(db, parsed.data);
  return c.json(result);
});

decisionRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = createDecisionInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid decision input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  const decision = await decisionService.createDecision(
    db,
    workspaceId,
    userActor(c.get('userId')),
    parsed.data,
  );
  return c.json({ decision }, 201);
});

// Registered before '/:id' so the literal path is not captured as an id.
decisionRoutes.get('/strategy-signals', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  const caps = await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  const result = await decisionService.getStrategySignals(db, workspaceId, {
    includeObjectiveSignals: caps.objectives !== false,
    includeProjectSignals: caps.projects !== false,
  });
  return c.json(result);
});

decisionRoutes.get('/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  const result = await decisionService.getDecision(db, workspaceId, c.req.param('id'));
  return c.json(result);
});

decisionRoutes.patch('/:id', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = updateDecisionInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation(
      'Invalid decision update',
      parsed.success ? undefined : parsed.error.flatten(),
    );
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  const decision = await decisionService.updateDecision(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ decision });
});

decisionRoutes.post('/:id/comments', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = createDecisionCommentInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid comment', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  const comment = await decisionService.addComment(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ comment }, 201);
});

decisionRoutes.put('/:id/stakeholders', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = setStakeholdersInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid stakeholders', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  const stakeholders = await decisionService.setStakeholders(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ stakeholders });
});

decisionRoutes.post('/:id/resources', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = addResourceInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid resource', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  const resource = await decisionService.addResource(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ resource }, 201);
});

decisionRoutes.delete('/:id/resources/:resourceId', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  await decisionService.removeResource(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('resourceId'),
  );
  return c.body(null, 204);
});

decisionRoutes.post('/:id/relations', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = addRelationInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid relation', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  const relation = await decisionService.addRelation(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ relation }, 201);
});

decisionRoutes.delete('/:id/relations/:relationId', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireDecisionsAccess(db, workspaceId, c.get('userId'));
  await decisionService.removeRelation(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('relationId'),
  );
  return c.body(null, 204);
});

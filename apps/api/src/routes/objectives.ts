import { Hono } from 'hono';
import {
  createKeyResultInput,
  createObjectiveInput,
  forbidden,
  importObjectivesInput,
  linkKeyResultProjectInput,
  listObjectivesQuery,
  updateKeyResultInput,
  updateObjectiveInput,
  userActor,
  validation,
} from '@palouse/shared';
import { capabilityService, objectiveService, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb, type Database } from '@palouse/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const objectiveRoutes = new Hono<SessionVars>();

objectiveRoutes.use('*', requireSession);

/** Membership + the objectives capability must both be satisfied. */
async function requireObjectivesAccess(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await workspaces.requireMembership(db, workspaceId, userId);
  const caps = await capabilityService.capabilitiesForWorkspace(db, workspaceId);
  if (caps.objectives === false)
    throw forbidden('The Objectives capability is turned off for this workspace.');
}

function bodyWorkspaceId(body: unknown): string {
  if (body && typeof body === 'object' && 'workspaceId' in body) {
    const ws = (body as { workspaceId?: unknown }).workspaceId;
    if (typeof ws === 'string') return ws;
  }
  return '';
}

objectiveRoutes.get('/', async (c) => {
  const parsed = listObjectivesQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid objective query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, parsed.data.workspaceId, c.get('userId'));
  const result = await objectiveService.listObjectives(db, parsed.data);
  return c.json(result);
});

objectiveRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = createObjectiveInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation(
      'Invalid objective input',
      parsed.success ? undefined : parsed.error.flatten(),
    );
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  const objective = await objectiveService.createObjective(
    db,
    workspaceId,
    userActor(c.get('userId')),
    parsed.data,
  );
  return c.json({ objective }, 201);
});

objectiveRoutes.post('/import', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = importObjectivesInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid import', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  const result = await objectiveService.importObjectives(
    db,
    workspaceId,
    userActor(c.get('userId')),
    parsed.data,
  );
  return c.json(result);
});

objectiveRoutes.get('/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  const result = await objectiveService.getObjective(db, workspaceId, c.req.param('id'));
  return c.json(result);
});

objectiveRoutes.patch('/:id', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = updateObjectiveInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation(
      'Invalid objective update',
      parsed.success ? undefined : parsed.error.flatten(),
    );
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  const objective = await objectiveService.updateObjective(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ objective });
});

objectiveRoutes.post('/:id/key-results', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = createKeyResultInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid key result', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  const keyResult = await objectiveService.addKeyResult(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ keyResult }, 201);
});

objectiveRoutes.patch('/:id/key-results/:krId', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = updateKeyResultInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation(
      'Invalid key result update',
      parsed.success ? undefined : parsed.error.flatten(),
    );
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  const keyResult = await objectiveService.updateKeyResult(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('krId'),
    parsed.data,
  );
  return c.json({ keyResult });
});

objectiveRoutes.delete('/:id/key-results/:krId', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  await objectiveService.removeKeyResult(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('krId'),
  );
  return c.body(null, 204);
});

// Ladder a whole project up to a key result: its completion drives KR progress.
objectiveRoutes.post('/:id/key-results/:krId/projects', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = linkKeyResultProjectInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid project link', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  await objectiveService.linkKeyResultProject(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('krId'),
    parsed.data.projectId,
  );
  return c.body(null, 201);
});

objectiveRoutes.delete('/:id/key-results/:krId/projects/:projectId', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireObjectivesAccess(db, workspaceId, c.get('userId'));
  await objectiveService.unlinkKeyResultProject(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('krId'),
    c.req.param('projectId'),
  );
  return c.body(null, 204);
});

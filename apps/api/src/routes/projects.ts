import { Hono } from 'hono';
import {
  addDependencyInput,
  createColumnInput,
  createProjectInput,
  createProjectItemInput,
  forbidden,
  linkDecisionInput,
  linkTaskInput,
  listProjectsQuery,
  updateColumnInput,
  updateProjectInput,
  updateProjectItemInput,
  userActor,
  validation,
} from '@palouse/shared';
import { capabilityService, projectService, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb, type Database } from '@palouse/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const projectRoutes = new Hono<SessionVars>();

projectRoutes.use('*', requireSession);

/** Membership + the projects capability must both be satisfied. */
async function requireProjectsAccess(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await workspaces.requireMembership(db, workspaceId, userId);
  const caps = await capabilityService.capabilitiesForWorkspace(db, workspaceId);
  if (caps.projects === false)
    throw forbidden('The Projects capability is turned off for this workspace.');
}

function bodyWorkspaceId(body: unknown): string {
  if (body && typeof body === 'object' && 'workspaceId' in body) {
    const ws = (body as { workspaceId?: unknown }).workspaceId;
    if (typeof ws === 'string') return ws;
  }
  return '';
}

function queryWorkspaceId(c: { req: { query: (k: string) => string | undefined } }): string {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  return workspaceId;
}

// --- Projects --------------------------------------------------------------

projectRoutes.get('/', async (c) => {
  const parsed = listProjectsQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid project query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, parsed.data.workspaceId, c.get('userId'));
  const result = await projectService.listProjects(db, parsed.data);
  return c.json(result);
});

projectRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = createProjectInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid project input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  const project = await projectService.createProject(
    db,
    workspaceId,
    userActor(c.get('userId')),
    parsed.data,
  );
  return c.json({ project }, 201);
});

projectRoutes.get('/:id', async (c) => {
  const workspaceId = queryWorkspaceId(c);
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  const result = await projectService.getProject(db, workspaceId, c.req.param('id'));
  return c.json(result);
});

projectRoutes.patch('/:id', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = updateProjectInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid project update', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  const project = await projectService.updateProject(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ project });
});

projectRoutes.delete('/:id', async (c) => {
  const workspaceId = queryWorkspaceId(c);
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.deleteProject(db, workspaceId, userActor(c.get('userId')), c.req.param('id'));
  return c.body(null, 204);
});

// --- Columns ---------------------------------------------------------------

projectRoutes.post('/:id/columns', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = createColumnInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid column input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  const column = await projectService.addColumn(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ column }, 201);
});

projectRoutes.patch('/:id/columns/:colId', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = updateColumnInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid column update', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  const column = await projectService.updateColumn(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('colId'),
    parsed.data,
  );
  return c.json({ column });
});

projectRoutes.delete('/:id/columns/:colId', async (c) => {
  const workspaceId = queryWorkspaceId(c);
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.removeColumn(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('colId'),
  );
  return c.body(null, 204);
});

// --- Items -----------------------------------------------------------------

projectRoutes.post('/:id/items', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = createProjectItemInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid item input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  const item = await projectService.createProjectItem(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ item }, 201);
});

projectRoutes.patch('/:id/items/:itemId', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = updateProjectItemInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid item update', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  const item = await projectService.updateProjectItem(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('itemId'),
    parsed.data,
  );
  return c.json({ item });
});

projectRoutes.delete('/:id/items/:itemId', async (c) => {
  const workspaceId = queryWorkspaceId(c);
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.removeProjectItem(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('itemId'),
  );
  return c.body(null, 204);
});

// --- Dependencies (project-level edges between two items) -------------------

projectRoutes.post('/:id/dependencies', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = addDependencyInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid dependency', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.addDependency(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.body(null, 201);
});

projectRoutes.delete('/:id/dependencies/:depId', async (c) => {
  const workspaceId = queryWorkspaceId(c);
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.removeDependency(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('depId'),
  );
  return c.body(null, 204);
});

// --- Task links ------------------------------------------------------------

projectRoutes.post('/:id/items/:itemId/tasks', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = linkTaskInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid task link', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.linkTask(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('itemId'),
    parsed.data.taskId,
  );
  return c.body(null, 201);
});

projectRoutes.delete('/:id/items/:itemId/tasks/:taskId', async (c) => {
  const workspaceId = queryWorkspaceId(c);
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.unlinkTask(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('itemId'),
    c.req.param('taskId'),
  );
  return c.body(null, 204);
});

// --- Decision links --------------------------------------------------------

projectRoutes.post('/:id/items/:itemId/decisions', async (c) => {
  const body = await c.req.json();
  const workspaceId = bodyWorkspaceId(body);
  const parsed = linkDecisionInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid decision link', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.linkDecision(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('itemId'),
    parsed.data.decisionId,
  );
  return c.body(null, 201);
});

projectRoutes.delete('/:id/items/:itemId/decisions/:decisionId', async (c) => {
  const workspaceId = queryWorkspaceId(c);
  const db = getDb(loadEnv().DATABASE_URL);
  await requireProjectsAccess(db, workspaceId, c.get('userId'));
  await projectService.unlinkDecision(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    c.req.param('itemId'),
    c.req.param('decisionId'),
  );
  return c.body(null, 204);
});

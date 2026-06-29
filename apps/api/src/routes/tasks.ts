import { Hono } from 'hono';
import {
  createCommentInput,
  createTaskInput,
  listTasksQuery,
  updateTaskInput,
  userActor,
  validation,
} from '@palouse/shared';
import { taskService, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { enqueuePush } from '@palouse/queue';
import { getSyncQueue } from '../queue.js';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const taskRoutes = new Hono<SessionVars>();

taskRoutes.use('*', requireSession);

taskRoutes.get('/', async (c) => {
  const parsed = listTasksQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid task query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, parsed.data.workspaceId, c.get('userId'));
  const result = await taskService.listTasks(db, parsed.data);
  return c.json(result);
});

taskRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = createTaskInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid task input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const task = await taskService.createTask(db, workspaceId, c.get('userId'), parsed.data);
  return c.json({ task }, 201);
});

taskRoutes.get('/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const result = await taskService.getTask(db, workspaceId, c.req.param('id'));
  return c.json(result);
});

taskRoutes.patch('/:id', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = updateTaskInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid task update', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const task = await taskService.updateTask(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  // Mirror the change back to any linked external systems (worker no-ops
  // when the task has no sources).
  await enqueuePush(getSyncQueue(), task.id, workspaceId).catch(() => {});
  return c.json({ task });
});

taskRoutes.post('/:id/comments', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = createCommentInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid comment', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const comment = await taskService.addComment(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ comment }, 201);
});

import { Hono } from 'hono';
import {
  createCommentInput,
  createTaskInput,
  listTasksQuery,
  updateTaskInput,
  userActor,
  validation,
} from '@palouse/shared';
import { taskService } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { enqueuePush } from '@palouse/queue';
import { getEventBus, getSyncQueue } from '../queue.js';
import { requireTasksAccess } from '../capability-access.js';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const taskRoutes = new Hono<SessionVars>();

/**
 * Tells open boards in this workspace that a task moved. Fire and forget, like
 * the sync push next to it: a Redis hiccup must never fail the mutation the
 * user actually asked for.
 */
function publishTaskChanged(
  workspaceId: string,
  taskId: string,
  action: 'created' | 'updated' | 'commented',
): void {
  getEventBus().publish(workspaceId, {
    type: 'task.changed',
    taskId,
    action,
    at: new Date().toISOString(),
  });
}

taskRoutes.use('*', requireSession);

taskRoutes.get('/', async (c) => {
  const parsed = listTasksQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid task query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireTasksAccess(db, parsed.data.workspaceId, c.get('userId'));
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
  await requireTasksAccess(db, workspaceId, c.get('userId'));
  const task = await taskService.createTask(db, workspaceId, userActor(c.get('userId')), parsed.data);
  publishTaskChanged(workspaceId, task.id, 'created');
  return c.json({ task }, 201);
});

taskRoutes.get('/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireTasksAccess(db, workspaceId, c.get('userId'));
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
  await requireTasksAccess(db, workspaceId, c.get('userId'));
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
  publishTaskChanged(workspaceId, task.id, 'updated');
  return c.json({ task });
});

taskRoutes.post('/:id/comments', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = createCommentInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid comment', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireTasksAccess(db, workspaceId, c.get('userId'));
  const comment = await taskService.addComment(
    db,
    workspaceId,
    userActor(c.get('userId')),
    c.req.param('id'),
    parsed.data,
  );
  publishTaskChanged(workspaceId, c.req.param('id'), 'commented');
  return c.json({ comment }, 201);
});

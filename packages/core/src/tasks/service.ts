import { and, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { auditEvents, taskComments, taskSources, tasks, type Database } from '@palouse/db';
import {
  notFound,
  type Actor,
  type CreateCommentInput,
  type CreateTaskInput,
  type ExternalSystem,
  type ListTasksQuery,
  type Task,
  type TaskComment,
  type TaskListItem,
  type TaskSource,
  type TaskStatus,
  type UpdateTaskInput,
} from '@palouse/shared';

function toDto(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    descriptionMd: row.descriptionMd,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString() ?? null,
    assigneeUserId: row.assigneeUserId,
    parentTaskId: row.parentTaskId,
    origin: row.origin,
    createdByAgentId: row.createdByAgentId,
    sourceOfTruth: row.sourceOfTruth,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function commentToDto(row: typeof taskComments.$inferSelect): TaskComment {
  return {
    id: row.id,
    taskId: row.taskId,
    authorUserId: row.authorUserId,
    bodyMd: row.bodyMd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sourceToDto(row: typeof taskSources.$inferSelect): TaskSource {
  return {
    id: row.id,
    taskId: row.taskId,
    integrationId: row.integrationId,
    externalSystem: row.externalSystem,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    externalUpdatedAt: row.externalUpdatedAt?.toISOString() ?? null,
  };
}

export async function listTasks(
  db: Database,
  query: ListTasksQuery,
): Promise<{ tasks: TaskListItem[]; total: number }> {
  const conditions: SQL[] = [eq(tasks.workspaceId, query.workspaceId)];
  if (query.status) conditions.push(eq(tasks.status, query.status));
  if (query.assigneeUserId) conditions.push(eq(tasks.assigneeUserId, query.assigneeUserId));
  if (query.search) conditions.push(ilike(tasks.title, `%${query.search}%`));
  const where = and(...conditions);

  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.updatedAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(tasks).where(where),
  ]);

  // Attach the external systems each task is linked to (empty = native). Fetched
  // in one query keyed by this page's task ids to avoid a join that fans out
  // rows for tasks with multiple sources.
  const ids = rows.map((r) => r.id);
  const providersByTask = new Map<string, ExternalSystem[]>();
  if (ids.length > 0) {
    const sources = await db
      .select({ taskId: taskSources.taskId, externalSystem: taskSources.externalSystem })
      .from(taskSources)
      .where(inArray(taskSources.taskId, ids));
    for (const s of sources) {
      const list = providersByTask.get(s.taskId);
      if (list) list.push(s.externalSystem);
      else providersByTask.set(s.taskId, [s.externalSystem]);
    }
  }

  return {
    tasks: rows.map((r) => ({ ...toDto(r), providers: providersByTask.get(r.id) ?? [] })),
    total: count?.total ?? 0,
  };
}

export async function getTask(
  db: Database,
  workspaceId: string,
  taskId: string,
): Promise<{ task: Task; comments: TaskComment[]; sources: TaskSource[] }> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound('Task not found');

  const [comments, sources] = await Promise.all([
    db.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(taskComments.createdAt),
    db.select().from(taskSources).where(eq(taskSources.taskId, taskId)),
  ]);
  return { task: toDto(row), comments: comments.map(commentToDto), sources: sources.map(sourceToDto) };
}

export async function createTask(
  db: Database,
  workspaceId: string,
  actor: Actor,
  input: CreateTaskInput,
  opts: { status?: TaskStatus } = {},
): Promise<Task> {
  const [row] = await db
    .insert(tasks)
    .values({
      workspaceId,
      title: input.title,
      descriptionMd: input.descriptionMd ?? null,
      // Omit status when unset so the DB default ('open') applies.
      ...(opts.status ? { status: opts.status } : {}),
      priority: input.priority,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      assigneeUserId: input.assigneeUserId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      origin: actor.type,
      createdByAgentId: actor.type === 'agent' ? actor.id : null,
    })
    .returning();
  await audit(db, workspaceId, actor, 'task.created', row!.id);
  return toDto(row!);
}

export async function updateTask(
  db: Database,
  workspaceId: string,
  actor: Actor,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.descriptionMd !== undefined) patch.descriptionMd = input.descriptionMd;
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (input.assigneeUserId !== undefined) patch.assigneeUserId = input.assigneeUserId;

  const [row] = await db
    .update(tasks)
    .set(patch)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound('Task not found');
  await audit(db, workspaceId, actor, 'task.updated', taskId, { fields: Object.keys(input) });
  return toDto(row);
}

export async function addComment(
  db: Database,
  workspaceId: string,
  actor: Actor,
  taskId: string,
  input: CreateCommentInput,
): Promise<TaskComment> {
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!task) throw notFound('Task not found');

  // Comments have a user author column only; agent comments keep it null and
  // are attributed via the audit trail.
  const [row] = await db
    .insert(taskComments)
    .values({ taskId, authorUserId: actor.type === 'user' ? actor.id : null, bodyMd: input.bodyMd })
    .returning();
  await audit(db, workspaceId, actor, 'task.commented', taskId);
  return commentToDto(row!);
}

async function audit(
  db: Database,
  workspaceId: string,
  actor: Actor,
  action: string,
  targetId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId,
    actorType: actor.type,
    actorId: actor.id,
    action,
    targetType: 'task',
    targetId,
    payload,
  });
}

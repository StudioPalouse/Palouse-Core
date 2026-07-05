import { z } from 'zod';
import { uuid, externalSystem } from './ids.js';

export const taskStatus = z.enum(['open', 'in_progress', 'blocked', 'done', 'archived']);
export type TaskStatus = z.infer<typeof taskStatus>;

export const sourceOfTruth = z.enum(['palouse', 'external']);
export type SourceOfTruth = z.infer<typeof sourceOfTruth>;

export const taskOrigin = z.enum(['user', 'agent']);
export type TaskOrigin = z.infer<typeof taskOrigin>;

export const taskSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  title: z.string().min(1).max(500),
  descriptionMd: z.string().nullable(),
  status: taskStatus,
  priority: z.number().int().min(0).max(4),
  dueAt: z.string().datetime().nullable(),
  assigneeUserId: uuid.nullable(),
  parentTaskId: uuid.nullable(),
  origin: taskOrigin,
  createdByAgentId: uuid.nullable(),
  sourceOfTruth,
  lastSyncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof taskSchema>;

/**
 * A task as returned by the list endpoint, enriched with the external systems it
 * is linked to. An empty `providers` array means the task is native (Palouse
 * only, with no external source).
 */
export const taskListItemSchema = taskSchema.extend({
  providers: z.array(externalSystem),
});
export type TaskListItem = z.infer<typeof taskListItemSchema>;

export const taskSourceSchema = z.object({
  id: uuid,
  taskId: uuid,
  integrationId: uuid,
  externalSystem,
  externalId: z.string(),
  externalUrl: z.string().url().nullable(),
  externalUpdatedAt: z.string().datetime().nullable(),
});
export type TaskSource = z.infer<typeof taskSourceSchema>;

export const createTaskInput = z.object({
  title: z.string().min(1).max(500),
  descriptionMd: z.string().nullish(),
  priority: z.number().int().min(0).max(4).default(2),
  dueAt: z.string().datetime().nullish(),
  assigneeUserId: uuid.nullish(),
  parentTaskId: uuid.nullish(),
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;

export const updateTaskInput = z.object({
  title: z.string().min(1).max(500).optional(),
  descriptionMd: z.string().nullable().optional(),
  status: taskStatus.optional(),
  priority: z.number().int().min(0).max(4).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;

export const listTasksQuery = z.object({
  workspaceId: uuid,
  status: taskStatus.optional(),
  assigneeUserId: uuid.optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListTasksQuery = z.infer<typeof listTasksQuery>;

export const taskCommentSchema = z.object({
  id: uuid,
  taskId: uuid,
  authorUserId: uuid.nullable(),
  bodyMd: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const createCommentInput = z.object({
  bodyMd: z.string().min(1).max(20_000),
});
export type CreateCommentInput = z.infer<typeof createCommentInput>;

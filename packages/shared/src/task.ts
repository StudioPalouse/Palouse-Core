import { z } from 'zod';
import { uuid, externalSystem } from './ids.js';

export const taskStatus = z.enum(['open', 'in_progress', 'blocked', 'done', 'archived']);
export type TaskStatus = z.infer<typeof taskStatus>;

export const sourceOfTruth = z.enum(['reqops', 'external']);
export type SourceOfTruth = z.infer<typeof sourceOfTruth>;

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
  sourceOfTruth,
  lastSyncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof taskSchema>;

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

export const createTaskInput = taskSchema.pick({
  title: true,
  descriptionMd: true,
  priority: true,
  dueAt: true,
  assigneeUserId: true,
  parentTaskId: true,
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;

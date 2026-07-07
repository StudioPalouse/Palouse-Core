import { z } from 'zod';
import { uuid } from './ids.js';

// Keep these in sync with the pg enums in packages/db/src/schema/projects.ts.
export const projectStatus = z.enum([
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
]);
export type ProjectStatus = z.infer<typeof projectStatus>;

export const projectOrigin = z.enum(['user', 'agent']);
export type ProjectOrigin = z.infer<typeof projectOrigin>;

export const projectSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  name: z.string().min(1).max(300),
  descriptionMd: z.string().nullable(),
  status: projectStatus,
  origin: projectOrigin,
  createdByUserId: uuid.nullable(),
  createdByAgentId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectColumnSchema = z.object({
  id: uuid,
  projectId: uuid,
  name: z.string().min(1).max(200),
  position: z.number(),
  isDone: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ProjectColumn = z.infer<typeof projectColumnSchema>;

/** A task linked to a card, resolved to its title and status for display. */
export const linkedTaskSchema = z.object({
  taskId: uuid,
  title: z.string(),
  status: z.string(),
});
export type LinkedTask = z.infer<typeof linkedTaskSchema>;

/** A decision linked to a card, resolved to its title and status for display. */
export const linkedDecisionSchema = z.object({
  relationId: uuid,
  decisionId: uuid,
  title: z.string(),
  status: z.string(),
});
export type LinkedDecision = z.infer<typeof linkedDecisionSchema>;

/**
 * A card. `completedAt` is the completion source of truth (kept in sync with the
 * card's column). `startDate`/`endDate` place it on the Gantt timeline.
 */
export const projectItemSchema = z.object({
  id: uuid,
  projectId: uuid,
  columnId: uuid,
  title: z.string().min(1).max(500),
  descriptionMd: z.string().nullable(),
  position: z.number(),
  completedAt: z.string().datetime().nullable(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  assigneeUserId: uuid.nullable(),
  origin: projectOrigin,
  createdByUserId: uuid.nullable(),
  createdByAgentId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectItem = z.infer<typeof projectItemSchema>;

export const projectItemDependencySchema = z.object({
  id: uuid,
  projectId: uuid,
  predecessorItemId: uuid,
  successorItemId: uuid,
  createdAt: z.string().datetime(),
});
export type ProjectItemDependency = z.infer<typeof projectItemDependencySchema>;

/** A card enriched with its links and Gantt dependency edges. */
export const projectItemWithLinksSchema = projectItemSchema.extend({
  linkedTasks: z.array(linkedTaskSchema),
  linkedDecisions: z.array(linkedDecisionSchema),
  /** Ids of cards that must finish before this one (incoming edges). */
  predecessorItemIds: z.array(uuid),
  /** Ids of cards that depend on this one (outgoing edges). */
  successorItemIds: z.array(uuid),
});
export type ProjectItemWithLinks = z.infer<typeof projectItemWithLinksSchema>;

/**
 * A project as returned by the list endpoint, enriched with its item counts and
 * completion percentage so the list can render a progress bar without a detail
 * fetch.
 */
export const projectListItemSchema = projectSchema.extend({
  itemCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  progress: z.number().min(0).max(100),
});
export type ProjectListItem = z.infer<typeof projectListItemSchema>;

export const projectDetailSchema = z.object({
  project: projectSchema,
  columns: z.array(projectColumnSchema),
  items: z.array(projectItemWithLinksSchema),
  dependencies: z.array(projectItemDependencySchema),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const listProjectsQuery = z.object({
  workspaceId: uuid,
  status: projectStatus.optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuery>;

export const createProjectInput = z.object({
  name: z.string().min(1).max(300),
  descriptionMd: z.string().max(50_000).nullish(),
  status: projectStatus.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const updateProjectInput = z.object({
  name: z.string().min(1).max(300).optional(),
  descriptionMd: z.string().max(50_000).nullable().optional(),
  status: projectStatus.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

export const createColumnInput = z.object({
  name: z.string().min(1).max(200),
  position: z.number().optional(),
  isDone: z.boolean().optional(),
});
export type CreateColumnInput = z.infer<typeof createColumnInput>;

export const updateColumnInput = z.object({
  name: z.string().min(1).max(200).optional(),
  position: z.number().optional(),
  isDone: z.boolean().optional(),
});
export type UpdateColumnInput = z.infer<typeof updateColumnInput>;

export const createProjectItemInput = z.object({
  columnId: uuid.optional(),
  title: z.string().min(1).max(500),
  descriptionMd: z.string().max(50_000).nullish(),
  position: z.number().optional(),
  startDate: z.string().datetime().nullish(),
  endDate: z.string().datetime().nullish(),
  assigneeUserId: uuid.nullish(),
  /** Explicitly mark done; the column's isDone flag also drives completion. */
  completed: z.boolean().optional(),
});
export type CreateProjectItemInput = z.infer<typeof createProjectItemInput>;

export const updateProjectItemInput = z.object({
  columnId: uuid.optional(),
  title: z.string().min(1).max(500).optional(),
  descriptionMd: z.string().max(50_000).nullable().optional(),
  position: z.number().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
  completed: z.boolean().optional(),
});
export type UpdateProjectItemInput = z.infer<typeof updateProjectItemInput>;

export const linkTaskInput = z.object({ taskId: uuid });
export type LinkTaskInput = z.infer<typeof linkTaskInput>;

export const linkDecisionInput = z.object({ decisionId: uuid });
export type LinkDecisionInput = z.infer<typeof linkDecisionInput>;

export const addDependencyInput = z.object({
  predecessorItemId: uuid,
  successorItemId: uuid,
});
export type AddDependencyInput = z.infer<typeof addDependencyInput>;

/** Body for laddering a whole project up to a key result. */
export const linkKeyResultProjectInput = z.object({ projectId: uuid });
export type LinkKeyResultProjectInput = z.infer<typeof linkKeyResultProjectInput>;

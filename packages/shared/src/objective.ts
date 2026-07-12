import { z } from 'zod';
import { uuid } from './ids.js';
import { linkedDecisionSchema } from './project.js';

// Keep these in sync with the pg enums in packages/db/src/schema/objectives.ts.
export const objectiveStatus = z.enum([
  'planning',
  'active',
  'at_risk',
  'achieved',
  'missed',
  'archived',
]);
export type ObjectiveStatus = z.infer<typeof objectiveStatus>;

export const objectiveOrigin = z.enum(['user', 'agent']);
export type ObjectiveOrigin = z.infer<typeof objectiveOrigin>;

export const objectiveSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  title: z.string().min(1).max(500),
  descriptionMd: z.string().nullable(),
  area: z.string().nullable(),
  status: objectiveStatus,
  startDate: z.string().datetime().nullable(),
  targetDate: z.string().datetime().nullable(),
  origin: objectiveOrigin,
  createdByUserId: uuid.nullable(),
  createdByAgentId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Objective = z.infer<typeof objectiveSchema>;

/** A project laddered up to a key result, with its live completion fraction. */
export const keyResultProjectSchema = z.object({
  projectId: uuid,
  name: z.string(),
  itemCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  /** completedCount / itemCount, 0 when the project has no items. */
  fraction: z.number().min(0).max(1),
});
export type KeyResultProject = z.infer<typeof keyResultProjectSchema>;

/**
 * A key result as returned to clients. `progress` is a computed 0-100 attainment
 * derived from start/target/current (never stored); the service fills it in.
 * When `derived` is true the `currentValue` was computed from `linkedProjects'`
 * completion (the sum of their fractions) rather than set by hand.
 */
export const keyResultSchema = z.object({
  id: uuid,
  objectiveId: uuid,
  name: z.string().min(1).max(300),
  startValue: z.number(),
  targetValue: z.number(),
  currentValue: z.number(),
  unit: z.string().nullable(),
  progress: z.number().min(0).max(100),
  derived: z.boolean(),
  linkedProjects: z.array(keyResultProjectSchema),
  createdByUserId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KeyResult = z.infer<typeof keyResultSchema>;

/**
 * An objective as returned by the list endpoint, enriched with its key-result
 * count and rolled-up progress (the average of its key results' attainment) so
 * the list can render a progress bar without a full detail fetch.
 */
export const objectiveListItemSchema = objectiveSchema.extend({
  keyResultCount: z.number().int().nonnegative(),
  progress: z.number().min(0).max(100),
});
export type ObjectiveListItem = z.infer<typeof objectiveListItemSchema>;

export const objectiveDetailSchema = z.object({
  objective: objectiveSchema,
  keyResults: z.array(keyResultSchema),
  /**
   * Decisions linked to this objective (`goal` relations) or to any of its key
   * results (`key_result` relations), resolved to title + status. Empty when the
   * decisions capability is off for the workspace (gated server-side so a disabled
   * capability never leaks decision titles through the objectives gate).
   */
  relatedDecisions: z.array(linkedDecisionSchema),
});
export type ObjectiveDetail = z.infer<typeof objectiveDetailSchema>;

/** Key-result fields accepted when creating a KR inline with its objective. */
export const createKeyResultInput = z.object({
  name: z.string().min(1).max(300),
  startValue: z.number().default(0),
  targetValue: z.number(),
  currentValue: z.number().optional(),
  unit: z.string().max(50).nullish(),
});
export type CreateKeyResultInput = z.infer<typeof createKeyResultInput>;

export const updateKeyResultInput = z.object({
  name: z.string().min(1).max(300).optional(),
  startValue: z.number().optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().optional(),
  unit: z.string().max(50).nullable().optional(),
});
export type UpdateKeyResultInput = z.infer<typeof updateKeyResultInput>;

export const createObjectiveInput = z.object({
  title: z.string().min(1).max(500),
  descriptionMd: z.string().max(50_000).nullish(),
  area: z.string().max(200).nullish(),
  status: objectiveStatus.optional(),
  startDate: z.string().datetime().nullish(),
  targetDate: z.string().datetime().nullish(),
  keyResults: z.array(createKeyResultInput).max(100).optional(),
});
export type CreateObjectiveInput = z.infer<typeof createObjectiveInput>;

export const updateObjectiveInput = z.object({
  title: z.string().min(1).max(500).optional(),
  descriptionMd: z.string().max(50_000).nullable().optional(),
  area: z.string().max(200).nullable().optional(),
  status: objectiveStatus.optional(),
  startDate: z.string().datetime().nullable().optional(),
  targetDate: z.string().datetime().nullable().optional(),
});
export type UpdateObjectiveInput = z.infer<typeof updateObjectiveInput>;

/** Body for the CSV bulk-import endpoint. `dryRun` parses and previews without writing. */
export const importObjectivesInput = z.object({
  csv: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().optional(),
});
export type ImportObjectivesInput = z.infer<typeof importObjectivesInput>;

/** A row that could not be imported, with its 1-based spreadsheet row number. */
export const objectiveImportErrorSchema = z.object({
  row: z.number().int(),
  message: z.string(),
});
export type ObjectiveImportError = z.infer<typeof objectiveImportErrorSchema>;

/** One objective in the import preview/result (a summary, not the full record). */
export const objectiveImportItemSchema = z.object({
  title: z.string(),
  status: objectiveStatus,
  keyResultCount: z.number().int().nonnegative(),
});
export type ObjectiveImportItem = z.infer<typeof objectiveImportItemSchema>;

export const objectiveImportResultSchema = z.object({
  dryRun: z.boolean(),
  objectiveCount: z.number().int().nonnegative(),
  keyResultCount: z.number().int().nonnegative(),
  objectives: z.array(objectiveImportItemSchema),
  errors: z.array(objectiveImportErrorSchema),
});
export type ObjectiveImportResult = z.infer<typeof objectiveImportResultSchema>;

export const listObjectivesQuery = z.object({
  workspaceId: uuid,
  status: objectiveStatus.optional(),
  area: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListObjectivesQuery = z.infer<typeof listObjectivesQuery>;

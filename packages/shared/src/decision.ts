import { z } from 'zod';
import { uuid } from './ids.js';

// Keep these in sync with the pg enums in packages/db/src/schema/decisions.ts.
export const decisionStatus = z.enum([
  'proposed',
  'under_review',
  'accepted',
  'rejected',
  'deprecated',
  'superseded',
]);
export type DecisionStatus = z.infer<typeof decisionStatus>;

export const decisionOrigin = z.enum(['user', 'agent']);
export type DecisionOrigin = z.infer<typeof decisionOrigin>;

export const raciRole = z.enum(['responsible', 'accountable', 'consulted', 'informed']);
export type RaciRole = z.infer<typeof raciRole>;

export const decisionEntityType = z.enum(['task', 'project', 'goal', 'context']);
export type DecisionEntityType = z.infer<typeof decisionEntityType>;

export const decisionResourceKind = z.enum(['link', 'document', 'other']);
export type DecisionResourceKind = z.infer<typeof decisionResourceKind>;

export const decisionSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  title: z.string().min(1).max(500),
  descriptionMd: z.string().nullable(),
  area: z.string().nullable(),
  status: decisionStatus,
  decidedAt: z.string().datetime().nullable(),
  supersededByDecisionId: uuid.nullable(),
  origin: decisionOrigin,
  createdByUserId: uuid.nullable(),
  createdByAgentId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const decisionStakeholderSchema = z.object({
  id: uuid,
  decisionId: uuid,
  userId: uuid,
  role: raciRole,
  assignedByUserId: uuid.nullable(),
  createdAt: z.string().datetime(),
});
export type DecisionStakeholder = z.infer<typeof decisionStakeholderSchema>;

export const decisionCommentSchema = z.object({
  id: uuid,
  decisionId: uuid,
  authorUserId: uuid.nullable(),
  bodyMd: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DecisionComment = z.infer<typeof decisionCommentSchema>;

export const decisionResourceSchema = z.object({
  id: uuid,
  decisionId: uuid,
  label: z.string(),
  url: z.string(),
  kind: decisionResourceKind,
  addedByUserId: uuid.nullable(),
  createdAt: z.string().datetime(),
});
export type DecisionResource = z.infer<typeof decisionResourceSchema>;

export const decisionRelationSchema = z.object({
  id: uuid,
  decisionId: uuid,
  entityType: decisionEntityType,
  entityId: uuid,
  createdByUserId: uuid.nullable(),
  createdAt: z.string().datetime(),
});
export type DecisionRelation = z.infer<typeof decisionRelationSchema>;

/**
 * A decision as returned by the list endpoint, enriched with lightweight counts
 * so the list can show RACI/relation density without a full detail fetch.
 */
export const decisionListItemSchema = decisionSchema.extend({
  stakeholderCount: z.number().int().nonnegative(),
  relationCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
});
export type DecisionListItem = z.infer<typeof decisionListItemSchema>;

export const decisionDetailSchema = z.object({
  decision: decisionSchema,
  stakeholders: z.array(decisionStakeholderSchema),
  comments: z.array(decisionCommentSchema),
  resources: z.array(decisionResourceSchema),
  relations: z.array(decisionRelationSchema),
});
export type DecisionDetail = z.infer<typeof decisionDetailSchema>;

const stakeholderAssignment = z.object({ userId: uuid, role: raciRole });
export type StakeholderAssignment = z.infer<typeof stakeholderAssignment>;

const relationRef = z.object({ entityType: decisionEntityType, entityId: uuid });

export const createDecisionInput = z.object({
  title: z.string().min(1).max(500),
  descriptionMd: z.string().max(50_000).nullish(),
  area: z.string().max(200).nullish(),
  status: decisionStatus.optional(),
  stakeholders: z.array(stakeholderAssignment).max(100).optional(),
  relations: z.array(relationRef).max(100).optional(),
});
export type CreateDecisionInput = z.infer<typeof createDecisionInput>;

export const updateDecisionInput = z.object({
  title: z.string().min(1).max(500).optional(),
  descriptionMd: z.string().max(50_000).nullable().optional(),
  area: z.string().max(200).nullable().optional(),
  status: decisionStatus.optional(),
  supersededByDecisionId: uuid.nullable().optional(),
});
export type UpdateDecisionInput = z.infer<typeof updateDecisionInput>;

export const listDecisionsQuery = z.object({
  workspaceId: uuid,
  status: decisionStatus.optional(),
  area: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListDecisionsQuery = z.infer<typeof listDecisionsQuery>;

export const createDecisionCommentInput = z.object({
  bodyMd: z.string().min(1).max(50_000),
});
export type CreateDecisionCommentInput = z.infer<typeof createDecisionCommentInput>;

/** Full replace of a decision's RACI roster. At most one accountable allowed. */
export const setStakeholdersInput = z.object({
  stakeholders: z.array(stakeholderAssignment).max(100),
});
export type SetStakeholdersInput = z.infer<typeof setStakeholdersInput>;

export const addResourceInput = z.object({
  label: z.string().min(1).max(300),
  url: z.string().url().max(2000),
  kind: decisionResourceKind.default('link'),
});
export type AddResourceInput = z.infer<typeof addResourceInput>;

export const addRelationInput = z.object({
  entityType: decisionEntityType,
  entityId: uuid,
});
export type AddRelationInput = z.infer<typeof addRelationInput>;

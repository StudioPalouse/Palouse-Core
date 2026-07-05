import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { agents } from './handoffs.js';
import { users, workspaces } from './identity.js';

const baseId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const decisionStatus = pgEnum('decision_status', [
  'proposed',
  'under_review',
  'accepted',
  'rejected',
  'deprecated',
  'superseded',
]);

export const decisionOrigin = pgEnum('decision_origin', ['user', 'agent']);

export const raciRole = pgEnum('raci_role', [
  'responsible',
  'accountable',
  'consulted',
  'informed',
]);

export const decisionEntityType = pgEnum('decision_entity_type', [
  'task',
  'project',
  'goal',
  'context',
]);

export const decisionResourceKind = pgEnum('decision_resource_kind', ['link', 'document', 'other']);

export const decisions = pgTable(
  'decisions',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    area: text('area'),
    status: decisionStatus('status').notNull().default('proposed'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    supersededByDecisionId: uuid('superseded_by_decision_id').references((): any => decisions.id, {
      onDelete: 'set null',
    }),
    origin: decisionOrigin('origin').notNull().default('user'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    workspaceIdx: index('decisions_workspace_idx').on(t.workspaceId),
    workspaceStatusIdx: index('decisions_workspace_status_idx').on(t.workspaceId, t.status),
  }),
);

export const decisionStakeholders = pgTable(
  'decision_stakeholders',
  {
    id: baseId(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: raciRole('role').notNull(),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    decisionUserRoleUq: uniqueIndex('decision_stakeholders_decision_user_role_uq').on(
      t.decisionId,
      t.userId,
      t.role,
    ),
    decisionIdx: index('decision_stakeholders_decision_idx').on(t.decisionId),
  }),
);

export const decisionComments = pgTable(
  'decision_comments',
  {
    id: baseId(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    bodyMd: text('body_md').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    decisionCreatedIdx: index('decision_comments_decision_created_idx').on(
      t.decisionId,
      t.createdAt,
    ),
  }),
);

export const decisionResources = pgTable(
  'decision_resources',
  {
    id: baseId(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    url: text('url').notNull(),
    kind: decisionResourceKind('kind').notNull().default('link'),
    addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    decisionIdx: index('decision_resources_decision_idx').on(t.decisionId),
  }),
);

export const decisionRelations = pgTable(
  'decision_relations',
  {
    id: baseId(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    // Polymorphic: entityId is not a hard FK because it may point at any of the
    // linked capabilities. Only 'task' is resolvable today; the rest are
    // reserved for when those capabilities land.
    entityType: decisionEntityType('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    decisionEntityUq: uniqueIndex('decision_relations_decision_entity_uq').on(
      t.decisionId,
      t.entityType,
      t.entityId,
    ),
    decisionIdx: index('decision_relations_decision_idx').on(t.decisionId),
  }),
);

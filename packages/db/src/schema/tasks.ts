import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents } from './handoffs.js';
import { users, workspaces } from './identity.js';

const baseId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const taskStatus = pgEnum('task_status', [
  'open',
  'in_progress',
  'blocked',
  'done',
  'archived',
]);

export const sourceOfTruth = pgEnum('source_of_truth', ['palouse', 'external']);

export const taskOrigin = pgEnum('task_origin', ['user', 'agent']);

export const externalSystem = pgEnum('external_system', [
  'google_tasks',
  'ms_todo',
  'ms_planner',
  'asana',
  'notion',
  'todoist',
  'palouse',
]);

export const tasks = pgTable(
  'tasks',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    status: taskStatus('status').notNull().default('open'),
    priority: integer('priority').notNull().default(2),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    parentTaskId: uuid('parent_task_id').references((): any => tasks.id, { onDelete: 'set null' }),
    origin: taskOrigin('origin').notNull().default('user'),
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    sourceOfTruth: sourceOfTruth('source_of_truth').notNull().default('palouse'),
    externalCanonicalId: text('external_canonical_id'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    etag: text('etag'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    workspaceIdx: index('tasks_workspace_idx').on(t.workspaceId),
    workspaceStatusIdx: index('tasks_workspace_status_idx').on(t.workspaceId, t.status),
    assigneeIdx: index('tasks_assignee_idx').on(t.assigneeUserId),
  }),
);

export const taskSources = pgTable(
  'task_sources',
  {
    id: baseId(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id').notNull(),
    externalSystem: externalSystem('external_system').notNull(),
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url'),
    externalEtag: text('external_etag'),
    externalUpdatedAt: timestamp('external_updated_at', { withTimezone: true, mode: 'date' }),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    externalUq: uniqueIndex('task_sources_external_uq').on(
      t.externalSystem,
      t.externalId,
      t.integrationId,
    ),
    taskIdx: index('task_sources_task_idx').on(t.taskId),
  }),
);

export const taskComments = pgTable(
  'task_comments',
  {
    id: baseId(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorAgentId: uuid('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    bodyMd: text('body_md').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    taskCreatedIdx: index('task_comments_task_created_idx').on(t.taskId, t.createdAt),
  }),
);

export const assigneeType = pgEnum('assignee_type', ['user', 'agent']);

export const taskAssignments = pgTable(
  'task_assignments',
  {
    id: baseId(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    assigneeType: assigneeType('assignee_type').notNull(),
    assigneeId: uuid('assignee_id').notNull(),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    assignedAt: ts('assigned_at'),
    unassignedAt: timestamp('unassigned_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => ({
    taskIdx: index('task_assignments_task_idx').on(t.taskId),
  }),
);

import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents } from './handoffs.js';
import { users, workspaces } from './identity.js';
import { keyResults } from './objectives.js';
import { tasks } from './tasks.js';

const baseId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const projectStatus = pgEnum('project_status', [
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
]);

export const projectOrigin = pgEnum('project_origin', ['user', 'agent']);

/** A board. Its columns and items form a lightweight Kanban / Gantt project. */
export const projects = pgTable(
  'projects',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    descriptionMd: text('description_md'),
    status: projectStatus('status').notNull().default('active'),
    origin: projectOrigin('origin').notNull().default('user'),
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
    workspaceIdx: index('projects_workspace_idx').on(t.workspaceId),
    workspaceStatusIdx: index('projects_workspace_status_idx').on(t.workspaceId, t.status),
  }),
);

/**
 * A custom Kanban column (list). `position` is a fractional rank so a column can
 * be dropped between two others without renumbering. `isDone` marks the column
 * whose cards count as complete; moving a card into it sets the card's
 * completedAt.
 */
export const projectColumns = pgTable(
  'project_columns',
  {
    id: baseId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: doublePrecision('position').notNull().default(0),
    isDone: boolean('is_done').notNull().default(false),
    createdAt: ts('created_at'),
  },
  (t) => ({
    projectIdx: index('project_columns_project_idx').on(t.projectId),
  }),
);

/**
 * A card. `completedAt` is the source of truth for completion (drives KR
 * rollup), kept in sync when a card moves in or out of an `isDone` column.
 * `startDate`/`endDate` position the card on the Gantt timeline.
 */
export const projectItems = pgTable(
  'project_items',
  {
    id: baseId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    columnId: uuid('column_id')
      .notNull()
      .references(() => projectColumns.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    position: doublePrecision('position').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    startDate: timestamp('start_date', { withTimezone: true, mode: 'date' }),
    endDate: timestamp('end_date', { withTimezone: true, mode: 'date' }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    origin: projectOrigin('origin').notNull().default('user'),
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
    projectIdx: index('project_items_project_idx').on(t.projectId),
    columnIdx: index('project_items_column_idx').on(t.columnId),
  }),
);

/** A Gantt dependency edge: predecessor must precede successor. */
export const projectItemDependencies = pgTable(
  'project_item_dependencies',
  {
    id: baseId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    predecessorItemId: uuid('predecessor_item_id')
      .notNull()
      .references(() => projectItems.id, { onDelete: 'cascade' }),
    successorItemId: uuid('successor_item_id')
      .notNull()
      .references(() => projectItems.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    edgeUq: uniqueIndex('project_item_dependencies_edge_uq').on(
      t.predecessorItemId,
      t.successorItemId,
    ),
    projectIdx: index('project_item_dependencies_project_idx').on(t.projectId),
  }),
);

/** Links a card to a workspace task. */
export const projectItemTasks = pgTable(
  'project_item_tasks',
  {
    id: baseId(),
    projectItemId: uuid('project_item_id')
      .notNull()
      .references(() => projectItems.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    itemTaskUq: uniqueIndex('project_item_tasks_item_task_uq').on(t.projectItemId, t.taskId),
    itemIdx: index('project_item_tasks_item_idx').on(t.projectItemId),
    taskIdx: index('project_item_tasks_task_idx').on(t.taskId),
  }),
);

/**
 * Ladders a whole project up to a key result. The KR's progress is derived from
 * the linked projects' completion fraction (completed items / total items).
 */
export const keyResultProjects = pgTable(
  'key_result_projects',
  {
    id: baseId(),
    keyResultId: uuid('key_result_id')
      .notNull()
      .references(() => keyResults.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    krProjectUq: uniqueIndex('key_result_projects_kr_project_uq').on(t.keyResultId, t.projectId),
    krIdx: index('key_result_projects_kr_idx').on(t.keyResultId),
    projectIdx: index('key_result_projects_project_idx').on(t.projectId),
  }),
);

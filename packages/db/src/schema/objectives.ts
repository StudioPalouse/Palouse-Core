import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
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

export const objectiveStatus = pgEnum('objective_status', [
  'planning',
  'active',
  'at_risk',
  'achieved',
  'missed',
  'archived',
]);

export const objectiveOrigin = pgEnum('objective_origin', ['user', 'agent']);

export const objectives = pgTable(
  'objectives',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    area: text('area'),
    status: objectiveStatus('status').notNull().default('planning'),
    startDate: timestamp('start_date', { withTimezone: true, mode: 'date' }),
    targetDate: timestamp('target_date', { withTimezone: true, mode: 'date' }),
    origin: objectiveOrigin('origin').notNull().default('user'),
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
    workspaceIdx: index('objectives_workspace_idx').on(t.workspaceId),
    workspaceStatusIdx: index('objectives_workspace_status_idx').on(t.workspaceId, t.status),
  }),
);

export const keyResults = pgTable(
  'key_results',
  {
    id: baseId(),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startValue: doublePrecision('start_value').notNull().default(0),
    targetValue: doublePrecision('target_value').notNull(),
    currentValue: doublePrecision('current_value').notNull().default(0),
    unit: text('unit'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    objectiveIdx: index('key_results_objective_idx').on(t.objectiveId),
  }),
);

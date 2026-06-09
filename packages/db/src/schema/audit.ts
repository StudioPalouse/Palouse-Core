import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './identity.js';

const baseId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const auditEvents = pgTable(
  'audit_events',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    at: ts('at'),
  },
  (t) => ({
    workspaceAtIdx: index('audit_events_workspace_at_idx').on(t.workspaceId, t.at),
    workspaceActionIdx: index('audit_events_workspace_action_idx').on(t.workspaceId, t.action),
  }),
);

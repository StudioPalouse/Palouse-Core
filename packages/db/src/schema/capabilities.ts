import { sql } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users, workspaces } from './identity.js';

const baseId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

// Keep in sync with CAPABILITY_KEYS in @palouse/shared.
export const capabilityKey = pgEnum('capability_key', [
  'tasks',
  'decisions',
  'projects',
  'context',
  'objectives',
  'audit',
]);

/**
 * Per-workspace capability overrides. Rows exist only once an admin has touched
 * a toggle; a capability with no row is enabled. Disabled capabilities are
 * hidden from the nav and their pages show a "turned off" state.
 */
export const workspaceCapabilities = pgTable(
  'workspace_capabilities',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    capability: capabilityKey('capability').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    workspaceCapabilityUq: uniqueIndex('workspace_capabilities_workspace_capability_uq').on(
      t.workspaceId,
      t.capability,
    ),
  }),
);

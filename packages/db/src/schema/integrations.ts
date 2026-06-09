import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './identity.js';

const baseId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

const bytea = customType<{ data: Buffer; driverData: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const integrationProvider = pgEnum('integration_provider', [
  'google_tasks',
  'ms_todo',
  'ms_planner',
  'asana',
]);

export const integrationStatus = pgEnum('integration_status', ['active', 'degraded', 'revoked']);

export const integrations = pgTable(
  'integrations',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    accountLabel: text('account_label').notNull(),
    oauthAccessTokenEnc: bytea('oauth_access_token_enc').notNull(),
    oauthRefreshTokenEnc: bytea('oauth_refresh_token_enc'),
    oauthExpiresAt: timestamp('oauth_expires_at', { withTimezone: true, mode: 'date' }),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    externalAccountId: text('external_account_id'),
    webhookSubscriptionId: text('webhook_subscription_id'),
    webhookExpiresAt: timestamp('webhook_expires_at', { withTimezone: true, mode: 'date' }),
    status: integrationStatus('status').notNull().default('active'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    workspaceIdx: index('integrations_workspace_idx').on(t.workspaceId),
    workspaceProviderAccountIdx: index('integrations_workspace_provider_account_idx').on(
      t.workspaceId,
      t.provider,
      t.externalAccountId,
    ),
  }),
);

export const syncCursors = pgTable(
  'sync_cursors',
  {
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    resource: text('resource').notNull(),
    cursor: text('cursor').notNull(),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.integrationId, t.resource] }),
  }),
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: baseId(),
    integrationId: uuid('integration_id').references(() => integrations.id, {
      onDelete: 'set null',
    }),
    provider: integrationProvider('provider').notNull(),
    signature: text('signature'),
    payloadHash: text('payload_hash').notNull(),
    receivedAt: ts('received_at'),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    status: text('status').notNull().default('pending'),
  },
  (t) => ({
    providerHashUq: uniqueIndex('webhook_deliveries_provider_hash_uq').on(
      t.provider,
      t.payloadHash,
    ),
  }),
);

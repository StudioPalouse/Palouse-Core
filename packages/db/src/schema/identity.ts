import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const baseId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member', 'viewer']);

// Deactivated members keep their membership row (so their authored/assigned work
// stays attributable and visible) but lose all access to the workspace.
export const membershipStatus = pgEnum('membership_status', ['active', 'inactive']);

export const organizations = pgTable(
  'organizations',
  {
    id: baseId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    billingCustomerId: text('billing_customer_id'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    slugUq: uniqueIndex('organizations_slug_uq').on(t.slug),
  }),
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: baseId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    orgSlugUq: uniqueIndex('workspaces_org_slug_uq').on(t.organizationId, t.slug),
  }),
);

// Better-Auth managed tables: users, sessions, accounts, verifications.
// We define the shape here for relational queries; Better-Auth's Drizzle adapter writes/reads them.
export const users = pgTable('users', {
  id: baseId(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
});

export const sessions = pgTable('sessions', {
  id: baseId(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
});

export const accounts = pgTable('accounts', {
  id: baseId(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  accountId: text('account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', {
    withTimezone: true,
    mode: 'date',
  }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    withTimezone: true,
    mode: 'date',
  }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
});

export const verifications = pgTable('verifications', {
  id: baseId(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
});

export const memberships = pgTable(
  'memberships',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('member'),
    status: membershipStatus('status').notNull().default('active'),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'date' }),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    workspaceUserUq: uniqueIndex('memberships_workspace_user_uq').on(t.workspaceId, t.userId),
  }),
);

export const invitationStatus = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
]);

export const invitations = pgTable(
  'invitations',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: memberRole('role').notNull().default('member'),
    // Only the SHA-256 hash of the invite token is stored; the raw token lives
    // solely in the emailed accept link.
    tokenHash: text('token_hash').notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    tokenHashIdx: index('invitations_token_hash_idx').on(t.tokenHash),
    workspaceIdx: index('invitations_workspace_idx').on(t.workspaceId),
  }),
);

// Pending "delete this account" confirmations. Level 1 (typing the account name)
// is checked when the row is created; this table is level 2: the raw token is
// emailed to the owner and stored only as a hash. Consuming it deletes the org.
export const accountDeletionTokens = pgTable(
  'account_deletion_tokens',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    tokenHashIdx: index('account_deletion_tokens_hash_idx').on(t.tokenHash),
    workspaceIdx: index('account_deletion_tokens_workspace_idx').on(t.workspaceId),
  }),
);

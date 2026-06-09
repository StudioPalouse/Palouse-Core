import { sql } from 'drizzle-orm';
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const baseId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member', 'viewer']);

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
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    workspaceUserUq: uniqueIndex('memberships_workspace_user_uq').on(t.workspaceId, t.userId),
  }),
);

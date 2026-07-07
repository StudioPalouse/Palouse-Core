import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users, sessions, workspaces } from './identity.js';
import { agents } from './handoffs.js';

const baseId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const tsNullable = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Better-Auth `@better-auth/oauth-provider` + `jwt` plugin tables. Like the
// identity tables, the shape is defined here for relational queries and
// migrations; Better-Auth's Drizzle adapter reads/writes them. `string[]` and
// `json` plugin fields are jsonb because the adapter runs with supportsJSON on pg.

// OAuth clients (RFC 7591 dynamic registrations plus any first-party clients).
// MCP clients (Claude, ChatGPT, Cursor) self-register here on first connect.
export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: baseId(),
    // Inline unique (not uniqueIndex): the other oauth tables' FKs reference
    // this column, and Postgres wants the constraint in place when they're added.
    clientId: text('client_id').notNull().unique(),
    // Hashed at rest (plugin storeClientSecret default). Public PKCE clients have none.
    clientSecret: text('client_secret'),
    disabled: boolean('disabled').notNull().default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: jsonb('scopes').$type<string[]>(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: jsonb('contacts').$type<string[]>(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
    postLogoutRedirectUris: jsonb('post_logout_redirect_uris').$type<string[]>(),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    grantTypes: jsonb('grant_types').$type<string[]>(),
    responseTypes: jsonb('response_types').$type<string[]>(),
    public: boolean('public'),
    type: text('type'),
    requirePKCE: boolean('require_pkce'),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    userIdx: index('oauth_clients_user_idx').on(t.userId),
  }),
);

// One row per (user, client) grant; reference_id carries the agent the grant
// is pinned to (and through it the workspace), set at consent time.
export const oauthConsents = pgTable(
  'oauth_consents',
  {
    id: baseId(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    clientIdx: index('oauth_consents_client_idx').on(t.clientId),
    userIdx: index('oauth_consents_user_idx').on(t.userId),
  }),
);

// Opaque refresh tokens (offline_access), hashed at rest.
export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: baseId(),
    token: text('token').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: ts('created_at'),
    revoked: tsNullable('revoked'),
    authTime: tsNullable('auth_time'),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
  },
  (t) => ({
    tokenUq: uniqueIndex('oauth_refresh_tokens_token_uq').on(t.token),
    clientIdx: index('oauth_refresh_tokens_client_idx').on(t.clientId),
    sessionIdx: index('oauth_refresh_tokens_session_idx').on(t.sessionId),
    userIdx: index('oauth_refresh_tokens_user_idx').on(t.userId),
  }),
);

// Opaque access tokens: only used when a token is minted without an audience.
// The MCP path always has an audience and gets JWTs, so this stays small.
export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: baseId(),
    token: text('token').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    refreshId: uuid('refresh_id').references(() => oauthRefreshTokens.id, {
      onDelete: 'cascade',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: ts('created_at'),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
  },
  (t) => ({
    tokenUq: uniqueIndex('oauth_access_tokens_token_uq').on(t.token),
    clientIdx: index('oauth_access_tokens_client_idx').on(t.clientId),
    sessionIdx: index('oauth_access_tokens_session_idx').on(t.sessionId),
    userIdx: index('oauth_access_tokens_user_idx').on(t.userId),
    refreshIdx: index('oauth_access_tokens_refresh_idx').on(t.refreshId),
  }),
);

// Signing keys for the jwt plugin (JWKS served at /api/auth/jwks).
export const jwks = pgTable('jwks', {
  id: baseId(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: ts('created_at'),
  expiresAt: tsNullable('expires_at'),
});

// Bridges the MCP connect flow's workspace-selection page to the consent that
// follows it: the page stores the user's choice keyed by session, and the
// oauthProvider postLogin.consentReferenceId callback reads it back to pin the
// consent (and every token minted from it) to the chosen agent/workspace.
// Rows are transient; each new selection for a session overwrites the last.
export const mcpConnectSelections = pgTable(
  'mcp_connect_selections',
  {
    id: baseId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    oauthClientId: text('oauth_client_id').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    sessionUq: uniqueIndex('mcp_connect_selections_session_uq').on(t.sessionId),
  }),
);

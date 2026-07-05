import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users, workspaces } from './identity.js';
import { tasks } from './tasks.js';

const baseId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const agentKind = pgEnum('agent_kind', ['mcp_generic', 'paperclip', 'claude_code', 'custom']);

export const handoffState = pgEnum('handoff_state', [
  'queued',
  'claimed',
  'in_progress',
  'needs_review',
  'completed',
  'failed',
  'cancelled',
]);

export const reviewDecision = pgEnum('review_decision', ['approved', 'rejected']);

export const agents = pgTable(
  'agents',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: agentKind('kind').notNull().default('mcp_generic'),
    publicKeyFingerprint: text('public_key_fingerprint'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    // Soft delete: agents with history (handoffs, usage, attributions) cannot be
    // hard-deleted, so they are archived instead. Archiving revokes active keys.
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    workspaceIdx: index('agents_workspace_idx').on(t.workspaceId),
  }),
);

export const agentApiKeys = pgTable(
  'agent_api_keys',
  {
    id: baseId(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    prefixIdx: index('agent_api_keys_prefix_idx').on(t.prefix),
  }),
);

export const agentHandoffs = pgTable(
  'agent_handoffs',
  {
    id: baseId(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorAgentId: uuid('actor_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    state: handoffState('state').notNull().default('queued'),
    claimToken: uuid('claim_token'),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true, mode: 'date' }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true, mode: 'date' }),
    // Heartbeat/claim window in minutes; used to (re)compute deadline_at on
    // claim and on every heartbeat.
    deadlineMinutes: smallint('deadline_minutes').notNull().default(30),
    requeueCount: smallint('requeue_count').notNull().default(0),
    resultSummaryMd: text('result_summary_md'),
    failureReason: text('failure_reason'),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewRequired: boolean('review_required').notNull().default(false),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    reviewDecision: reviewDecision('review_decision'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    claimTokenUq: uniqueIndex('agent_handoffs_claim_token_uq').on(t.claimToken),
    workspaceStateIdx: index('agent_handoffs_workspace_state_idx').on(t.workspaceId, t.state),
    taskIdx: index('agent_handoffs_task_idx').on(t.taskId),
    reaperIdx: index('agent_handoffs_reaper_idx').on(t.state, t.deadlineAt),
  }),
);

export const handoffEvents = pgTable(
  'handoff_events',
  {
    id: baseId(),
    handoffId: uuid('handoff_id')
      .notNull()
      .references(() => agentHandoffs.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    at: ts('at'),
  },
  (t) => ({
    handoffIdx: index('handoff_events_handoff_idx').on(t.handoffId),
  }),
);

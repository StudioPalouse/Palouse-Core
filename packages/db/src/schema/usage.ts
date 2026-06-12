import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users, workspaces } from './identity.js';
import { agentHandoffs } from './handoffs.js';

const baseId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const tsNullable = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const usageSource = pgEnum('usage_source', ['mcp', 'otlp']);
export const priceSource = pgEnum('price_source', [
  'catalog',
  'workspace_override',
  'self_reported',
  'unpriced',
]);

/**
 * Rates captured at ingest so a generation's cost stays reproducible after
 * the catalog moves on. All rates are USD per 1M tokens.
 */
export interface PriceSnapshot {
  inputPerMUsd: string;
  outputPerMUsd: string;
  cacheReadPerMUsd: string | null;
  cacheWritePerMUsd: string | null;
  catalogVersion: string | null;
}

// agent_handoffs IS the trace; steps and generations are its two flat
// children (no recursion — see docs/agent-tasks-and-auditability.md §1a).
export const handoffSteps = pgTable(
  'handoff_steps',
  {
    id: baseId(),
    handoffId: uuid('handoff_id')
      .notNull()
      .references(() => agentHandoffs.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Per-handoff ordering, assigned by the usage service under a handoff row lock.
    seq: integer('seq').notNull(),
    title: text('title').notNull(),
    detailMd: text('detail_md'),
    status: text('status').notNull().default('completed'), // started|completed|failed
    source: usageSource('source').notNull().default('mcp'),
    otelSpanId: text('otel_span_id'),
    startedAt: tsNullable('started_at'),
    endedAt: tsNullable('ended_at'),
    createdAt: ts('created_at'),
  },
  (t) => ({
    handoffSeqUq: uniqueIndex('handoff_steps_handoff_seq_uq').on(t.handoffId, t.seq),
    workspaceIdx: index('handoff_steps_workspace_idx').on(t.workspaceId),
  }),
);

export const modelPrices = pgTable(
  'model_prices',
  {
    id: baseId(),
    provider: text('provider').notNull(),
    model: text('model').notNull(), // canonical id; exact match first
    // Prefix pattern: 'claude-opus-4-8' also matches 'claude-opus-4-8[1m]'.
    matchPattern: text('match_pattern'),
    inputPerMUsd: numeric('input_per_m_usd', { precision: 12, scale: 6 }).notNull(),
    outputPerMUsd: numeric('output_per_m_usd', { precision: 12, scale: 6 }).notNull(),
    cacheReadPerMUsd: numeric('cache_read_per_m_usd', { precision: 12, scale: 6 }),
    cacheWritePerMUsd: numeric('cache_write_per_m_usd', { precision: 12, scale: 6 }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' }).notNull(),
    effectiveTo: tsNullable('effective_to'), // null = current
    catalogVersion: text('catalog_version').notNull(), // stamped into priceSnapshot
    source: text('source').notNull().default('builtin'),
    createdAt: ts('created_at'),
  },
  (t) => ({
    modelEffectiveUq: uniqueIndex('model_prices_model_effective_uq').on(
      t.provider,
      t.model,
      t.effectiveFrom,
    ),
    modelIdx: index('model_prices_model_idx').on(t.model),
  }),
);

export const workspaceModelPrices = pgTable(
  'workspace_model_prices',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider'),
    model: text('model').notNull(),
    inputPerMUsd: numeric('input_per_m_usd', { precision: 12, scale: 6 }).notNull(),
    outputPerMUsd: numeric('output_per_m_usd', { precision: 12, scale: 6 }).notNull(),
    cacheReadPerMUsd: numeric('cache_read_per_m_usd', { precision: 12, scale: 6 }),
    cacheWritePerMUsd: numeric('cache_write_per_m_usd', { precision: 12, scale: 6 }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' }).notNull(),
    effectiveTo: tsNullable('effective_to'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    workspaceModelEffectiveUq: uniqueIndex('workspace_model_prices_effective_uq').on(
      t.workspaceId,
      t.model,
      t.effectiveFrom,
    ),
  }),
);

export const llmGenerations = pgTable(
  'llm_generations',
  {
    id: baseId(),
    handoffId: uuid('handoff_id')
      .notNull()
      .references(() => agentHandoffs.id, { onDelete: 'cascade' }),
    // Denormalized from the handoff so rollups and spend queries skip the join.
    workspaceId: uuid('workspace_id').notNull(),
    agentId: uuid('agent_id').notNull(),
    stepId: uuid('step_id').references(() => handoffSteps.id, { onDelete: 'set null' }),
    source: usageSource('source').notNull(),
    model: text('model').notNull(), // as reported, e.g. 'claude-opus-4-8'
    provider: text('provider'),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    cacheWriteTokens: bigint('cache_write_tokens', { mode: 'number' }).notNull().default(0),
    // Cost snapshot: computed at ingest, reproducible forever. null = unpriced.
    costUsd: numeric('cost_usd', { precision: 14, scale: 8 }),
    // Agent's own claim, stored separately and never trusted as the computed figure.
    selfReportedCostUsd: numeric('self_reported_cost_usd', { precision: 14, scale: 8 }),
    priceSource: priceSource('price_source').notNull().default('unpriced'),
    modelPriceId: uuid('model_price_id').references(() => modelPrices.id, {
      onDelete: 'set null',
    }),
    priceSnapshot: jsonb('price_snapshot').$type<PriceSnapshot>(),
    otelTraceId: text('otel_trace_id'),
    otelSpanId: text('otel_span_id'),
    occurredAt: ts('occurred_at'),
    createdAt: ts('created_at'),
  },
  (t) => ({
    handoffIdx: index('llm_generations_handoff_idx').on(t.handoffId),
    workspaceDayIdx: index('llm_generations_workspace_day_idx').on(t.workspaceId, t.occurredAt),
    // OTLP re-export dedupe; partial so MCP rows (no span id) never collide.
    otlpDedupeUq: uniqueIndex('llm_generations_otel_span_uq')
      .on(t.handoffId, t.otelSpanId)
      .where(sql`otel_span_id IS NOT NULL`),
  }),
);

export const usageRollupsDaily = pgTable(
  'usage_rollups_daily',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id').notNull(),
    agentId: uuid('agent_id').notNull(),
    model: text('model').notNull(),
    day: date('day').notNull(), // UTC day of occurredAt
    generationCount: integer('generation_count').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    cacheWriteTokens: bigint('cache_write_tokens', { mode: 'number' }).notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 16, scale: 8 }).notNull().default('0'),
    unpricedCount: integer('unpriced_count').notNull().default(0),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    rollupUq: uniqueIndex('usage_rollups_daily_uq').on(t.workspaceId, t.agentId, t.model, t.day),
  }),
);

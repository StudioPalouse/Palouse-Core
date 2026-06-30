import { z } from 'zod';
import { uuid } from './ids.js';

export const usageSource = z.enum(['mcp', 'otlp']);
export type UsageSource = z.infer<typeof usageSource>;

export const priceSourceKind = z.enum(['catalog', 'workspace_override', 'self_reported', 'unpriced']);
export type PriceSourceKind = z.infer<typeof priceSourceKind>;

export const stepStatus = z.enum(['started', 'completed', 'failed']);
export type StepStatus = z.infer<typeof stepStatus>;

/**
 * Usage block agents attach to MCP calls. Semantics: each report is an
 * INCREMENT since the previous one — one llm_generations row per report.
 */
export const usageReport = z.object({
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  // Self-reported cost: stored separately, never trusted as the computed figure.
  costUsd: z.number().nonnegative().optional(),
});
export type UsageReport = z.infer<typeof usageReport>;

export const priceSnapshotSchema = z.object({
  inputPerMUsd: z.string(),
  outputPerMUsd: z.string(),
  cacheReadPerMUsd: z.string().nullable(),
  cacheWritePerMUsd: z.string().nullable(),
  catalogVersion: z.string().nullable(),
});
export type PriceSnapshotDto = z.infer<typeof priceSnapshotSchema>;

export const handoffStepSchema = z.object({
  id: uuid,
  handoffId: uuid,
  seq: z.number().int(),
  title: z.string(),
  detailMd: z.string().nullable(),
  status: stepStatus,
  source: usageSource,
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type HandoffStep = z.infer<typeof handoffStepSchema>;

export const llmGenerationSchema = z.object({
  id: uuid,
  handoffId: uuid,
  workspaceId: uuid,
  agentId: uuid,
  stepId: uuid.nullable(),
  source: usageSource,
  model: z.string(),
  provider: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costUsd: z.number().nullable(),
  selfReportedCostUsd: z.number().nullable(),
  priceSource: priceSourceKind,
  priceSnapshot: priceSnapshotSchema.nullable(),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type LlmGeneration = z.infer<typeof llmGenerationSchema>;

/** Aggregate over one handoff's generations — the Activity Report summary. */
export const handoffUsageSummarySchema = z.object({
  generationCount: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  // null when no generation could be priced; "includes unpriced calls" when unpricedCount > 0.
  costUsd: z.number().nullable(),
  unpricedCount: z.number().int(),
  models: z.array(z.string()),
});
export type HandoffUsageSummary = z.infer<typeof handoffUsageSummarySchema>;

/** Plain-English rendering of a handoff; identical across web UI, PDF, CSV. */
export const handoffNarrativeSchema = z.object({
  headline: z.string(),
  sentences: z.array(z.string()),
});
export type HandoffNarrative = z.infer<typeof handoffNarrativeSchema>;

export const usageSummaryQuery = z.object({
  workspaceId: uuid,
  agentId: uuid.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  groupBy: z.enum(['agent', 'model', 'day']).default('day'),
});
export type UsageSummaryQuery = z.infer<typeof usageSummaryQuery>;

export const usageSummaryRowSchema = z.object({
  // Group key: agent id, model name, or ISO day depending on groupBy.
  key: z.string(),
  label: z.string().nullable(), // agent name when groupBy=agent
  generationCount: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costUsd: z.number(),
  unpricedCount: z.number().int(),
});
export type UsageSummaryRow = z.infer<typeof usageSummaryRowSchema>;

export const modelPriceSchema = z.object({
  id: uuid,
  provider: z.string().nullable(),
  model: z.string(),
  matchPattern: z.string().nullable(),
  inputPerMUsd: z.string(),
  outputPerMUsd: z.string(),
  cacheReadPerMUsd: z.string().nullable(),
  cacheWritePerMUsd: z.string().nullable(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  catalogVersion: z.string().nullable(),
  scope: z.enum(['catalog', 'workspace_override']),
});
export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const upsertWorkspacePriceInput = z.object({
  model: z.string().min(1).max(200),
  provider: z.string().min(1).max(100).optional(),
  inputPerMUsd: z.number().nonnegative(),
  outputPerMUsd: z.number().nonnegative(),
  cacheReadPerMUsd: z.number().nonnegative().optional(),
  cacheWritePerMUsd: z.number().nonnegative().optional(),
});
export type UpsertWorkspacePriceInput = z.infer<typeof upsertWorkspacePriceInput>;

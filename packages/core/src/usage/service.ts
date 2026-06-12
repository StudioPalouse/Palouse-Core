import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  auditEvents,
  handoffSteps,
  llmGenerations,
  modelPrices,
  workspaceModelPrices,
  type Database,
} from '@reqops/db';
import {
  conflict,
  type HandoffStep,
  type HandoffUsageSummary,
  type LlmGeneration,
  type StepStatus,
  type UsageReport,
  type UsageSummaryQuery,
  type UsageSummaryRow,
  type UsageSource,
} from '@reqops/shared';
import { computeCostUsd, resolvePrice } from './pricing.js';

type StepRow = typeof handoffSteps.$inferSelect;
type GenerationRow = typeof llmGenerations.$inferSelect;

export function stepToDto(row: StepRow): HandoffStep {
  return {
    id: row.id,
    handoffId: row.handoffId,
    seq: row.seq,
    title: row.title,
    detailMd: row.detailMd,
    status: row.status as StepStatus,
    source: row.source,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function generationToDto(row: GenerationRow): LlmGeneration {
  return {
    id: row.id,
    handoffId: row.handoffId,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    stepId: row.stepId,
    source: row.source,
    model: row.model,
    provider: row.provider,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
    selfReportedCostUsd: row.selfReportedCostUsd === null ? null : Number(row.selfReportedCostUsd),
    priceSource: row.priceSource,
    priceSnapshot: row.priceSnapshot,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

interface ClaimedHandoffRef {
  handoffId: string;
  workspaceId: string;
  agentId: string;
}

/** Generations/steps may only be reported against a live claim. */
async function requireActiveClaim(db: Database, claimToken: string): Promise<ClaimedHandoffRef> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id, workspace_id, actor_agent_id FROM agent_handoffs
    WHERE claim_token = ${claimToken} AND state IN ('claimed', 'in_progress')
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw conflict('No active handoff for this claim token');
  return {
    handoffId: row.id as string,
    workspaceId: row.workspace_id as string,
    agentId: row.actor_agent_id as string,
  };
}

export interface RecordGenerationInput extends ClaimedHandoffRef {
  usage: UsageReport;
  source?: UsageSource;
  stepId?: string | null;
  otelTraceId?: string | null;
  otelSpanId?: string | null;
  occurredAt?: Date;
}

/**
 * Insert one generation row and increment the daily rollup in the same
 * transaction, so dashboards are always consistent with the ledger.
 */
export async function recordGeneration(
  db: Database,
  input: RecordGenerationInput,
): Promise<LlmGeneration> {
  return db.transaction(async (tx) => recordGenerationTx(tx as unknown as Database, input));
}

async function recordGenerationTx(
  tx: Database,
  input: RecordGenerationInput,
): Promise<LlmGeneration> {
  const occurredAt = input.occurredAt ?? new Date();
  const usage = input.usage;
  const resolved = await resolvePrice(tx, input.workspaceId, usage.model, occurredAt);
  const costUsd = resolved ? computeCostUsd(usage, resolved.snapshot) : null;

  const [row] = await tx
    .insert(llmGenerations)
    .values({
      handoffId: input.handoffId,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      stepId: input.stepId ?? null,
      source: input.source ?? 'mcp',
      model: usage.model,
      provider: resolved?.provider ?? null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      costUsd,
      selfReportedCostUsd: usage.costUsd === undefined ? null : usage.costUsd.toFixed(8),
      priceSource: resolved?.priceSource ?? 'unpriced',
      modelPriceId: resolved?.modelPriceId ?? null,
      priceSnapshot: resolved?.snapshot ?? null,
      otelTraceId: input.otelTraceId ?? null,
      otelSpanId: input.otelSpanId ?? null,
      occurredAt,
    })
    .returning();

  const day = occurredAt.toISOString().slice(0, 10); // UTC day, matches rebuildRollups
  await tx.execute(sql`
    INSERT INTO usage_rollups_daily (
      workspace_id, agent_id, model, day, generation_count,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cost_usd, unpriced_count
    ) VALUES (
      ${input.workspaceId}, ${input.agentId}, ${usage.model}, ${day}, 1,
      ${usage.inputTokens}, ${usage.outputTokens},
      ${usage.cacheReadTokens ?? 0}, ${usage.cacheWriteTokens ?? 0},
      ${costUsd ?? '0'}, ${costUsd === null ? 1 : 0}
    )
    ON CONFLICT (workspace_id, agent_id, model, day) DO UPDATE SET
      generation_count = usage_rollups_daily.generation_count + 1,
      input_tokens = usage_rollups_daily.input_tokens + EXCLUDED.input_tokens,
      output_tokens = usage_rollups_daily.output_tokens + EXCLUDED.output_tokens,
      cache_read_tokens = usage_rollups_daily.cache_read_tokens + EXCLUDED.cache_read_tokens,
      cache_write_tokens = usage_rollups_daily.cache_write_tokens + EXCLUDED.cache_write_tokens,
      cost_usd = usage_rollups_daily.cost_usd + EXCLUDED.cost_usd,
      unpriced_count = usage_rollups_daily.unpriced_count + EXCLUDED.unpriced_count,
      updated_at = now()
  `);

  return generationToDto(row!);
}

/** report_usage MCP tool: one generation per call, optionally creating/linking a step. */
export async function reportUsage(
  db: Database,
  claimToken: string,
  usage: UsageReport,
  stepTitle?: string,
): Promise<{ generation: LlmGeneration; step: HandoffStep | null }> {
  const ref = await requireActiveClaim(db, claimToken);
  if (!stepTitle) {
    const generation = await recordGeneration(db, { ...ref, usage });
    return { generation, step: null };
  }
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Database;
    const step = await insertStepTx(tx, ref, { title: stepTitle, status: 'completed' });
    const generation = await recordGenerationTx(tx, { ...ref, usage, stepId: step.id });
    return { generation, step };
  });
}

export interface RecordStepInput {
  title: string;
  detailMd?: string;
  status?: StepStatus;
  usage?: UsageReport;
}

/** log_step MCP tool: append one narrative step (and optionally its usage). */
export async function recordStep(
  db: Database,
  claimToken: string,
  input: RecordStepInput,
): Promise<{ step: HandoffStep; generation: LlmGeneration | null }> {
  const ref = await requireActiveClaim(db, claimToken);
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Database;
    const step = await insertStepTx(tx, ref, input);
    const generation = input.usage
      ? await recordGenerationTx(tx, { ...ref, usage: input.usage, stepId: step.id })
      : null;
    return { step, generation };
  });
}

async function insertStepTx(
  tx: Database,
  ref: ClaimedHandoffRef,
  input: Omit<RecordStepInput, 'usage'>,
): Promise<HandoffStep> {
  // Serialize seq assignment per handoff: concurrent log_step calls queue on
  // the handoff row lock instead of colliding on (handoff_id, seq).
  await tx.execute(sql`SELECT id FROM agent_handoffs WHERE id = ${ref.handoffId} FOR UPDATE`);
  const rows = await tx.execute<Record<string, unknown>>(sql`
    INSERT INTO handoff_steps (handoff_id, workspace_id, seq, title, detail_md, status, source)
    SELECT ${ref.handoffId}, ${ref.workspaceId},
           coalesce(max(seq), 0) + 1, ${input.title}, ${input.detailMd ?? null},
           ${input.status ?? 'completed'}, 'mcp'
    FROM handoff_steps WHERE handoff_id = ${ref.handoffId}
    RETURNING *
  `);
  const raw = rows[0]!;
  return {
    id: raw.id as string,
    handoffId: raw.handoff_id as string,
    seq: Number(raw.seq),
    title: raw.title as string,
    detailMd: (raw.detail_md as string | null) ?? null,
    status: raw.status as StepStatus,
    source: raw.source as UsageSource,
    startedAt: null,
    endedAt: null,
    createdAt: toIso(raw.created_at),
  };
}

function toIso(v: unknown): string {
  return (v instanceof Date ? v : new Date(v as string)).toISOString();
}

/** Steps + generations + aggregate for one handoff — the Activity Report payload. */
export async function getHandoffUsage(
  db: Database,
  workspaceId: string,
  handoffId: string,
): Promise<{ steps: HandoffStep[]; generations: LlmGeneration[]; summary: HandoffUsageSummary }> {
  const [steps, generations] = await Promise.all([
    db
      .select()
      .from(handoffSteps)
      .where(and(eq(handoffSteps.handoffId, handoffId), eq(handoffSteps.workspaceId, workspaceId)))
      .orderBy(asc(handoffSteps.seq)),
    db
      .select()
      .from(llmGenerations)
      .where(
        and(eq(llmGenerations.handoffId, handoffId), eq(llmGenerations.workspaceId, workspaceId)),
      )
      .orderBy(asc(llmGenerations.occurredAt)),
  ]);
  return {
    steps: steps.map(stepToDto),
    generations: generations.map(generationToDto),
    summary: summarize(generations),
  };
}

export function summarize(generations: GenerationRow[]): HandoffUsageSummary {
  const summary: HandoffUsageSummary = {
    generationCount: generations.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    unpricedCount: 0,
    models: [],
  };
  const models = new Set<string>();
  let cost = 0;
  let priced = false;
  for (const g of generations) {
    summary.inputTokens += g.inputTokens;
    summary.outputTokens += g.outputTokens;
    summary.cacheReadTokens += g.cacheReadTokens;
    summary.cacheWriteTokens += g.cacheWriteTokens;
    if (g.costUsd === null) summary.unpricedCount += 1;
    else {
      cost += Number(g.costUsd);
      priced = true;
    }
    models.add(g.model);
  }
  summary.costUsd = priced ? cost : null;
  summary.models = [...models];
  return summary;
}

/** Spend dashboard query, served from the always-fresh daily rollups. */
export async function getWorkspaceSpend(
  db: Database,
  query: UsageSummaryQuery,
): Promise<{ rows: UsageSummaryRow[]; totalCostUsd: number }> {
  const conditions = [sql`r.workspace_id = ${query.workspaceId}`];
  if (query.from) conditions.push(sql`r.day >= ${query.from.toISOString().slice(0, 10)}`);
  if (query.to) conditions.push(sql`r.day <= ${query.to.toISOString().slice(0, 10)}`);
  const where = sql.join(conditions, sql` AND `);

  const keyExpr =
    query.groupBy === 'agent'
      ? sql`r.agent_id::text`
      : query.groupBy === 'model'
        ? sql`r.model`
        : sql`r.day::text`;
  const labelExpr = query.groupBy === 'agent' ? sql`max(a.name)` : sql`NULL`;

  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT ${keyExpr} AS key, ${labelExpr} AS label,
           sum(r.generation_count)::int AS generation_count,
           sum(r.input_tokens)::bigint AS input_tokens,
           sum(r.output_tokens)::bigint AS output_tokens,
           sum(r.cache_read_tokens)::bigint AS cache_read_tokens,
           sum(r.cache_write_tokens)::bigint AS cache_write_tokens,
           sum(r.cost_usd) AS cost_usd,
           sum(r.unpriced_count)::int AS unpriced_count
    FROM usage_rollups_daily r
    LEFT JOIN agents a ON a.id = r.agent_id
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1
  `);

  const mapped: UsageSummaryRow[] = rows.map((r) => ({
    key: r.key as string,
    label: (r.label as string | null) ?? null,
    generationCount: Number(r.generation_count),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    cacheReadTokens: Number(r.cache_read_tokens),
    cacheWriteTokens: Number(r.cache_write_tokens),
    costUsd: Number(r.cost_usd),
    unpricedCount: Number(r.unpriced_count),
  }));
  return { rows: mapped, totalCostUsd: mapped.reduce((acc, r) => acc + r.costUsd, 0) };
}

/**
 * Escape hatch: truncate and re-aggregate rollups from the generation
 * ledger. Must reproduce ingest-time totals exactly (verified in tests).
 */
export async function rebuildRollups(db: Database, workspaceId?: string): Promise<number> {
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Database;
    const scope = workspaceId ? sql`WHERE workspace_id = ${workspaceId}` : sql``;
    await tx.execute(sql`DELETE FROM usage_rollups_daily ${scope}`);
    const rows = await tx.execute(sql`
      INSERT INTO usage_rollups_daily (
        workspace_id, agent_id, model, day, generation_count,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_usd, unpriced_count
      )
      SELECT workspace_id, agent_id, model, (occurred_at AT TIME ZONE 'UTC')::date,
             count(*)::int,
             sum(input_tokens), sum(output_tokens),
             sum(cache_read_tokens), sum(cache_write_tokens),
             coalesce(sum(cost_usd), 0),
             count(*) FILTER (WHERE cost_usd IS NULL)::int
      FROM llm_generations
      ${scope}
      GROUP BY 1, 2, 3, 4
      RETURNING id
    `);
    return rows.length;
  });
}

/** Latest-effective catalog rows merged with this workspace's overrides. */
export async function listModelPrices(db: Database, workspaceId: string) {
  const [catalogRows, overrideRows] = await Promise.all([
    db
      .select()
      .from(modelPrices)
      .where(isNull(modelPrices.effectiveTo))
      .orderBy(asc(modelPrices.model)),
    db
      .select()
      .from(workspaceModelPrices)
      .where(
        and(
          eq(workspaceModelPrices.workspaceId, workspaceId),
          isNull(workspaceModelPrices.effectiveTo),
        ),
      )
      .orderBy(desc(workspaceModelPrices.effectiveFrom)),
  ]);

  return {
    prices: [
      ...overrideRows.map((r) => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        matchPattern: null,
        inputPerMUsd: r.inputPerMUsd,
        outputPerMUsd: r.outputPerMUsd,
        cacheReadPerMUsd: r.cacheReadPerMUsd,
        cacheWritePerMUsd: r.cacheWritePerMUsd,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: null,
        catalogVersion: null,
        scope: 'workspace_override' as const,
      })),
      ...catalogRows.map((r) => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        matchPattern: r.matchPattern,
        inputPerMUsd: r.inputPerMUsd,
        outputPerMUsd: r.outputPerMUsd,
        cacheReadPerMUsd: r.cacheReadPerMUsd,
        cacheWritePerMUsd: r.cacheWritePerMUsd,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo?.toISOString() ?? null,
        catalogVersion: r.catalogVersion,
        scope: 'catalog' as const,
      })),
    ],
  };
}

/** Admin override upsert: closes the previous override row, inserts the new one. */
export async function upsertWorkspacePrice(
  db: Database,
  workspaceId: string,
  userId: string,
  input: {
    model: string;
    provider?: string;
    inputPerMUsd: number;
    outputPerMUsd: number;
    cacheReadPerMUsd?: number;
    cacheWritePerMUsd?: number;
  },
) {
  const now = new Date();
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Database;
    await tx
      .update(workspaceModelPrices)
      .set({ effectiveTo: now })
      .where(
        and(
          eq(workspaceModelPrices.workspaceId, workspaceId),
          eq(workspaceModelPrices.model, input.model),
          isNull(workspaceModelPrices.effectiveTo),
        ),
      );
    const [row] = await tx
      .insert(workspaceModelPrices)
      .values({
        workspaceId,
        provider: input.provider ?? null,
        model: input.model,
        inputPerMUsd: input.inputPerMUsd.toFixed(6),
        outputPerMUsd: input.outputPerMUsd.toFixed(6),
        cacheReadPerMUsd: input.cacheReadPerMUsd?.toFixed(6) ?? null,
        cacheWritePerMUsd: input.cacheWritePerMUsd?.toFixed(6) ?? null,
        effectiveFrom: now,
        createdByUserId: userId,
      })
      .returning();
    await tx.insert(auditEvents).values({
      workspaceId,
      actorType: 'user',
      actorId: userId,
      action: 'usage.price_override_set',
      targetType: 'workspace_model_price',
      targetId: row!.id,
      payload: { model: input.model },
    });
    return row!;
  });
}

/** Handoff that owns this claim token, for lifecycle tools that carry usage. */
export async function refForClaim(db: Database, claimToken: string): Promise<ClaimedHandoffRef> {
  return requireActiveClaim(db, claimToken);
}

import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { modelPrices, workspaceModelPrices, type Database, type PriceSnapshot } from '@palouse/db';
import type { UsageReport } from '@palouse/shared';

export interface ResolvedPrice {
  priceSource: 'workspace_override' | 'catalog';
  /** Catalog row that priced this generation; null for workspace overrides. */
  modelPriceId: string | null;
  provider: string | null;
  snapshot: PriceSnapshot;
}

/**
 * Resolution order (docs/agent-tasks-and-auditability.md §2c):
 *   1. workspace override (effective-dated)            → 'workspace_override'
 *   2. catalog exact model match (effective-dated)     → 'catalog'
 *   3. catalog prefix pattern, longest pattern wins    → 'catalog'
 *   4. none                                            → null (unpriced)
 */
export async function resolvePrice(
  db: Database,
  workspaceId: string,
  model: string,
  occurredAt: Date,
): Promise<ResolvedPrice | null> {
  const effectiveOverride = and(
    lte(workspaceModelPrices.effectiveFrom, occurredAt),
    or(isNull(workspaceModelPrices.effectiveTo), gt(workspaceModelPrices.effectiveTo, occurredAt)),
  );
  const [override] = await db
    .select()
    .from(workspaceModelPrices)
    .where(
      and(
        eq(workspaceModelPrices.workspaceId, workspaceId),
        eq(workspaceModelPrices.model, model),
        effectiveOverride,
      ),
    )
    .orderBy(desc(workspaceModelPrices.effectiveFrom))
    .limit(1);
  if (override) {
    return {
      priceSource: 'workspace_override',
      modelPriceId: null,
      provider: override.provider,
      snapshot: {
        inputPerMUsd: override.inputPerMUsd,
        outputPerMUsd: override.outputPerMUsd,
        cacheReadPerMUsd: override.cacheReadPerMUsd,
        cacheWritePerMUsd: override.cacheWritePerMUsd,
        catalogVersion: null,
      },
    };
  }

  const effectiveCatalog = and(
    lte(modelPrices.effectiveFrom, occurredAt),
    or(isNull(modelPrices.effectiveTo), gt(modelPrices.effectiveTo, occurredAt)),
  );
  const [exact] = await db
    .select()
    .from(modelPrices)
    .where(and(eq(modelPrices.model, model), effectiveCatalog))
    .orderBy(desc(modelPrices.effectiveFrom))
    .limit(1);
  if (exact) return catalogPrice(exact);

  const [pattern] = await db
    .select()
    .from(modelPrices)
    .where(
      and(
        sql`${modelPrices.matchPattern} IS NOT NULL`,
        sql`${model} LIKE ${modelPrices.matchPattern} || '%'`,
        effectiveCatalog,
      ),
    )
    .orderBy(desc(sql`length(${modelPrices.matchPattern})`), desc(modelPrices.effectiveFrom))
    .limit(1);
  if (pattern) return catalogPrice(pattern);

  return null;
}

function catalogPrice(row: typeof modelPrices.$inferSelect): ResolvedPrice {
  return {
    priceSource: 'catalog',
    modelPriceId: row.id,
    provider: row.provider,
    snapshot: {
      inputPerMUsd: row.inputPerMUsd,
      outputPerMUsd: row.outputPerMUsd,
      cacheReadPerMUsd: row.cacheReadPerMUsd,
      cacheWritePerMUsd: row.cacheWritePerMUsd,
      catalogVersion: row.catalogVersion,
    },
  };
}

/**
 * costUsd = (input·inputPerM + output·outputPerM + cacheRead·cacheReadPerM
 *            + cacheWrite·cacheWritePerM) / 1_000_000
 * Returned as a fixed 8-decimal string for the numeric(14,8) column.
 */
export function computeCostUsd(usage: UsageReport, snapshot: PriceSnapshot): string {
  const total =
    usage.inputTokens * Number(snapshot.inputPerMUsd) +
    usage.outputTokens * Number(snapshot.outputPerMUsd) +
    (usage.cacheReadTokens ?? 0) * Number(snapshot.cacheReadPerMUsd ?? 0) +
    (usage.cacheWriteTokens ?? 0) * Number(snapshot.cacheWritePerMUsd ?? 0);
  return (total / 1_000_000).toFixed(8);
}

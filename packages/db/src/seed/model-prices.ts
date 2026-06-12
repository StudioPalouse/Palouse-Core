import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../index.js';
import { modelPrices } from '../schema/usage.js';

/**
 * Built-in model price catalog, USD per 1M tokens. Re-seeding a newer
 * catalog version closes superseded rows (effective_to = now()) instead of
 * mutating them — the catalog itself stays auditable, and existing
 * price snapshots keep pointing at the rows that priced them.
 *
 * Anthropic rates per docs/agent-tasks-and-auditability.md §1b
 * (cache read = 0.1× input; 5m cache write = 1.25× input).
 * Other providers (OpenAI/Google/Mistral) are deliberately not seeded yet:
 * their prices must be verified against the provider pricing pages at the
 * time they're added. Unknown models stay visible as "Unpriced".
 */
export const CATALOG_VERSION = '2026-06-12.1';

export interface CatalogEntry {
  provider: string;
  model: string;
  /** Prefix matcher so dated/suffixed ids ('claude-fable-5[1m]') resolve. */
  matchPattern: string | null;
  inputPerMUsd: string;
  outputPerMUsd: string;
  cacheReadPerMUsd: string | null;
  cacheWritePerMUsd: string | null;
}

const anthropic = (
  model: string,
  input: string,
  output: string,
  cacheRead: string,
  cacheWrite: string,
): CatalogEntry => ({
  provider: 'anthropic',
  model,
  matchPattern: model,
  inputPerMUsd: input,
  outputPerMUsd: output,
  cacheReadPerMUsd: cacheRead,
  cacheWritePerMUsd: cacheWrite,
});

export const MODEL_PRICE_CATALOG: CatalogEntry[] = [
  anthropic('claude-fable-5', '10', '50', '1', '12.5'),
  anthropic('claude-opus-4-8', '5', '25', '0.5', '6.25'),
  anthropic('claude-opus-4-7', '5', '25', '0.5', '6.25'),
  anthropic('claude-opus-4-6', '5', '25', '0.5', '6.25'),
  anthropic('claude-sonnet-4-6', '3', '15', '0.3', '3.75'),
  anthropic('claude-haiku-4-5', '1', '5', '0.1', '1.25'),
];

export interface SeedModelPricesResult {
  inserted: number;
  superseded: number;
  unchanged: number;
}

function ratesEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Number(a) === Number(b);
}

/** Idempotent: unchanged entries are skipped; changed ones are versioned, not mutated. */
export async function seedModelPrices(
  db: Database,
  now: Date = new Date(),
): Promise<SeedModelPricesResult> {
  const result: SeedModelPricesResult = { inserted: 0, superseded: 0, unchanged: 0 };

  for (const entry of MODEL_PRICE_CATALOG) {
    const [current] = await db
      .select()
      .from(modelPrices)
      .where(
        and(
          eq(modelPrices.provider, entry.provider),
          eq(modelPrices.model, entry.model),
          isNull(modelPrices.effectiveTo),
        ),
      )
      .limit(1);

    if (
      current &&
      ratesEqual(current.inputPerMUsd, entry.inputPerMUsd) &&
      ratesEqual(current.outputPerMUsd, entry.outputPerMUsd) &&
      ratesEqual(current.cacheReadPerMUsd, entry.cacheReadPerMUsd) &&
      ratesEqual(current.cacheWritePerMUsd, entry.cacheWritePerMUsd) &&
      current.matchPattern === entry.matchPattern
    ) {
      result.unchanged += 1;
      continue;
    }

    if (current) {
      await db
        .update(modelPrices)
        .set({ effectiveTo: now })
        .where(eq(modelPrices.id, current.id));
      result.superseded += 1;
    }

    await db.insert(modelPrices).values({
      provider: entry.provider,
      model: entry.model,
      matchPattern: entry.matchPattern,
      inputPerMUsd: entry.inputPerMUsd,
      outputPerMUsd: entry.outputPerMUsd,
      cacheReadPerMUsd: entry.cacheReadPerMUsd,
      cacheWritePerMUsd: entry.cacheWritePerMUsd,
      effectiveFrom: now,
      catalogVersion: CATALOG_VERSION,
      source: 'builtin',
    });
    result.inserted += 1;
  }

  return result;
}

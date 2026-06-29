import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agents,
  closeDb,
  getDb,
  llmGenerations,
  modelPrices,
  organizations,
  seedModelPrices,
  tasks,
  usageRollupsDaily,
  users,
  workspaceModelPrices,
  workspaces,
  type Database,
} from '@palouse/db';
import type { UsageReport } from '@palouse/shared';
import { claimNext, complete, createHandoff } from '../handoffs/state-machine.js';
import { computeCostUsd, resolvePrice } from './pricing.js';
import {
  getHandoffUsage,
  rebuildRollups,
  recordStep,
  reportUsage,
} from './service.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

let container: StartedPostgreSqlContainer;
let db: Database;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = getDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  await seedModelPrices(db);
}, 120_000);

afterAll(async () => {
  await closeDb();
  await container?.stop();
});

interface SeedContext {
  workspaceId: string;
  userId: string;
  agentId: string;
}

async function seed(): Promise<SeedContext> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organizations)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ organizationId: org!.id, name: `WS ${suffix}`, slug: `ws-${suffix}` })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ email: `user-${suffix}@example.com`, name: 'Test User' })
    .returning();
  const [agent] = await db
    .insert(agents)
    .values({ workspaceId: ws!.id, name: `agent-${suffix}` })
    .returning();
  return { workspaceId: ws!.id, userId: user!.id, agentId: agent!.id };
}

/** Queue + claim a handoff so usage can be reported against a live claim token. */
async function claimedHandoff(ctx: SeedContext) {
  const [task] = await db
    .insert(tasks)
    .values({ workspaceId: ctx.workspaceId, title: 'Usage test task' })
    .returning();
  await createHandoff(db, ctx.workspaceId, ctx.userId, task!.id, {
    agentId: ctx.agentId,
    reviewRequired: false,
    deadlineMinutes: 30,
  });
  const claimed = await claimNext(db, ctx.agentId, ctx.workspaceId);
  return { handoffId: claimed!.handoff.id, claimToken: claimed!.claimToken };
}

const FABLE_USAGE: UsageReport = {
  model: 'claude-fable-5',
  inputTokens: 412_031,
  outputTokens: 18_220,
  cacheReadTokens: 100_000,
  cacheWriteTokens: 50_000,
};
// Hand-computed against the seeded fable rates (10 / 50 / 1 / 12.5 per 1M):
// 4.12031 + 0.911 + 0.1 + 0.625 = 5.75631
const FABLE_COST = '5.75631000';

async function getRollups(ctx: SeedContext) {
  return db
    .select()
    .from(usageRollupsDaily)
    .where(eq(usageRollupsDaily.workspaceId, ctx.workspaceId))
    .orderBy(usageRollupsDaily.model, usageRollupsDaily.day);
}

describe('resolvePrice', () => {
  it('resolves an exact catalog match', async () => {
    const ctx = await seed();
    const resolved = await resolvePrice(db, ctx.workspaceId, 'claude-sonnet-4-6', new Date());
    expect(resolved).not.toBeNull();
    expect(resolved!.priceSource).toBe('catalog');
    expect(Number(resolved!.snapshot.inputPerMUsd)).toBe(3);
    expect(Number(resolved!.snapshot.outputPerMUsd)).toBe(15);
    expect(resolved!.snapshot.catalogVersion).toBeTruthy();
    expect(resolved!.modelPriceId).toBeTruthy();
  });

  it('falls back to the longest prefix pattern for suffixed model ids', async () => {
    const ctx = await seed();
    // '[1m]' long-context variant has no exact catalog row.
    const resolved = await resolvePrice(db, ctx.workspaceId, 'claude-fable-5[1m]', new Date());
    expect(resolved).not.toBeNull();
    expect(resolved!.priceSource).toBe('catalog');
    expect(Number(resolved!.snapshot.inputPerMUsd)).toBe(10);
  });

  it('prefers the longest matching pattern when several match', async () => {
    const ctx = await seed();
    const now = new Date();
    await db.insert(modelPrices).values({
      provider: 'testco',
      model: 'test-model',
      matchPattern: 'test-',
      inputPerMUsd: '1',
      outputPerMUsd: '2',
      effectiveFrom: new Date(now.getTime() - 1000),
      catalogVersion: 'test.1',
    });
    await db.insert(modelPrices).values({
      provider: 'testco',
      model: 'test-model-pro',
      matchPattern: 'test-model-pro',
      inputPerMUsd: '7',
      outputPerMUsd: '9',
      effectiveFrom: new Date(now.getTime() - 1000),
      catalogVersion: 'test.1',
    });
    const resolved = await resolvePrice(db, ctx.workspaceId, 'test-model-pro-20260601', now);
    expect(Number(resolved!.snapshot.inputPerMUsd)).toBe(7);
  });

  it('lets a workspace override beat the catalog', async () => {
    const ctx = await seed();
    await db.insert(workspaceModelPrices).values({
      workspaceId: ctx.workspaceId,
      model: 'claude-sonnet-4-6',
      inputPerMUsd: '1.5',
      outputPerMUsd: '7.5',
      effectiveFrom: new Date(Date.now() - 1000),
    });
    const resolved = await resolvePrice(db, ctx.workspaceId, 'claude-sonnet-4-6', new Date());
    expect(resolved!.priceSource).toBe('workspace_override');
    expect(resolved!.modelPriceId).toBeNull();
    expect(Number(resolved!.snapshot.inputPerMUsd)).toBe(1.5);

    // Other workspaces still get the catalog rate.
    const other = await seed();
    const fromCatalog = await resolvePrice(db, other.workspaceId, 'claude-sonnet-4-6', new Date());
    expect(fromCatalog!.priceSource).toBe('catalog');
  });

  it('honours effective dating: an occurredAt inside the old window uses the old price', async () => {
    const ctx = await seed();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-03-01T00:00:00Z');
    await db.insert(modelPrices).values({
      provider: 'testco',
      model: 'dated-model',
      inputPerMUsd: '100',
      outputPerMUsd: '200',
      effectiveFrom: t0,
      effectiveTo: t1,
      catalogVersion: 'old.1',
    });
    await db.insert(modelPrices).values({
      provider: 'testco',
      model: 'dated-model',
      inputPerMUsd: '50',
      outputPerMUsd: '100',
      effectiveFrom: t1,
      catalogVersion: 'new.1',
    });

    const old = await resolvePrice(db, ctx.workspaceId, 'dated-model', new Date('2026-02-01'));
    expect(Number(old!.snapshot.inputPerMUsd)).toBe(100);
    expect(old!.snapshot.catalogVersion).toBe('old.1');

    const current = await resolvePrice(db, ctx.workspaceId, 'dated-model', new Date('2026-04-01'));
    expect(Number(current!.snapshot.inputPerMUsd)).toBe(50);
    expect(current!.snapshot.catalogVersion).toBe('new.1');
  });

  it('returns null for unknown models', async () => {
    const ctx = await seed();
    expect(await resolvePrice(db, ctx.workspaceId, 'mystery-llm-9000', new Date())).toBeNull();
  });
});

describe('computeCostUsd', () => {
  it('matches the hand-computed figure', () => {
    expect(
      computeCostUsd(FABLE_USAGE, {
        inputPerMUsd: '10',
        outputPerMUsd: '50',
        cacheReadPerMUsd: '1',
        cacheWritePerMUsd: '12.5',
        catalogVersion: 'x',
      }),
    ).toBe(FABLE_COST);
  });

  it('treats missing cache rates as zero', () => {
    expect(
      computeCostUsd(
        { model: 'm', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 5_000_000 },
        { inputPerMUsd: '2', outputPerMUsd: '4', cacheReadPerMUsd: null, cacheWritePerMUsd: null, catalogVersion: null },
      ),
    ).toBe('2.00000000');
  });
});

describe('reportUsage', () => {
  it('writes a generation with a price snapshot and increments the rollup in one step', async () => {
    const ctx = await seed();
    const { handoffId, claimToken } = await claimedHandoff(ctx);

    const { generation } = await reportUsage(db, claimToken, {
      ...FABLE_USAGE,
      costUsd: 9.99, // self-reported; must not overwrite the computed figure
    });

    expect(generation.handoffId).toBe(handoffId);
    expect(generation.priceSource).toBe('catalog');
    expect(generation.costUsd).toBeCloseTo(5.75631, 8);
    expect(generation.selfReportedCostUsd).toBeCloseTo(9.99, 8);
    expect(generation.priceSnapshot).not.toBeNull();
    expect(Number(generation.priceSnapshot!.inputPerMUsd)).toBe(10);

    const rollups = await getRollups(ctx);
    expect(rollups).toHaveLength(1);
    expect(rollups[0]!.generationCount).toBe(1);
    expect(rollups[0]!.inputTokens).toBe(412_031);
    expect(rollups[0]!.outputTokens).toBe(18_220);
    expect(Number(rollups[0]!.costUsd)).toBeCloseTo(5.75631, 8);
    expect(rollups[0]!.unpricedCount).toBe(0);
  });

  it('accumulates the same-day rollup across reports and counts unpriced calls', async () => {
    const ctx = await seed();
    const { claimToken } = await claimedHandoff(ctx);

    await reportUsage(db, claimToken, FABLE_USAGE);
    await reportUsage(db, claimToken, FABLE_USAGE);
    const { generation: unpriced } = await reportUsage(db, claimToken, {
      model: 'mystery-llm-9000',
      inputTokens: 10,
      outputTokens: 5,
    });

    expect(unpriced.costUsd).toBeNull();
    expect(unpriced.priceSource).toBe('unpriced');

    const rollups = await getRollups(ctx);
    const fable = rollups.find((r) => r.model === 'claude-fable-5')!;
    expect(fable.generationCount).toBe(2);
    expect(fable.inputTokens).toBe(2 * 412_031);
    expect(Number(fable.costUsd)).toBeCloseTo(2 * 5.75631, 6);
    const mystery = rollups.find((r) => r.model === 'mystery-llm-9000')!;
    expect(mystery.unpricedCount).toBe(1);
    expect(Number(mystery.costUsd)).toBe(0);
  });

  it('rejects an unknown claim token', async () => {
    await expect(reportUsage(db, crypto.randomUUID(), FABLE_USAGE)).rejects.toThrow(
      'No active handoff for this claim token',
    );
  });

  it('creates and links a step when stepTitle is given', async () => {
    const ctx = await seed();
    const { claimToken } = await claimedHandoff(ctx);
    const { generation, step } = await reportUsage(db, claimToken, FABLE_USAGE, 'Drafted the report');
    expect(step).not.toBeNull();
    expect(step!.title).toBe('Drafted the report');
    expect(generation.stepId).toBe(step!.id);
  });
});

describe('recordStep', () => {
  it('assigns gapless per-handoff sequence numbers, even under concurrency', async () => {
    const ctx = await seed();
    const { claimToken } = await claimedHandoff(ctx);

    await recordStep(db, claimToken, { title: 'Read the task' });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        recordStep(db, claimToken, { title: `Concurrent step ${i}` }),
      ),
    );
    const seqs = [1, ...results.map((r) => r.step.seq)].sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('records the attached usage against the step', async () => {
    const ctx = await seed();
    const { handoffId, claimToken } = await claimedHandoff(ctx);
    const { step, generation } = await recordStep(db, claimToken, {
      title: 'Summarised the thread',
      usage: FABLE_USAGE,
    });
    expect(generation).not.toBeNull();
    expect(generation!.stepId).toBe(step.id);

    const usage = await getHandoffUsage(db, ctx.workspaceId, handoffId);
    expect(usage.steps).toHaveLength(1);
    expect(usage.generations).toHaveLength(1);
    expect(usage.summary.costUsd).toBeCloseTo(5.75631, 6);
    expect(usage.summary.models).toEqual(['claude-fable-5']);
  });
});

describe('lifecycle usage', () => {
  it('complete_task with a usage block records a final generation', async () => {
    const ctx = await seed();
    const { handoffId, claimToken } = await claimedHandoff(ctx);
    await complete(db, claimToken, 'All done.', FABLE_USAGE);

    const rows = await db
      .select()
      .from(llmGenerations)
      .where(eq(llmGenerations.handoffId, handoffId));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.costUsd)).toBeCloseTo(5.75631, 6);
  });
});

describe('rebuildRollups', () => {
  it('reproduces identical totals from the generation ledger', async () => {
    const ctx = await seed();
    const { claimToken } = await claimedHandoff(ctx);
    await reportUsage(db, claimToken, FABLE_USAGE);
    await reportUsage(db, claimToken, { model: 'claude-haiku-4-5', inputTokens: 1000, outputTokens: 200 });
    await reportUsage(db, claimToken, { model: 'mystery-llm-9000', inputTokens: 7, outputTokens: 3 });
    // Spread one generation onto another UTC day to exercise day bucketing.
    await db.execute(sql`
      UPDATE llm_generations SET occurred_at = occurred_at - interval '2 days'
      WHERE workspace_id = ${ctx.workspaceId} AND model = 'claude-haiku-4-5'
    `);
    await rebuildRollups(db, ctx.workspaceId);
    const before = (await getRollups(ctx)).map(({ id, updatedAt, ...rest }) => rest);

    await rebuildRollups(db, ctx.workspaceId);
    const after = (await getRollups(ctx)).map(({ id, updatedAt, ...rest }) => rest);
    expect(after).toEqual(before);

    // And the rebuild agrees with what incremental ingest accumulated.
    const fable = after.find((r) => r.model === 'claude-fable-5')!;
    expect(fable.generationCount).toBe(1);
    expect(Number(fable.costUsd)).toBeCloseTo(5.75631, 6);
    const mystery = after.find((r) => r.model === 'mystery-llm-9000')!;
    expect(mystery.unpricedCount).toBe(1);
  });

  it('only touches the given workspace', async () => {
    const ctxA = await seed();
    const ctxB = await seed();
    const a = await claimedHandoff(ctxA);
    const b = await claimedHandoff(ctxB);
    await reportUsage(db, a.claimToken, FABLE_USAGE);
    await reportUsage(db, b.claimToken, FABLE_USAGE);

    await rebuildRollups(db, ctxA.workspaceId);
    expect(await getRollups(ctxA)).toHaveLength(1);
    expect(await getRollups(ctxB)).toHaveLength(1);
  });
});

describe('seedModelPrices', () => {
  it('is idempotent: a second run changes nothing', async () => {
    const result = await seedModelPrices(db);
    expect(result.inserted).toBe(0);
    expect(result.superseded).toBe(0);
    expect(result.unchanged).toBeGreaterThan(0);
  });
});

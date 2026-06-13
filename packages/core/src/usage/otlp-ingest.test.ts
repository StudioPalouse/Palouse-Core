import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agents,
  closeDb,
  getDb,
  handoffSteps,
  llmGenerations,
  organizations,
  seedModelPrices,
  tasks,
  usageRollupsDaily,
  users,
  workspaces,
  type Database,
} from '@reqops/db';
import { claimNext, createHandoff } from '../handoffs/state-machine.js';
import { getHandoffUsage, ingestOtlp, rebuildRollups, reportUsage } from './service.js';
import type { OtlpTracePayload } from './otlp.js';

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

interface Ctx {
  workspaceId: string;
  userId: string;
  agentId: string;
}

async function seed(): Promise<Ctx> {
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

async function claimedHandoff(ctx: Ctx) {
  const [task] = await db
    .insert(tasks)
    .values({ workspaceId: ctx.workspaceId, title: 'OTLP test task' })
    .returning();
  await createHandoff(db, ctx.workspaceId, ctx.userId, task!.id, {
    agentId: ctx.agentId,
    reviewRequired: false,
    deadlineMinutes: 30,
  });
  const claimed = await claimNext(db, ctx.agentId, ctx.workspaceId);
  return { handoffId: claimed!.handoff.id, claimToken: claimed!.claimToken };
}

/** One OTLP generation span; correlation attrs are spread in by the caller. */
function genTrace(spanId: string, correlation: Record<string, string>): OtlpTracePayload {
  const attrs = [
    { key: 'gen_ai.system', value: { stringValue: 'anthropic' } },
    { key: 'gen_ai.response.model', value: { stringValue: 'claude-opus-4-8' } },
    { key: 'gen_ai.usage.input_tokens', value: { intValue: '1000' } },
    { key: 'gen_ai.usage.output_tokens', value: { intValue: '200' } },
    ...Object.entries(correlation).map(([key, v]) => ({ key, value: { stringValue: v } })),
  ];
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace-1',
                spanId,
                endTimeUnixNano: '1700000000000000000',
                attributes: attrs,
              } as never,
            ],
          },
        ],
      },
    ],
  };
}

function key(ctx: Ctx) {
  return { agentId: ctx.agentId, workspaceId: ctx.workspaceId };
}

// claude-opus-4-8 rates 5 / 25 per 1M: 1000·5/1e6 + 200·25/1e6 = 0.005 + 0.005 = 0.01.
const OPUS_COST = 0.01;

describe('ingestOtlp', () => {
  it('correlates by handoff id, prices the generation, and increments the rollup', async () => {
    const ctx = await seed();
    const { handoffId } = await claimedHandoff(ctx);

    const result = await ingestOtlp(db, key(ctx), genTrace('span-a', { 'reqops.handoff_id': handoffId }));
    expect(result).toMatchObject({ generationsIngested: 1, generationsDuplicate: 0, uncorrelatedSpans: 0 });

    const [gen] = await db.select().from(llmGenerations).where(eq(llmGenerations.handoffId, handoffId));
    expect(gen).toMatchObject({ source: 'otlp', model: 'claude-opus-4-8', provider: 'anthropic', otelSpanId: 'span-a' });
    expect(Number(gen!.costUsd)).toBeCloseTo(OPUS_COST, 8);
    expect(gen!.priceSnapshot?.catalogVersion).toBeTruthy();

    const rollups = await db
      .select()
      .from(usageRollupsDaily)
      .where(eq(usageRollupsDaily.workspaceId, ctx.workspaceId));
    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({ generationCount: 1, inputTokens: 1000, outputTokens: 200 });
    expect(Number(rollups[0]!.costUsd)).toBeCloseTo(OPUS_COST, 8);
  });

  it('dedupes a re-exported span (same handoff + span id) without double-counting rollups', async () => {
    const ctx = await seed();
    const { handoffId } = await claimedHandoff(ctx);
    const payload = genTrace('span-dupe', { 'reqops.handoff_id': handoffId });

    const first = await ingestOtlp(db, key(ctx), payload);
    const second = await ingestOtlp(db, key(ctx), payload);
    expect(first.generationsIngested).toBe(1);
    expect(second).toMatchObject({ generationsIngested: 0, generationsDuplicate: 1 });

    const gens = await db.select().from(llmGenerations).where(eq(llmGenerations.handoffId, handoffId));
    expect(gens).toHaveLength(1);
    const [rollup] = await db
      .select()
      .from(usageRollupsDaily)
      .where(eq(usageRollupsDaily.workspaceId, ctx.workspaceId));
    expect(rollup!.generationCount).toBe(1); // not 2
  });

  it('correlates by claim token, then by the single active handoff fallback', async () => {
    const ctx = await seed();
    const { handoffId, claimToken } = await claimedHandoff(ctx);

    const byToken = await ingestOtlp(db, key(ctx), genTrace('span-tok', { 'reqops.claim_token': claimToken }));
    expect(byToken.generationsIngested).toBe(1);

    const byFallback = await ingestOtlp(db, key(ctx), genTrace('span-fallback', {}));
    expect(byFallback.generationsIngested).toBe(1);

    const gens = await db.select().from(llmGenerations).where(eq(llmGenerations.handoffId, handoffId));
    expect(gens).toHaveLength(2);
  });

  it('counts a span as uncorrelated when the handoff is not the agent\'s active claim', async () => {
    const ctx = await seed();
    await claimedHandoff(ctx);
    // A handoff id the agent does not own / no active claim.
    const result = await ingestOtlp(db, key(ctx), genTrace('span-bad', { 'reqops.handoff_id': crypto.randomUUID() }));
    expect(result).toMatchObject({ generationsIngested: 0, uncorrelatedSpans: 1 });
  });

  it('ingests OTLP steps and dedupes them on re-export', async () => {
    const ctx = await seed();
    const { handoffId } = await claimedHandoff(ctx);
    const stepTrace: OtlpTracePayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  spanId: 'step-span',
                  parentSpanId: 'root',
                  endTimeUnixNano: '1700000000000000000',
                  attributes: [
                    { key: 'reqops.step.title', value: { stringValue: 'Reviewed the brief' } },
                    { key: 'reqops.handoff_id', value: { stringValue: handoffId } },
                  ],
                } as never,
              ],
            },
          ],
        },
      ],
    };
    const first = await ingestOtlp(db, key(ctx), stepTrace);
    const second = await ingestOtlp(db, key(ctx), stepTrace);
    expect(first.stepsIngested).toBe(1);
    expect(second).toMatchObject({ stepsIngested: 0, stepsDuplicate: 1 });

    const steps = await db.select().from(handoffSteps).where(eq(handoffSteps.handoffId, handoffId));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ title: 'Reviewed the brief', source: 'otlp', otelSpanId: 'step-span' });
  });
});

describe('double-counting rule', () => {
  it('getHandoffUsage drops MCP generations when the handoff also has OTLP rows', async () => {
    const ctx = await seed();
    const { handoffId, claimToken } = await claimedHandoff(ctx);

    // Agent (wrongly) reports via BOTH paths for the same work.
    await reportUsage(db, claimToken, { model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 200 });
    await ingestOtlp(db, key(ctx), genTrace('span-otlp', { 'reqops.handoff_id': handoffId }));

    // Ledger holds both rows...
    const all = await db.select().from(llmGenerations).where(eq(llmGenerations.handoffId, handoffId));
    expect(all).toHaveLength(2);

    // ...but the Activity Report counts OTLP only (more granular wins).
    const usage = await getHandoffUsage(db, ctx.workspaceId, handoffId);
    expect(usage.generations).toHaveLength(1);
    expect(usage.generations[0]!.source).toBe('otlp');
    expect(usage.summary.generationCount).toBe(1);
    expect(usage.summary.inputTokens).toBe(1000); // not 2000
  });

  it('rebuildRollups excludes MCP rows for handoffs that have OTLP rows', async () => {
    const ctx = await seed();
    const { handoffId, claimToken } = await claimedHandoff(ctx);
    await reportUsage(db, claimToken, { model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 200 });
    await ingestOtlp(db, key(ctx), genTrace('span-otlp-2', { 'reqops.handoff_id': handoffId }));

    await rebuildRollups(db, ctx.workspaceId);
    const rollups = await db
      .select()
      .from(usageRollupsDaily)
      .where(
        and(eq(usageRollupsDaily.workspaceId, ctx.workspaceId), eq(usageRollupsDaily.agentId, ctx.agentId)),
      );
    const totalGenerations = rollups.reduce((n, r) => n + r.generationCount, 0);
    const totalInput = rollups.reduce((n, r) => n + r.inputTokens, 0);
    expect(totalGenerations).toBe(1); // MCP row excluded
    expect(totalInput).toBe(1000); // not 2000
  });
});

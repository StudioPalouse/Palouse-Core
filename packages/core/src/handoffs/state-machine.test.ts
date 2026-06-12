import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentHandoffs,
  agents,
  closeDb,
  getDb,
  organizations,
  tasks,
  users,
  workspaces,
  type Database,
} from '@reqops/db';
import { claimNext, createHandoff, heartbeat, reapExpired } from './state-machine.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

let container: StartedPostgreSqlContainer;
let db: Database;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = getDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterAll(async () => {
  await closeDb();
  await container?.stop();
});

interface SeedContext {
  workspaceId: string;
  userId: string;
  agentId: string;
}

/** Fresh org/workspace/user/agent so each test is isolated from the others' rows. */
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

async function queueHandoff(ctx: SeedContext) {
  const [task] = await db
    .insert(tasks)
    .values({ workspaceId: ctx.workspaceId, title: 'Test task' })
    .returning();
  return createHandoff(db, ctx.workspaceId, ctx.userId, task!.id, {
    agentId: ctx.agentId,
    reviewRequired: false,
    deadlineMinutes: 30,
  });
}

async function getRow(handoffId: string) {
  const [row] = await db
    .select()
    .from(agentHandoffs)
    .where(eq(agentHandoffs.id, handoffId))
    .limit(1);
  return row!;
}

describe('claimNext', () => {
  it('lets exactly one of many concurrent claimers win', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimNext(db, ctx.agentId, ctx.workspaceId)),
    );

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.handoff.id).toBe(handoff.id);
    expect(winners[0]!.claimToken).toBeTruthy();

    const row = await getRow(handoff.id);
    expect(row.state).toBe('claimed');
    expect(row.claimToken).toBe(winners[0]!.claimToken);
  });

  it('returns null when nothing is queued', async () => {
    const ctx = await seed();
    expect(await claimNext(db, ctx.agentId, ctx.workspaceId)).toBeNull();
  });
});

describe('heartbeat', () => {
  it('moves claimed → in_progress on first beat and stamps the heartbeat', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);
    const claimed = await claimNext(db, ctx.agentId, ctx.workspaceId);

    const afterBeat = await heartbeat(db, claimed!.claimToken);
    expect(afterBeat.id).toBe(handoff.id);
    expect(afterBeat.state).toBe('in_progress');
    expect(afterBeat.lastHeartbeatAt).not.toBeNull();
    expect(afterBeat.deadlineAt).not.toBeNull();
  });

  it('rejects an unknown claim token', async () => {
    await expect(heartbeat(db, crypto.randomUUID())).rejects.toThrow(
      'No active handoff for this claim token',
    );
  });
});

describe('reapExpired', () => {
  it('requeues an in_progress handoff whose heartbeat went stale', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);
    const claimed = await claimNext(db, ctx.agentId, ctx.workspaceId);
    await heartbeat(db, claimed!.claimToken);

    // Stale heartbeat (grace is 180s); deadline stays in the future so this
    // exercises the heartbeat-timeout branch specifically.
    await db.execute(sql`
      UPDATE agent_handoffs SET last_heartbeat_at = now() - interval '4 minutes'
      WHERE id = ${handoff.id}
    `);

    const result = await reapExpired(db);
    expect(result.requeued).toBe(1);

    const row = await getRow(handoff.id);
    expect(row.state).toBe('queued');
    expect(row.claimToken).toBeNull();
    expect(row.requeueCount).toBe(1);

    // The old token is dead; a fresh claim mints a new one.
    await expect(heartbeat(db, claimed!.claimToken)).rejects.toThrow();
    const reclaimed = await claimNext(db, ctx.agentId, ctx.workspaceId);
    expect(reclaimed!.handoff.id).toBe(handoff.id);
    expect(reclaimed!.claimToken).not.toBe(claimed!.claimToken);
  });

  it('requeues a claimed handoff that blew its deadline without ever heartbeating', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);
    await claimNext(db, ctx.agentId, ctx.workspaceId);

    await db.execute(sql`
      UPDATE agent_handoffs SET deadline_at = now() - interval '1 minute'
      WHERE id = ${handoff.id}
    `);

    const result = await reapExpired(db);
    expect(result.requeued).toBe(1);
    expect((await getRow(handoff.id)).state).toBe('queued');
  });

  it('fails a handoff once it exhausts MAX_REQUEUES', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);
    await claimNext(db, ctx.agentId, ctx.workspaceId);

    await db.execute(sql`
      UPDATE agent_handoffs SET deadline_at = now() - interval '1 minute', requeue_count = 3
      WHERE id = ${handoff.id}
    `);

    const result = await reapExpired(db);
    expect(result.failed).toBe(1);

    const row = await getRow(handoff.id);
    expect(row.state).toBe('failed');
    expect(row.failureReason).toBe('heartbeat_timeout');
    expect(row.claimToken).toBeNull();
  });

  it('cancels queued handoffs nobody claimed within the TTL', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);

    await db.execute(sql`
      UPDATE agent_handoffs SET created_at = now() - interval '25 hours'
      WHERE id = ${handoff.id}
    `);

    const result = await reapExpired(db);
    expect(result.cancelled).toBe(1);

    const row = await getRow(handoff.id);
    expect(row.state).toBe('cancelled');
    expect(row.failureReason).toBe('claim_ttl_expired');
  });
});

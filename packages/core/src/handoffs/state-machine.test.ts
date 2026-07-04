import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentHandoffs,
  agents,
  auditEvents,
  closeDb,
  getDb,
  organizations,
  tasks,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import { listHandoffsQuery, userActor } from '@palouse/shared';
import { createTask } from '../tasks/service.js';
import {
  cancel,
  claimNext,
  complete,
  createAgentTask,
  createHandoff,
  fail,
  heartbeat,
  listHandoffs,
  openClaimedHandoff,
  reapExpired,
  review,
} from './state-machine.js';

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

async function getTaskStatus(taskId: string) {
  const [row] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row!.status;
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

describe('createAgentTask', () => {
  it('creates an agent-origin task with a pre-claimed handoff in one call', async () => {
    const ctx = await seed();
    const { task, handoff, claimToken } = await createAgentTask(db, ctx.workspaceId, ctx.agentId, {
      title: 'Direct work from chat',
    });

    expect(task.origin).toBe('agent');
    expect(task.createdByAgentId).toBe(ctx.agentId);
    expect(task.status).toBe('in_progress');
    expect(handoff.state).toBe('claimed');
    expect(handoff.actorAgentId).toBe(ctx.agentId);
    expect(handoff.requestedByUserId).toBeNull();
    expect(handoff.reviewRequired).toBe(false);
    expect(claimToken).toBeTruthy();

    const row = await getRow(handoff.id);
    expect(row.claimToken).toBe(claimToken);
    // Deadline is minted in the same insert: ~30 minutes out.
    const minutesOut = (row.deadlineAt!.getTime() - Date.now()) / 60_000;
    expect(minutesOut).toBeGreaterThan(28);
    expect(minutesOut).toBeLessThanOrEqual(30.5);
  });

  it('returns a live claim token that drives the normal lifecycle', async () => {
    const ctx = await seed();
    const { handoff, claimToken } = await createAgentTask(db, ctx.workspaceId, ctx.agentId, {
      title: 'Lifecycle check',
    });

    const afterBeat = await heartbeat(db, claimToken);
    expect(afterBeat.id).toBe(handoff.id);
    expect(afterBeat.state).toBe('in_progress');

    const done = await complete(db, claimToken, 'All done.');
    expect(done.state).toBe('completed');
  });

  it('honors reviewRequired: completion lands in needs_review', async () => {
    const ctx = await seed();
    const { claimToken } = await createAgentTask(db, ctx.workspaceId, ctx.agentId, {
      title: 'Reviewed work',
      reviewRequired: true,
    });

    const done = await complete(db, claimToken, 'Please review.');
    expect(done.state).toBe('needs_review');
  });

  it('audits task and handoff creation with the agent as actor', async () => {
    const ctx = await seed();
    const { task, handoff } = await createAgentTask(db, ctx.workspaceId, ctx.agentId, {
      title: 'Audited work',
    });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, ctx.workspaceId));
    const byAction = (action: string) => events.filter((e) => e.action === action);

    expect(byAction('task.created')).toMatchObject([
      { actorType: 'agent', actorId: ctx.agentId, targetId: task.id },
    ]);
    expect(byAction('handoff.created')).toMatchObject([
      { actorType: 'agent', actorId: ctx.agentId, targetId: handoff.id },
    ]);
    expect(byAction('handoff.claimed')).toMatchObject([
      { actorType: 'agent', actorId: ctx.agentId, targetId: handoff.id },
    ]);
  });

  it('rolls back the task when the handoff cannot be opened', async () => {
    const ctxA = await seed();
    const ctxB = await seed();

    // Agent from workspace A cannot open a handoff in workspace B; the
    // transaction must also discard the task it just created there.
    await expect(
      createAgentTask(db, ctxB.workspaceId, ctxA.agentId, { title: 'Orphan-to-be' }),
    ).rejects.toThrow('Agent not found');

    const orphans = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.workspaceId, ctxB.workspaceId));
    expect(orphans).toHaveLength(0);
  });
});

describe('openClaimedHandoff', () => {
  it('rejects a task that already has an active handoff', async () => {
    const ctx = await seed();
    const queued = await queueHandoff(ctx);

    await expect(
      openClaimedHandoff(db, ctx.workspaceId, ctx.agentId, queued.taskId),
    ).rejects.toThrow('Task already has an active handoff');
  });
});

describe('task status sync', () => {
  it('claim moves an open task to in_progress', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);
    expect(await getTaskStatus(handoff.taskId)).toBe('open');

    await claimNext(db, ctx.agentId, ctx.workspaceId);
    expect(await getTaskStatus(handoff.taskId)).toBe('in_progress');
  });

  it('completion without review moves the task to done', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);
    const claimed = await claimNext(db, ctx.agentId, ctx.workspaceId);

    await complete(db, claimed!.claimToken, 'done');
    expect(await getTaskStatus(handoff.taskId)).toBe('done');
  });

  it('needs_review keeps the task in_progress until approval moves it to done', async () => {
    const ctx = await seed();
    const [task] = await db
      .insert(tasks)
      .values({ workspaceId: ctx.workspaceId, title: 'Reviewed task' })
      .returning();
    await createHandoff(db, ctx.workspaceId, ctx.userId, task!.id, {
      agentId: ctx.agentId,
      reviewRequired: true,
      deadlineMinutes: 30,
    });
    const claimed = await claimNext(db, ctx.agentId, ctx.workspaceId);

    const pending = await complete(db, claimed!.claimToken, 'please review');
    expect(pending.state).toBe('needs_review');
    expect(await getTaskStatus(task!.id)).toBe('in_progress');

    await review(db, ctx.workspaceId, ctx.userId, pending.id, {
      decision: 'approved',
      rejectAction: 'retry',
    });
    expect(await getTaskStatus(task!.id)).toBe('done');
  });

  it('review rejected to fail frees the task; rejected to retry keeps it in_progress', async () => {
    const ctx = await seed();
    for (const rejectAction of ['fail', 'retry'] as const) {
      const [task] = await db
        .insert(tasks)
        .values({ workspaceId: ctx.workspaceId, title: `Rejected ${rejectAction}` })
        .returning();
      await createHandoff(db, ctx.workspaceId, ctx.userId, task!.id, {
        agentId: ctx.agentId,
        reviewRequired: true,
        deadlineMinutes: 30,
      });
      const claimed = await claimNext(db, ctx.agentId, ctx.workspaceId, task!.id);
      const pending = await complete(db, claimed!.claimToken, 'please review');

      await review(db, ctx.workspaceId, ctx.userId, pending.id, {
        decision: 'rejected',
        rejectAction,
      });
      expect(await getTaskStatus(task!.id)).toBe(rejectAction === 'fail' ? 'open' : 'in_progress');
    }
  });

  it('fail and cancel return the task to open', async () => {
    const ctx = await seed();

    const failed = await queueHandoff(ctx);
    const claimedA = await claimNext(db, ctx.agentId, ctx.workspaceId, failed.taskId);
    await fail(db, claimedA!.claimToken, 'gave up');
    expect(await getTaskStatus(failed.taskId)).toBe('open');

    const cancelled = await queueHandoff(ctx);
    const claimedB = await claimNext(db, ctx.agentId, ctx.workspaceId, cancelled.taskId);
    await cancel(db, ctx.workspaceId, ctx.userId, claimedB!.handoff.id);
    expect(await getTaskStatus(cancelled.taskId)).toBe('open');
  });

  it('reaper requeue returns the task to open; a fresh claim flips it back', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);
    await claimNext(db, ctx.agentId, ctx.workspaceId);
    expect(await getTaskStatus(handoff.taskId)).toBe('in_progress');

    await db.execute(sql`
      UPDATE agent_handoffs SET deadline_at = now() - interval '1 minute'
      WHERE id = ${handoff.id}
    `);
    await reapExpired(db);
    expect(await getTaskStatus(handoff.taskId)).toBe('open');

    await claimNext(db, ctx.agentId, ctx.workspaceId);
    expect(await getTaskStatus(handoff.taskId)).toBe('in_progress');
  });

  it('never touches a human-set blocked task', async () => {
    const ctx = await seed();
    const handoff = await queueHandoff(ctx);
    await db.update(tasks).set({ status: 'blocked' }).where(eq(tasks.id, handoff.taskId));

    const claimed = await claimNext(db, ctx.agentId, ctx.workspaceId);
    expect(await getTaskStatus(handoff.taskId)).toBe('blocked');

    await fail(db, claimed!.claimToken, 'blocked anyway');
    expect(await getTaskStatus(handoff.taskId)).toBe('blocked');
  });
});

describe('start_task flow (openClaimedHandoff on an existing task)', () => {
  it('claims an existing open task and drives it to done', async () => {
    const ctx = await seed();
    const [task] = await db
      .insert(tasks)
      .values({ workspaceId: ctx.workspaceId, title: 'Pointed-at task' })
      .returning();

    const { handoff, claimToken } = await openClaimedHandoff(
      db,
      ctx.workspaceId,
      ctx.agentId,
      task!.id,
    );
    expect(handoff.state).toBe('claimed');
    expect(await getTaskStatus(task!.id)).toBe('in_progress');

    await heartbeat(db, claimToken);
    await complete(db, claimToken, 'done');
    expect(await getTaskStatus(task!.id)).toBe('done');
  });

  it('rejects a task from another workspace', async () => {
    const ctxA = await seed();
    const ctxB = await seed();
    const [task] = await db
      .insert(tasks)
      .values({ workspaceId: ctxB.workspaceId, title: 'Other workspace task' })
      .returning();

    await expect(
      openClaimedHandoff(db, ctxA.workspaceId, ctxA.agentId, task!.id),
    ).rejects.toThrow('Task not found');
  });
});

describe('createTask origin defaults', () => {
  it('user-created tasks keep origin=user, no agent, DB-default status', async () => {
    const ctx = await seed();
    const task = await createTask(db, ctx.workspaceId, userActor(ctx.userId), {
      title: 'Human work',
      priority: 2,
    });

    expect(task.origin).toBe('user');
    expect(task.createdByAgentId).toBeNull();
    expect(task.status).toBe('open');
  });
});

describe('listHandoffs', () => {
  it('active filter returns only non-terminal handoffs', async () => {
    const ctx = await seed();
    const live = await queueHandoff(ctx);
    const finished = await queueHandoff(ctx);
    await db
      .update(agentHandoffs)
      .set({ state: 'completed' })
      .where(eq(agentHandoffs.id, finished.id));

    const { handoffs, total } = await listHandoffs(
      db,
      listHandoffsQuery.parse({ workspaceId: ctx.workspaceId, active: 'true' }),
    );
    expect(total).toBe(1);
    expect(handoffs.map((h) => h.id)).toEqual([live.id]);
  });

  it('without the active filter it returns everything in the workspace', async () => {
    const ctx = await seed();
    await queueHandoff(ctx);
    const finished = await queueHandoff(ctx);
    await db
      .update(agentHandoffs)
      .set({ state: 'cancelled' })
      .where(eq(agentHandoffs.id, finished.id));

    const { total } = await listHandoffs(
      db,
      listHandoffsQuery.parse({ workspaceId: ctx.workspaceId }),
    );
    expect(total).toBe(2);
  });
});

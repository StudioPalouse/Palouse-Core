import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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
import { listEvents, summarize } from './service.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

let container: StartedPostgreSqlContainer;
let db: Database;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = getDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await closeDb();
  await container?.stop();
});

interface SeedContext {
  workspaceId: string;
  userId: string;
  agentId: string;
  taskId: string;
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
  const [u] = await db
    .insert(users)
    .values({ email: `person-${suffix}@example.com`, name: 'Jane Doe' })
    .returning();
  const [ag] = await db.insert(agents).values({ workspaceId: ws!.id, name: 'Scout' }).returning();
  const [task] = await db
    .insert(tasks)
    .values({ workspaceId: ws!.id, title: 'Prepare Q2 filing', priority: 2 })
    .returning();
  return { workspaceId: ws!.id, userId: u!.id, agentId: ag!.id, taskId: task!.id };
}

async function addEvent(
  ctx: SeedContext,
  overrides: Partial<typeof auditEvents.$inferInsert>,
  at?: Date,
): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId: ctx.workspaceId,
    actorType: 'user',
    actorId: ctx.userId,
    action: 'task.updated',
    targetType: 'task',
    targetId: ctx.taskId,
    payload: {},
    ...(at ? { at } : {}),
    ...overrides,
  });
}

describe('audit listEvents', () => {
  it('returns events newest-first with enriched actor names and target labels', async () => {
    const ctx = await seed();
    await addEvent(ctx, { action: 'task.created', payload: {} }, new Date('2026-07-10T10:00:00Z'));
    await addEvent(
      ctx,
      {
        actorType: 'agent',
        actorId: ctx.agentId,
        action: 'task.updated',
        payload: { fields: ['status'] },
      },
      new Date('2026-07-10T12:00:00Z'),
    );

    const { events, total } = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      includeReads: false,
      limit: 50,
      offset: 0,
    });

    expect(total).toBe(2);
    // Newest first.
    expect(events[0]!.action).toBe('task.updated');
    expect(events[0]!.actorType).toBe('agent');
    expect(events[0]!.actorName).toBe('Scout');
    expect(events[0]!.targetLabel).toBe('Prepare Q2 filing');
    expect(events[0]!.summary).toBe('Scout updated status on task "Prepare Q2 filing"');
    expect(events[1]!.actorName).toBe('Jane Doe');
    expect(events[1]!.summary).toBe('Jane Doe created task "Prepare Q2 filing"');
  });

  it('hides mcp.* rows by default and includes them with includeReads', async () => {
    const ctx = await seed();
    await addEvent(ctx, { action: 'task.created' });
    await addEvent(ctx, {
      actorType: 'agent',
      actorId: ctx.agentId,
      action: 'mcp.list_tasks',
      targetType: 'agent',
      targetId: ctx.agentId,
    });

    const hidden = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      includeReads: false,
      limit: 50,
      offset: 0,
    });
    expect(hidden.total).toBe(1);
    expect(hidden.events.every((e) => !e.action.startsWith('mcp.'))).toBe(true);

    const shown = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      includeReads: true,
      limit: 50,
      offset: 0,
    });
    expect(shown.total).toBe(2);
  });

  it('filters by actorType and targetType', async () => {
    const ctx = await seed();
    await addEvent(ctx, { action: 'task.created' });
    await addEvent(ctx, {
      actorType: 'agent',
      actorId: ctx.agentId,
      action: 'task.updated',
      payload: { fields: ['priority'] },
    });

    const agentsOnly = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      actorType: 'agent',
      includeReads: false,
      limit: 50,
      offset: 0,
    });
    expect(agentsOnly.total).toBe(1);
    expect(agentsOnly.events[0]!.actorType).toBe('agent');

    const tasksOnly = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      targetType: 'task',
      includeReads: false,
      limit: 50,
      offset: 0,
    });
    expect(tasksOnly.total).toBe(2);
  });

  it('scopes to a single record with targetId (the per-entity Activity feed)', async () => {
    const ctx = await seed();
    const otherTaskId = crypto.randomUUID();
    await addEvent(ctx, { action: 'task.created' });
    await addEvent(ctx, { action: 'task.updated', payload: { fields: ['status'] } });
    // An event on a different task in the same workspace must not leak in.
    await addEvent(ctx, { action: 'task.created', targetId: otherTaskId });

    const forTask = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      targetType: 'task',
      targetId: ctx.taskId,
      includeReads: false,
      limit: 50,
      offset: 0,
    });
    expect(forTask.total).toBe(2);
    expect(forTask.events.every((e) => e.targetId === ctx.taskId)).toBe(true);
  });

  it('paginates with a stable total', async () => {
    const ctx = await seed();
    for (let i = 0; i < 5; i++) await addEvent(ctx, { action: 'task.updated' });

    const page1 = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      includeReads: false,
      limit: 2,
      offset: 0,
    });
    expect(page1.total).toBe(5);
    expect(page1.events).toHaveLength(2);

    const page3 = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      includeReads: false,
      limit: 2,
      offset: 4,
    });
    expect(page3.total).toBe(5);
    expect(page3.events).toHaveLength(1);
  });

  it('scopes results to the workspace', async () => {
    const a = await seed();
    const b = await seed();
    await addEvent(a, { action: 'task.created' });
    const result = await listEvents(db, {
      workspaceId: b.workspaceId,
      includeReads: false,
      limit: 50,
      offset: 0,
    });
    expect(result.total).toBe(0);
  });
});

describe('summarize', () => {
  it('falls back to a generic phrasing for unknown actions', () => {
    expect(summarize('gizmo.frobnicated', 'Scout', 'agent', 'Widget', 'task', {})).toBe(
      'Scout frobnicated task "Widget"',
    );
  });

  it('uses a role fallback when the actor name is unknown', () => {
    expect(summarize('task.created', null, 'agent', 'X', 'task', {})).toBe(
      'An agent created task "X"',
    );
    expect(summarize('task.created', null, 'user', 'X', 'task', {})).toBe(
      'Someone created task "X"',
    );
  });
});

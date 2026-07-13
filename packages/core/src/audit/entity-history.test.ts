import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agents,
  closeDb,
  getDb,
  organizations,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import { agentActor, userActor } from '@palouse/shared';
import { addComment, createTask, getTask, updateTask } from '../tasks/service.js';
import { listEvents } from './service.js';

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
  const [u] = await db
    .insert(users)
    .values({ email: `person-${suffix}@example.com`, name: 'Jane Doe' })
    .returning();
  const [ag] = await db.insert(agents).values({ workspaceId: ws!.id, name: 'Scout' }).returning();
  return { workspaceId: ws!.id, userId: u!.id, agentId: ag!.id };
}

describe('entity history (slice 3)', () => {
  it('records before/after values on a task update (A3)', async () => {
    const ctx = await seed();
    const task = await createTask(db, ctx.workspaceId, userActor(ctx.userId), {
      title: 'Prepare filing',
      priority: 2,
    });
    await updateTask(db, ctx.workspaceId, agentActor(ctx.agentId), task.id, {
      status: 'done',
      priority: 1,
    });

    const { events } = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      targetType: 'task',
      targetId: task.id,
      action: 'task.updated',
      includeReads: false,
      limit: 50,
      offset: 0,
    });
    expect(events).toHaveLength(1);
    const changes = events[0]!.payload.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.status).toEqual({ from: 'open', to: 'done' });
    expect(changes.priority).toEqual({ from: 2, to: 1 });
  });

  it('omits unchanged fields from the diff', async () => {
    const ctx = await seed();
    const task = await createTask(db, ctx.workspaceId, userActor(ctx.userId), {
      title: 'Stable',
      priority: 3,
    });
    // Re-send the same priority plus a real title change.
    await updateTask(db, ctx.workspaceId, userActor(ctx.userId), task.id, {
      title: 'Renamed',
      priority: 3,
    });
    const { events } = await listEvents(db, {
      workspaceId: ctx.workspaceId,
      targetType: 'task',
      targetId: task.id,
      action: 'task.updated',
      includeReads: false,
      limit: 50,
      offset: 0,
    });
    const changes = events[0]!.payload.changes as Record<string, unknown>;
    expect(Object.keys(changes)).toEqual(['title']);
  });

  it('attributes an agent comment to the agent by id and name (A4)', async () => {
    const ctx = await seed();
    const task = await createTask(db, ctx.workspaceId, userActor(ctx.userId), {
      title: 'Discuss',
      priority: 2,
    });
    await addComment(db, ctx.workspaceId, agentActor(ctx.agentId), task.id, {
      bodyMd: 'Looks good to me.',
    });
    await addComment(db, ctx.workspaceId, userActor(ctx.userId), task.id, {
      bodyMd: 'Agreed.',
    });

    const { comments } = await getTask(db, ctx.workspaceId, task.id);
    const agentComment = comments.find((c) => c.authorAgentId === ctx.agentId);
    const userComment = comments.find((c) => c.authorUserId === ctx.userId);
    expect(agentComment?.authorName).toBe('Scout');
    expect(agentComment?.authorUserId).toBeNull();
    expect(userComment?.authorName).toBe('Jane Doe');
    expect(userComment?.authorAgentId).toBeNull();
  });
});

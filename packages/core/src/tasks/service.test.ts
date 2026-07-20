import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  getDb,
  memberships,
  organizations,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import { createAgent } from '../agents/service.js';
import { createTask, getTask, listTasks } from './service.js';

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

async function seed(): Promise<{ workspaceId: string; ownerId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organizations)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ organizationId: org!.id, name: `WS ${suffix}`, slug: `ws-${suffix}` })
    .returning();
  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${crypto.randomUUID().slice(0, 8)}@example.com` })
    .returning();
  await db.insert(memberships).values({ workspaceId: ws!.id, userId: owner!.id, role: 'owner' });
  return { workspaceId: ws!.id, ownerId: owner!.id };
}

describe('task createdByAgentName resolution', () => {
  it('names the creating agent in both list and detail', async () => {
    const ctx = await seed();
    const agent = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'Nightly Bot',
      kind: 'mcp_generic',
      metadata: {},
    });
    const created = await createTask(
      db,
      ctx.workspaceId,
      { type: 'agent', id: agent.id },
      { title: 'Agent task', priority: 2 },
    );
    expect(created.origin).toBe('agent');
    expect(created.createdByAgentId).toBe(agent.id);

    const { task } = await getTask(db, ctx.workspaceId, created.id);
    expect(task.createdByAgentName).toBe('Nightly Bot');

    const { tasks } = await listTasks(db, { workspaceId: ctx.workspaceId, limit: 50, offset: 0 });
    expect(tasks.find((t) => t.id === created.id)?.createdByAgentName).toBe('Nightly Bot');
  });

  it('leaves createdByAgentName null for user-created tasks', async () => {
    const ctx = await seed();
    const created = await createTask(
      db,
      ctx.workspaceId,
      { type: 'user', id: ctx.ownerId },
      { title: 'User task', priority: 2 },
    );
    const { task } = await getTask(db, ctx.workspaceId, created.id);
    expect(task.origin).toBe('user');
    expect(task.createdByAgentName).toBeNull();
  });
});

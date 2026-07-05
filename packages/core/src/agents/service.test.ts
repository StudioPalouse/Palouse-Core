import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  getDb,
  memberships,
  organizations,
  tasks,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import {
  archiveAgent,
  createAgent,
  createApiKey,
  deleteAgent,
  getAgent,
  listAgents,
  unarchiveAgent,
  verifyApiKey,
} from './service.js';

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

describe('agent archive', () => {
  it('hides archived agents from the default list but not the archived one', async () => {
    const ctx = await seed();
    const kept = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'Kept',
      kind: 'mcp_generic',
      metadata: {},
    });
    const archived = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'Archived',
      kind: 'mcp_generic',
      metadata: {},
    });

    await archiveAgent(db, ctx.workspaceId, ctx.ownerId, archived.id);

    const visible = await listAgents(db, ctx.workspaceId);
    expect(visible.map((a) => a.id)).toEqual([kept.id]);

    const all = await listAgents(db, ctx.workspaceId, { includeArchived: true });
    expect(all.map((a) => a.id).sort()).toEqual([kept.id, archived.id].sort());
    expect(all.find((a) => a.id === archived.id)?.archivedAt).not.toBeNull();
  });

  it('revokes active keys and rejects authentication after archiving', async () => {
    const ctx = await seed();
    const agent = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'A',
      kind: 'mcp_generic',
      metadata: {},
    });
    const { plaintext } = await createApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, {
      scopes: ['*'],
    });

    await archiveAgent(db, ctx.workspaceId, ctx.ownerId, agent.id);

    const { keys } = await getAgent(db, ctx.workspaceId, agent.id);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.revokedAt).not.toBeNull();
    await expect(verifyApiKey(db, plaintext)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses to mint keys for an archived agent, and restore does not revive old keys', async () => {
    const ctx = await seed();
    const agent = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'A',
      kind: 'mcp_generic',
      metadata: {},
    });
    await createApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, { scopes: ['*'] });
    await archiveAgent(db, ctx.workspaceId, ctx.ownerId, agent.id);

    await expect(
      createApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, { scopes: ['*'] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const restored = await unarchiveAgent(db, ctx.workspaceId, ctx.ownerId, agent.id);
    expect(restored.archivedAt).toBeNull();
    const { keys } = await getAgent(db, ctx.workspaceId, agent.id);
    expect(keys[0]!.revokedAt).not.toBeNull();
  });

  it('cannot archive an agent from another workspace', async () => {
    const a = await seed();
    const b = await seed();
    const agent = await createAgent(db, a.workspaceId, a.ownerId, {
      name: 'A',
      kind: 'mcp_generic',
      metadata: {},
    });
    await expect(archiveAgent(db, b.workspaceId, b.ownerId, agent.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('agent delete', () => {
  it('deletes an agent with no history, cascading its keys', async () => {
    const ctx = await seed();
    const agent = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'Unused',
      kind: 'mcp_generic',
      metadata: {},
    });
    await createApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, { scopes: ['*'] });

    await deleteAgent(db, ctx.workspaceId, ctx.ownerId, agent.id);

    await expect(getAgent(db, ctx.workspaceId, agent.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses to delete an agent with attributed history', async () => {
    const ctx = await seed();
    const agent = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'Busy',
      kind: 'mcp_generic',
      metadata: {},
    });
    await db.insert(tasks).values({
      workspaceId: ctx.workspaceId,
      title: 'Created by agent',
      origin: 'agent',
      createdByAgentId: agent.id,
    });

    await expect(deleteAgent(db, ctx.workspaceId, ctx.ownerId, agent.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // Still there, and still archivable.
    const archived = await archiveAgent(db, ctx.workspaceId, ctx.ownerId, agent.id);
    expect(archived.archivedAt).not.toBeNull();
  });
});

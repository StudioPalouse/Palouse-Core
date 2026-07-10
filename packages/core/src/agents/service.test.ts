import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hash as argon2Hash } from '@node-rs/argon2';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentApiKeys,
  auditEvents,
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
  assertMcpGrant,
  createAgent,
  createApiKey,
  deleteAgent,
  getAgent,
  listAgents,
  revokeApiKey,
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

describe('revokeApiKey workspace scoping', () => {
  async function seedAgentWithKey(ctx: { workspaceId: string; ownerId: string }) {
    const agent = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'Keyed',
      kind: 'mcp_generic',
      metadata: {},
    });
    const { key } = await createApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, {
      scopes: ['*'],
    });
    return { agent, key };
  }

  async function revokedAt(keyId: string): Promise<Date | null> {
    const [row] = await db
      .select({ revokedAt: agentApiKeys.revokedAt })
      .from(agentApiKeys)
      .where(eq(agentApiKeys.id, keyId));
    return row!.revokedAt;
  }

  async function revocationAuditCount(workspaceId: string): Promise<number> {
    const rows = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.action, 'agent.key_revoked')),
      );
    return rows.length;
  }

  it('cannot revoke a key belonging to another workspace, and writes no audit event', async () => {
    const a = await seed();
    const b = await seed();
    const target = await seedAgentWithKey(b);

    await expect(
      revokeApiKey(db, a.workspaceId, a.ownerId, target.agent.id, target.key.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await revokedAt(target.key.id)).toBeNull();
    expect(await revocationAuditCount(a.workspaceId)).toBe(0);
    expect(await revocationAuditCount(b.workspaceId)).toBe(0);
  });

  it('revokes a key in its own workspace and audits it', async () => {
    const ctx = await seed();
    const { agent, key } = await seedAgentWithKey(ctx);

    await revokeApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, key.id);

    expect(await revokedAt(key.id)).not.toBeNull();
    expect(await revocationAuditCount(ctx.workspaceId)).toBe(1);
  });

  it('revoking an already-revoked key reports not found', async () => {
    const ctx = await seed();
    const { agent, key } = await seedAgentWithKey(ctx);

    await revokeApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, key.id);
    await expect(
      revokeApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, key.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await revocationAuditCount(ctx.workspaceId)).toBe(1);
  });
});

describe('assertMcpGrant', () => {
  async function seedAgent(ctx: { workspaceId: string; ownerId: string }) {
    return createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'MCP',
      kind: 'mcp_generic',
      metadata: {},
    });
  }

  it('passes for an active member of the agent workspace', async () => {
    const ctx = await seed();
    const agent = await seedAgent(ctx);
    await expect(assertMcpGrant(db, { userId: ctx.ownerId, agentId: agent.id })).resolves.toEqual({
      agentId: agent.id,
      workspaceId: ctx.workspaceId,
    });
  });

  it('rejects a deactivated member', async () => {
    const ctx = await seed();
    const agent = await seedAgent(ctx);
    await db
      .update(memberships)
      .set({ status: 'inactive', deactivatedAt: new Date() })
      .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(memberships.userId, ctx.ownerId)));

    await expect(
      assertMcpGrant(db, { userId: ctx.ownerId, agentId: agent.id }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a removed member', async () => {
    const ctx = await seed();
    const agent = await seedAgent(ctx);
    await db
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(memberships.userId, ctx.ownerId)));

    await expect(
      assertMcpGrant(db, { userId: ctx.ownerId, agentId: agent.id }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects an archived agent even for an active member', async () => {
    const ctx = await seed();
    const agent = await seedAgent(ctx);
    await archiveAgent(db, ctx.workspaceId, ctx.ownerId, agent.id);

    await expect(
      assertMcpGrant(db, { userId: ctx.ownerId, agentId: agent.id }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a user whose membership is in a different workspace', async () => {
    const a = await seed();
    const b = await seed();
    const agent = await seedAgent(a);

    await expect(
      assertMcpGrant(db, { userId: b.ownerId, agentId: agent.id }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('key format parsing', () => {
  it('verifies legacy keys whose base64url prefix contains underscores', async () => {
    const ctx = await seed();
    const agent = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'Legacy',
      kind: 'mcp_generic',
      metadata: {},
    });
    // Prefixes minted before the hex switch could contain underscores; the
    // parser must split on the last separator, not a fixed part count.
    const prefix = 'ab_cd_9Z';
    const secret = randomBytes(32).toString('hex');
    await db.insert(agentApiKeys).values({
      agentId: agent.id,
      prefix,
      hash: await argon2Hash(secret),
      scopes: ['*'],
    });

    await expect(verifyApiKey(db, `palouse_agk_${prefix}_${secret}`)).resolves.toMatchObject({
      agentId: agent.id,
    });
  });

  it('rejects malformed keys', async () => {
    await expect(verifyApiKey(db, 'palouse_agk_missingsecret')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(verifyApiKey(db, 'not_a_palouse_key_at_all')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('immediate key revocation', () => {
  function fakeStore() {
    const revoked = new Set<string>();
    return {
      revoked,
      store: {
        async markRevoked(keyId: string) {
          revoked.add(keyId);
        },
        async isRevoked(keyId: string) {
          return revoked.has(keyId);
        },
      },
    };
  }

  async function seedKeyedAgent(ctx: { workspaceId: string; ownerId: string }) {
    const agent = await createAgent(db, ctx.workspaceId, ctx.ownerId, {
      name: 'Cached',
      kind: 'mcp_generic',
      metadata: {},
    });
    const { key, plaintext } = await createApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, {
      scopes: ['*'],
    });
    return { agent, key, plaintext };
  }

  it('rejects a revoked key on the next request even when the verify cache is warm', async () => {
    const ctx = await seed();
    const { agent, key, plaintext } = await seedKeyedAgent(ctx);
    const { store } = fakeStore();

    // Warm the cache: without a tombstone this entry would live five minutes.
    await expect(verifyApiKey(db, plaintext, store)).resolves.toMatchObject({ keyId: key.id });

    await revokeApiKey(db, ctx.workspaceId, ctx.ownerId, agent.id, key.id, store);

    await expect(verifyApiKey(db, plaintext, store)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('archiving an agent tombstones every one of its keys', async () => {
    const ctx = await seed();
    const { agent, key, plaintext } = await seedKeyedAgent(ctx);
    const { store, revoked } = fakeStore();

    await expect(verifyApiKey(db, plaintext, store)).resolves.toMatchObject({ keyId: key.id });
    await archiveAgent(db, ctx.workspaceId, ctx.ownerId, agent.id, store);

    expect(revoked.has(key.id)).toBe(true);
    await expect(verifyApiKey(db, plaintext, store)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('fails open to the local cache when the revocation store errors', async () => {
    const ctx = await seed();
    const { key, plaintext } = await seedKeyedAgent(ctx);
    const throwing = {
      async markRevoked(): Promise<void> {
        throw new Error('redis down');
      },
      async isRevoked(): Promise<boolean> {
        throw new Error('redis down');
      },
    };

    // First call misses the cache and hits the DB (store not consulted);
    // second call hits the cache, the store throws, and auth still succeeds.
    await expect(verifyApiKey(db, plaintext, throwing)).resolves.toMatchObject({ keyId: key.id });
    await expect(verifyApiKey(db, plaintext, throwing)).resolves.toMatchObject({ keyId: key.id });
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

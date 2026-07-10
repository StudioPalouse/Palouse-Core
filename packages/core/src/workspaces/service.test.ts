import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agents,
  closeDb,
  getDb,
  invitations,
  memberships,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  organizations,
  sessions,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import { assertMcpGrant } from '../agents/service.js';
import {
  acceptInvite,
  createInvite,
  listInvites,
  listMembers,
  removeMember,
  resendInvite,
  revokeInvite,
  setMemberStatus,
} from './service.js';

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
  ownerId: string;
}

/** Fresh org/workspace with an active owner so tests stay isolated. */
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
  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${suffix}@example.com`, name: 'Owner User' })
    .returning();
  await db
    .insert(memberships)
    .values({ workspaceId: ws!.id, userId: owner!.id, role: 'owner' });
  return { workspaceId: ws!.id, ownerId: owner!.id };
}

async function addUser(email: string): Promise<string> {
  const [user] = await db.insert(users).values({ email }).returning();
  return user!.id;
}

async function getInviteRow(inviteId: string) {
  const [row] = await db.select().from(invitations).where(eq(invitations.id, inviteId)).limit(1);
  return row!;
}

describe('resendInvite', () => {
  it('rotates the token, extends expiry, and invalidates the old link', async () => {
    const ctx = await seed();
    const { invitation, token: oldToken } = await createInvite(db, ctx.workspaceId, ctx.ownerId, {
      email: 'invitee@example.com',
      role: 'member',
    });
    const before = await getInviteRow(invitation.id);

    const { invitation: resent, token: newToken } = await resendInvite(
      db,
      ctx.workspaceId,
      ctx.ownerId,
      invitation.id,
    );
    const after = await getInviteRow(invitation.id);

    expect(resent.id).toBe(invitation.id);
    expect(resent.status).toBe('pending');
    expect(newToken).not.toBe(oldToken);
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.expiresAt.getTime()).toBeGreaterThanOrEqual(before.expiresAt.getTime());

    // The old link is dead; the new one still admits the invitee.
    const inviteeId = await addUser('invitee@example.com');
    await expect(acceptInvite(db, inviteeId, oldToken)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const accepted = await acceptInvite(db, inviteeId, newToken);
    expect(accepted.workspaceId).toBe(ctx.workspaceId);
  });

  it('rejects resending a non-pending invitation', async () => {
    const ctx = await seed();
    const { invitation } = await createInvite(db, ctx.workspaceId, ctx.ownerId, {
      email: 'revoked@example.com',
      role: 'member',
    });
    await revokeInvite(db, ctx.workspaceId, ctx.ownerId, invitation.id);

    await expect(resendInvite(db, ctx.workspaceId, ctx.ownerId, invitation.id)).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );
    expect(await listInvites(db, ctx.workspaceId)).toHaveLength(0);
  });

  it('requires an admin actor', async () => {
    const ctx = await seed();
    const { invitation } = await createInvite(db, ctx.workspaceId, ctx.ownerId, {
      email: 'someone@example.com',
      role: 'member',
    });
    const memberId = await addUser('plain-member@example.com');
    await db
      .insert(memberships)
      .values({ workspaceId: ctx.workspaceId, userId: memberId, role: 'member' });

    await expect(resendInvite(db, ctx.workspaceId, memberId, invitation.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('listMembers lastActiveAt', () => {
  it('reports the newest session per user and null for sessionless users', async () => {
    const ctx = await seed();
    const idleId = await addUser('idle@example.com');
    await db
      .insert(memberships)
      .values({ workspaceId: ctx.workspaceId, userId: idleId, role: 'viewer' });

    const older = new Date(Date.now() - 3 * 86_400_000);
    const newer = new Date(Date.now() - 60_000);
    await db.insert(sessions).values([
      {
        userId: ctx.ownerId,
        token: `tok-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: older,
        updatedAt: older,
      },
      {
        userId: ctx.ownerId,
        token: `tok-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: newer,
        updatedAt: newer,
      },
    ]);

    const members = await listMembers(db, ctx.workspaceId);
    const owner = members.find((m) => m.userId === ctx.ownerId);
    const idle = members.find((m) => m.userId === idleId);

    expect(owner?.lastActiveAt).toBe(newer.toISOString());
    expect(idle?.lastActiveAt).toBeNull();
  });
});

describe('MCP grant revocation on membership change', () => {
  async function seedOAuthClient(): Promise<string> {
    const clientId = `client-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(oauthClients).values({ clientId, redirectUris: [] });
    return clientId;
  }

  async function seedAgent(workspaceId: string): Promise<string> {
    const [agent] = await db
      .insert(agents)
      .values({ workspaceId, name: `Agent ${crypto.randomUUID().slice(0, 8)}` })
      .returning();
    return agent!.id;
  }

  async function seedGrant(clientId: string, userId: string, agentId: string): Promise<void> {
    await db
      .insert(oauthConsents)
      .values({ clientId, userId, referenceId: agentId, scopes: ['tasks:read'] });
    const [rt] = await db
      .insert(oauthRefreshTokens)
      .values({
        token: `rt-${crypto.randomUUID()}`,
        clientId,
        userId,
        referenceId: agentId,
        expiresAt: new Date(Date.now() + 86_400_000),
        scopes: ['tasks:read'],
      })
      .returning();
    await db.insert(oauthAccessTokens).values({
      token: `at-${crypto.randomUUID()}`,
      clientId,
      userId,
      referenceId: agentId,
      refreshId: rt!.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['tasks:read'],
    });
  }

  async function grantRowCounts(
    userId: string,
    agentId: string,
  ): Promise<{ consents: number; refresh: number; access: number }> {
    const [consents, refresh, access] = await Promise.all([
      db
        .select({ id: oauthConsents.id })
        .from(oauthConsents)
        .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.referenceId, agentId))),
      db
        .select({ id: oauthRefreshTokens.id })
        .from(oauthRefreshTokens)
        .where(
          and(eq(oauthRefreshTokens.userId, userId), eq(oauthRefreshTokens.referenceId, agentId)),
        ),
      db
        .select({ id: oauthAccessTokens.id })
        .from(oauthAccessTokens)
        .where(
          and(eq(oauthAccessTokens.userId, userId), eq(oauthAccessTokens.referenceId, agentId)),
        ),
    ]);
    return { consents: consents.length, refresh: refresh.length, access: access.length };
  }

  it('removeMember deletes only the removed user grants, keeping co-consented and other-workspace grants', async () => {
    const w1 = await seed();
    const clientId = await seedOAuthClient();
    const memberB = await addUser(`b-${crypto.randomUUID().slice(0, 8)}@example.com`);
    await db.insert(memberships).values({ workspaceId: w1.workspaceId, userId: memberB, role: 'member' });

    // Shared agent both users authorized, plus B's own agent in W1.
    const sharedAgent = await seedAgent(w1.workspaceId);
    const bAgent = await seedAgent(w1.workspaceId);
    await seedGrant(clientId, w1.ownerId, sharedAgent);
    await seedGrant(clientId, memberB, sharedAgent);
    await seedGrant(clientId, memberB, bAgent);

    // B also owns a second workspace with its own grant; it must survive.
    const w2 = await seed();
    await db.insert(memberships).values({ workspaceId: w2.workspaceId, userId: memberB, role: 'member' });
    const w2Agent = await seedAgent(w2.workspaceId);
    await seedGrant(clientId, memberB, w2Agent);

    await removeMember(db, w1.workspaceId, w1.ownerId, memberB);

    expect(await grantRowCounts(memberB, sharedAgent)).toEqual({ consents: 0, refresh: 0, access: 0 });
    expect(await grantRowCounts(memberB, bAgent)).toEqual({ consents: 0, refresh: 0, access: 0 });
    expect(await grantRowCounts(w1.ownerId, sharedAgent)).toEqual({ consents: 1, refresh: 1, access: 1 });
    expect(await grantRowCounts(memberB, w2Agent)).toEqual({ consents: 1, refresh: 1, access: 1 });

    // The shared agent stays live for the remaining consenter, and the
    // removed user no longer verifies against it.
    const [shared] = await db.select().from(agents).where(eq(agents.id, sharedAgent));
    expect(shared!.archivedAt).toBeNull();
    await expect(assertMcpGrant(db, { userId: w1.ownerId, agentId: sharedAgent })).resolves.toBeTruthy();
    await expect(assertMcpGrant(db, { userId: memberB, agentId: sharedAgent })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('deactivation deletes grants and reactivation does not resurrect them', async () => {
    const ctx = await seed();
    const clientId = await seedOAuthClient();
    const memberB = await addUser(`b-${crypto.randomUUID().slice(0, 8)}@example.com`);
    await db.insert(memberships).values({ workspaceId: ctx.workspaceId, userId: memberB, role: 'member' });
    const agentId = await seedAgent(ctx.workspaceId);
    await seedGrant(clientId, memberB, agentId);

    await setMemberStatus(db, ctx.workspaceId, ctx.ownerId, memberB, 'inactive');
    expect(await grantRowCounts(memberB, agentId)).toEqual({ consents: 0, refresh: 0, access: 0 });

    await setMemberStatus(db, ctx.workspaceId, ctx.ownerId, memberB, 'active');
    expect(await grantRowCounts(memberB, agentId)).toEqual({ consents: 0, refresh: 0, access: 0 });
  });

  it('reactivating an untouched member leaves grants alone', async () => {
    const ctx = await seed();
    const clientId = await seedOAuthClient();
    const agentId = await seedAgent(ctx.workspaceId);
    await seedGrant(clientId, ctx.ownerId, agentId);

    // Setting the same status twice is a no-op and must not clear grants.
    const memberB = await addUser(`b-${crypto.randomUUID().slice(0, 8)}@example.com`);
    await db.insert(memberships).values({ workspaceId: ctx.workspaceId, userId: memberB, role: 'member' });
    await setMemberStatus(db, ctx.workspaceId, ctx.ownerId, memberB, 'active');

    expect(await grantRowCounts(ctx.ownerId, agentId)).toEqual({ consents: 1, refresh: 1, access: 1 });
  });
});

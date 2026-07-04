import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  getDb,
  invitations,
  memberships,
  organizations,
  sessions,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import {
  acceptInvite,
  createInvite,
  listInvites,
  listMembers,
  resendInvite,
  revokeInvite,
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

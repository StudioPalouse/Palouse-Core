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
import { CAPABILITY_KEYS, type MemberRole } from '@palouse/shared';
import { capabilitiesForWorkspace, getCapabilities, setCapability } from './service.js';

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
  ownerId: string;
  adminId: string;
  memberId: string;
  outsiderId: string;
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

  async function user(role: MemberRole | null): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email: `${role ?? 'outsider'}-${crypto.randomUUID().slice(0, 8)}@example.com` })
      .returning();
    if (role) {
      await db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, role });
    }
    return u!.id;
  }

  return {
    workspaceId: ws!.id,
    ownerId: await user('owner'),
    adminId: await user('admin'),
    memberId: await user('member'),
    outsiderId: await user(null),
  };
}

describe('capabilities', () => {
  it('defaults every capability to enabled when no rows exist', async () => {
    const ctx = await seed();
    const map = await capabilitiesForWorkspace(db, ctx.workspaceId);
    for (const key of CAPABILITY_KEYS) expect(map[key]).toBe(true);
  });

  it('lets any member read but not an outsider', async () => {
    const ctx = await seed();
    const map = await getCapabilities(db, ctx.workspaceId, ctx.memberId);
    expect(map.tasks).toBe(true);
    await expect(getCapabilities(db, ctx.workspaceId, ctx.outsiderId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lets owners and admins toggle a capability off and back on', async () => {
    const ctx = await seed();

    const afterDisable = await setCapability(db, ctx.workspaceId, ctx.adminId, 'projects', false);
    expect(afterDisable.projects).toBe(false);
    expect(afterDisable.tasks).toBe(true);

    // Upsert path: flipping the same capability again updates the existing row.
    const afterEnable = await setCapability(db, ctx.workspaceId, ctx.ownerId, 'projects', true);
    expect(afterEnable.projects).toBe(true);
  });

  it('rejects toggles from members and outsiders', async () => {
    const ctx = await seed();
    await expect(
      setCapability(db, ctx.workspaceId, ctx.memberId, 'tasks', false),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setCapability(db, ctx.workspaceId, ctx.outsiderId, 'tasks', false),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('scopes overrides to the workspace that set them', async () => {
    const a = await seed();
    const b = await seed();
    await setCapability(db, a.workspaceId, a.ownerId, 'objectives', false);
    expect((await capabilitiesForWorkspace(db, a.workspaceId)).objectives).toBe(false);
    expect((await capabilitiesForWorkspace(db, b.workspaceId)).objectives).toBe(true);
  });
});

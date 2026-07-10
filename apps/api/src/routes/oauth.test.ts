import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOAuthState } from '@palouse/connector-core';
import {
  closeDb,
  getDb,
  integrations,
  memberships,
  organizations,
  users,
  workspaces,
  type Database,
} from '@palouse/db';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));

const { exchangeCode } = vi.hoisted(() => ({
  exchangeCode: vi.fn(async () => ({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    scopes: ['data:read_write'],
    accountLabel: 'Test Account',
  })),
}));

vi.mock('../connectors.js', () => ({
  adapterFor: () => ({
    buildAuthUrl: () => 'https://provider.example/auth',
    exchangeCode,
  }),
  oauthConfigFor: () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
}));

// The callback enqueues an initial pull on success; neither needs a live Redis.
vi.mock('../queue.js', () => ({ getSyncQueue: () => ({}) }));
vi.mock('@palouse/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@palouse/queue')>()),
  enqueuePull: vi.fn(async () => {}),
}));

const AUTH_SECRET = 'oauth-test-secret-oauth-test-secret-!!';
const WEB_BASE_URL = 'http://localhost:3000';
const SETTINGS_URL = `${WEB_BASE_URL}/settings/integrations`;

let container: StartedPostgreSqlContainer;
let db: Database;
let oauthRoutes: (typeof import('./oauth.js'))['oauthRoutes'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = getDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  // logger.ts resolves loadEnv() at import time, so env must be complete
  // before the route module (or anything importing it) is loaded.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.REDIS_URL = 'redis://127.0.0.1:6399';
  process.env.BETTER_AUTH_SECRET = AUTH_SECRET;
  process.env.BETTER_AUTH_URL = 'http://localhost:4000';
  process.env.API_BASE_URL = 'http://localhost:4000';
  process.env.WEB_BASE_URL = WEB_BASE_URL;
  process.env.PALOUSE_ENCRYPTION_KEY = '0f'.repeat(32);
  const { _resetEnvForTest } = await import('@palouse/config');
  _resetEnvForTest();

  ({ oauthRoutes } = await import('./oauth.js'));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await container?.stop();
});

beforeEach(() => {
  exchangeCode.mockClear();
});

async function seedAdmin(): Promise<{ workspaceId: string; userId: string }> {
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
    .values({ email: `admin-${suffix}@example.com` })
    .returning();
  await db.insert(memberships).values({ workspaceId: ws!.id, userId: user!.id, role: 'admin' });
  return { workspaceId: ws!.id, userId: user!.id };
}

function callbackUrl(state: string): string {
  return `/todoist/callback?code=fake-code&state=${encodeURIComponent(state)}`;
}

async function integrationCount(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId));
  return rows.length;
}

describe('connector OAuth callback authorization', () => {
  it('rejects a member removed after the flow started, before the code exchange', async () => {
    const ctx = await seedAdmin();
    const state = createOAuthState(
      { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: 'todoist' },
      AUTH_SECRET,
    );
    await db.delete(memberships).where(eq(memberships.userId, ctx.userId));

    const res = await oauthRoutes.request(callbackUrl(state));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${SETTINGS_URL}?error=oauth_failed`);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(await integrationCount(ctx.workspaceId)).toBe(0);
  });

  it('rejects a member deactivated after the flow started', async () => {
    const ctx = await seedAdmin();
    const state = createOAuthState(
      { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: 'todoist' },
      AUTH_SECRET,
    );
    await db
      .update(memberships)
      .set({ status: 'inactive', deactivatedAt: new Date() })
      .where(eq(memberships.userId, ctx.userId));

    const res = await oauthRoutes.request(callbackUrl(state));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${SETTINGS_URL}?error=oauth_failed`);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(await integrationCount(ctx.workspaceId)).toBe(0);
  });

  it('lets an active admin complete the flow', async () => {
    const ctx = await seedAdmin();
    const state = createOAuthState(
      { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: 'todoist' },
      AUTH_SECRET,
    );

    const res = await oauthRoutes.request(callbackUrl(state));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${SETTINGS_URL}?connected=todoist`);
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(await integrationCount(ctx.workspaceId)).toBe(1);
  });
});

import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PalouseError } from '@palouse/shared';
import {
  closeDb,
  getDb,
  memberships,
  organizations,
  users,
  workspaceCapabilities,
  workspaces,
  type Database,
} from '@palouse/db';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));

const WEB_BASE_URL = 'http://localhost:3000';
const CAPABILITY_OFF = 'The Tasks capability is turned off for this workspace.';

// The session middleware resolves whichever user the current test seeded.
const { sessionUserId } = vi.hoisted(() => ({ sessionUserId: { value: '' } }));

vi.mock('@palouse/auth', () => ({
  getAuth: () => ({
    api: {
      getSession: async () =>
        sessionUserId.value
          ? { user: { id: sessionUserId.value, email: 'member@example.com' } }
          : null,
    },
  }),
}));

// Both routers dispatch best-effort queue jobs; neither needs a live Redis.
vi.mock('../queue.js', () => ({
  getSyncQueue: () => ({}),
  getHandoffQueue: () => ({}),
  // Publishing is fire-and-forget beside the mutation; this suite is about the
  // capability guard, so the bus is a no-op here.
  getEventBus: () => ({ publish: () => {}, subscribe: () => () => {}, close: async () => {} }),
}));
vi.mock('@palouse/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@palouse/queue')>()),
  enqueuePush: vi.fn(async () => {}),
  enqueueNotifyAgent: vi.fn(async () => {}),
}));

let container: StartedPostgreSqlContainer;
let db: Database;
let app: Hono;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = getDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  // logger.ts resolves loadEnv() at import time, so env must be complete
  // before the route modules are loaded.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.REDIS_URL = 'redis://127.0.0.1:6399';
  process.env.BETTER_AUTH_SECRET = 'caps-test-secret-caps-test-secret-!!';
  process.env.BETTER_AUTH_URL = 'http://localhost:4000';
  process.env.API_BASE_URL = 'http://localhost:4000';
  process.env.WEB_BASE_URL = WEB_BASE_URL;
  process.env.PALOUSE_ENCRYPTION_KEY = '0f'.repeat(32);
  const { _resetEnvForTest } = await import('@palouse/config');
  _resetEnvForTest();

  const { taskRoutes } = await import('./tasks.js');
  const { handoffRoutes } = await import('./handoffs.js');

  // Mirrors buildApp()'s error mapping so a thrown PalouseError surfaces as
  // its own status rather than Hono's default 500.
  app = new Hono();
  app.onError((err, c) => {
    if (err instanceof PalouseError)
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    throw err;
  });
  app.route('/v1/tasks', taskRoutes);
  app.route('/v1', handoffRoutes); // /v1/tasks/:id/handoff + /v1/handoffs/*
}, 120_000);

afterAll(async () => {
  await closeDb();
  await container?.stop();
});

/** Seeds a workspace with one active member and sets them as the session user. */
async function seedWorkspace(opts: { tasks: boolean }): Promise<string> {
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
    .values({ email: `member-${suffix}@example.com` })
    .returning();
  await db.insert(memberships).values({ workspaceId: ws!.id, userId: user!.id, role: 'admin' });
  // Capabilities default on with no row, so only the disabled case needs one.
  if (!opts.tasks) {
    await db
      .insert(workspaceCapabilities)
      .values({ workspaceId: ws!.id, capability: 'tasks', enabled: false });
  }
  sessionUserId.value = user!.id;
  return ws!.id;
}

async function get(path: string): Promise<Response> {
  return app.request(path);
}

async function post(path: string, body: unknown, method = 'POST'): Promise<Response> {
  return app.request(path, {
    method,
    headers: { origin: WEB_BASE_URL, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SOME_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Every route on the tasks + handoffs surface, with valid input so the
 * capability check is what rejects the request (input validation runs first).
 */
function allRoutes(workspaceId: string): Array<{ name: string; call: () => Promise<Response> }> {
  return [
    { name: 'GET /v1/tasks', call: () => get(`/v1/tasks?workspaceId=${workspaceId}`) },
    { name: 'POST /v1/tasks', call: () => post('/v1/tasks', { workspaceId, title: 'Task' }) },
    {
      name: 'GET /v1/tasks/:id',
      call: () => get(`/v1/tasks/${SOME_ID}?workspaceId=${workspaceId}`),
    },
    {
      name: 'PATCH /v1/tasks/:id',
      call: () => post(`/v1/tasks/${SOME_ID}`, { workspaceId, title: 'Renamed' }, 'PATCH'),
    },
    {
      name: 'POST /v1/tasks/:id/comments',
      call: () => post(`/v1/tasks/${SOME_ID}/comments`, { workspaceId, bodyMd: 'Note' }),
    },
    {
      name: 'POST /v1/tasks/:id/handoff',
      call: () => post(`/v1/tasks/${SOME_ID}/handoff`, { workspaceId, agentId: SOME_ID }),
    },
    { name: 'GET /v1/handoffs', call: () => get(`/v1/handoffs?workspaceId=${workspaceId}`) },
    {
      name: 'GET /v1/handoffs/:id',
      call: () => get(`/v1/handoffs/${SOME_ID}?workspaceId=${workspaceId}`),
    },
    {
      name: 'POST /v1/handoffs/:id/review',
      call: () => post(`/v1/handoffs/${SOME_ID}/review`, { workspaceId, decision: 'approved' }),
    },
    {
      name: 'POST /v1/handoffs/:id/cancel',
      call: () => post(`/v1/handoffs/${SOME_ID}/cancel`, { workspaceId }),
    },
  ];
}

describe('tasks capability enforcement on the API', () => {
  it('rejects every task, handoff, and review route when Tasks is disabled', async () => {
    const workspaceId = await seedWorkspace({ tasks: false });

    for (const route of allRoutes(workspaceId)) {
      const res = await route.call();
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      expect(res.status, `${route.name} should be 403`).toBe(403);
      expect(body.error?.code, route.name).toBe('FORBIDDEN');
      expect(body.error?.message, route.name).toBe(CAPABILITY_OFF);
    }
  });

  it('leaves an enabled workspace unaffected', async () => {
    const workspaceId = await seedWorkspace({ tasks: true });

    for (const route of allRoutes(workspaceId)) {
      const res = await route.call();
      // The seeded ids do not resolve, so most routes 404. What matters is
      // that none of them is refused by the capability guard.
      expect(res.status, `${route.name} should not be capability-refused`).not.toBe(403);
    }
  });

  it('lists tasks and handoffs for a workspace with Tasks on', async () => {
    const workspaceId = await seedWorkspace({ tasks: true });

    const tasks = await get(`/v1/tasks?workspaceId=${workspaceId}`);
    const handoffs = await get(`/v1/handoffs?workspaceId=${workspaceId}`);

    expect(tasks.status).toBe(200);
    expect(handoffs.status).toBe(200);
  });

  it('still rejects a non-member when the capability is on', async () => {
    const workspaceId = await seedWorkspace({ tasks: true });
    sessionUserId.value = crypto.randomUUID();

    const res = await get(`/v1/tasks?workspaceId=${workspaceId}`);
    const body = (await res.json()) as { error?: { message?: string } };

    expect(res.status).toBe(403);
    expect(body.error?.message).toBe('Not a member of this workspace');
  });
});
